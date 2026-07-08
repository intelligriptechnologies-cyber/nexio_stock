"""Product catalog + bulk CSV import (D-7, D-19, D-52, D-61, R-7, R-10, R-27, R-42).

Write endpoints are owner (own shop) or superadmin (any shop, via an
explicit shop_id — D-64/D-65). The /lookup endpoint is the scanner's
product-fetch path used by the cashier in #4 and the receiver in #3 — it's
read-only and accepts a barcode (scanned or manually typed per the
fallback in R-10/R-27) and returns the product record. It's exposed
through this router rather than one in #3/#4 so a single place owns the
contract.

Quick-add (issue #22, D-v2-5/D-v2-9/D-v2-12) creates a ``pending`` product
on the spot from brand + size only. It's open to receiver, cashier, and
owner (D-v2-10). The endpoint accepts an optional ``X-Quick-Add-Origin``
header (``receiving`` | ``checkout``) so the event can be logged to the
right domain log table (D-v2-13); default is ``receiving`` because that's
the only caller in #22, and ``checkout`` is added in #26.
"""
from __future__ import annotations

import csv
import io
from decimal import Decimal, InvalidOperation
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Query, UploadFile, status
from sqlalchemy import select
from sqlalchemy.dialects.postgresql.asyncpg import AsyncAdapt_asyncpg_dbapi
from sqlalchemy.exc import IntegrityError

from app.api._errors import is_unique_violation
from app.api.deps import DbSession, require_role, resolve_write_shop_id
from app.logging_config import get_logger
from app.models.log import InvoicingLog, StockinLog
from app.models.product import Product, ProductStatus
from app.models.user import User, UserRole
from app.schemas.product import (
    ProductCreate,
    ProductImportError,
    ProductImportResponse,
    ProductPublic,
    ProductQuickAdd,
    ProductUpdate,
)

router = APIRouter(prefix="/products", tags=["products"])
log = get_logger(__name__)

# Read-only access for cashier + receiver too — they both need to look up
# a product by barcode (scan or manual entry) during their respective
# flows (#3 receiving, #4 checkout). Owner and superadmin have it too.
_lookup_roles = (UserRole.OWNER, UserRole.RECEIVER_USER, UserRole.CASHIER_USER, UserRole.SUPERADMIN)
_write_roles = (UserRole.OWNER, UserRole.SUPERADMIN)
# Quick-add is intentionally broader than /products POST — receiver and
# cashier are the primary users (D-v2-1); owner is a superset of both
# (D-v2-10). Superadmin is NOT in this set: superadmin creating
# provisional products in a shop they're not operating in would skip
# the owner-completion notification surface. If a future ticket needs
# superadmin quick-add, add it then with the appropriate origin header.
_quick_add_roles = (UserRole.OWNER, UserRole.RECEIVER_USER, UserRole.CASHIER_USER)


@router.post(
    "",
    response_model=ProductPublic,
    status_code=status.HTTP_201_CREATED,
    summary="Owner creates a single product",
)
async def create_product(
    payload: ProductCreate,
    db: DbSession,
    _user: User = Depends(require_role(*_write_roles)),
) -> ProductPublic:
    # Eagerly capture: the auth dep's session is closing around the time
    # this handler's `db` session takes over, and detached User objects
    # trigger a lazy load on attribute access.
    actor_id = _user.id
    # Owner/receiver/cashier create in their own shop; superadmin must
    # name the target shop explicitly (D-64/D-65).
    actor_shop_id = await resolve_write_shop_id(db, _user, payload.shop_id)

    product = Product(
        shop_id=actor_shop_id,
        barcode=payload.barcode,
        brand=payload.brand,
        size_label=payload.size_label,
        price=payload.price,
        low_stock_threshold=payload.low_stock_threshold,
        is_active=True,
        status=ProductStatus.ACTIVE,
    )
    db.add(product)
    try:
        await db.commit()
    except (IntegrityError, AsyncAdapt_asyncpg_dbapi.IntegrityError) as exc:
        if is_unique_violation(exc):
            await db.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"barcode '{payload.barcode}' already exists",
            ) from exc
        raise
    await db.refresh(product)
    log.info(
        "product.created",
        actor_user_id=actor_id,
        shop_id=actor_shop_id,
        product_id=product.id,
        barcode=product.barcode,
    )
    return ProductPublic.model_validate(product)


@router.post(
    "/quick-add",
    response_model=ProductPublic,
    status_code=status.HTTP_201_CREATED,
    summary="Provisional product creation (receiver/cashier/owner, brand + size only)",
)
async def quick_add_product(
    payload: ProductQuickAdd,
    db: DbSession,
    _user: User = Depends(require_role(*_quick_add_roles)),
    idempotency_key: Annotated[
        str | None,
        Header(
            alias="Idempotency-Key",
            description="Reuses the checkout-finalize idempotency pattern (D-v2-12, D-30). "
            "A double-tap on 'Add' with the same key is a no-op rather than a duplicate-error.",
            max_length=80,
        ),
    ] = None,
    x_quick_add_origin: Annotated[
        Literal["receiving", "checkout"] | None,
        Header(
            alias="X-Quick-Add-Origin",
            description="Which screen triggered the quick-add; routes the audit-log "
            "entry to stockin_logs (receiving) or invoicing_logs (checkout) per D-v2-13. "
            "Defaults to 'receiving' because that's the only caller in #22; "
            "checkout is added in #26.",
        ),
    ] = None,
) -> ProductPublic:
    """Quick-add: receiver/cashier/owner registers a brand-new product on
    the spot when a scan doesn't resolve (issue #22, D-v2-4).

    Behavior:
      - Creates a ``status='pending'`` Product (no price, no threshold).
      - Owner completes it later via the Pending Products screen (#25).
      - A pending product can be received into a Lot like an active one
        (D-v2-6) — receiving this endpoint does NOT bypass that.
      - Same-barcode race is caught by the DB unique constraint on
        ``barcode`` (D-52, D-v2-9) and surfaced as a 409 with a
        conflict-friendly detail so the UI can show
        "Someone already added this — refreshing" instead of a raw error.

    Idempotency: the optional ``Idempotency-Key`` header means a
    double-tap on "Add" with the same key returns the same product
    rather than producing a second create (D-v2-12). The check is
    scoped to this endpoint only — separate from the checkout-finalize
    idempotency namespace.
    """
    actor_id = _user.id
    actor_shop_id = _user.shop_id
    assert actor_shop_id is not None, "shop-scoped user must have shop_id"

    # Optional idempotency: same key for the same actor within a short
    # window returns the existing pending product (D-v2-12). We don't
    # need a separate IdempotencyKey table for this — the constraint
    # below plus a per-actor key cache (in-memory for now) is enough
    # for the ordinary double-tap case. A DB-backed key table can be
    # added if real double-submit pressure emerges.
    if idempotency_key:
        cached = _quick_add_idem_cache.get((actor_id, idempotency_key))
        if cached is not None:
            # Re-fetch in case it was rolled back; cache is best-effort.
            existing = (
                await db.execute(
                    select(Product).where(
                        Product.shop_id == actor_shop_id,
                        Product.barcode == cached["barcode"],
                    )
                )
            ).scalar_one_or_none()
            if existing is not None:
                return ProductPublic.model_validate(existing)

    product = Product(
        shop_id=actor_shop_id,
        barcode=payload.barcode,
        brand=payload.brand,
        size_label=payload.size_label,
        price=None,
        low_stock_threshold=None,
        is_active=True,
        status=ProductStatus.PENDING,
    )
    db.add(product)
    try:
        await db.commit()
    except (IntegrityError, AsyncAdapt_asyncpg_dbapi.IntegrityError) as exc:
        if is_unique_violation(exc):
            await db.rollback()
            # Re-fetch the existing product so the UI can refresh the
            # catalog cache with the row that "won" the race (D-v2-9).
            existing = (
                await db.execute(
                    select(Product).where(
                        Product.shop_id == actor_shop_id,
                        Product.barcode == payload.barcode,
                    )
                )
            ).scalar_one_or_none()
            if existing is None:
                # Shouldn't happen — constraint fired but no row. Treat as
                # a server error rather than letting it cascade as a 500.
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="barcode conflict but no existing row found",
                ) from exc
            log.info(
                "product.quick_add.conflict",
                actor_user_id=actor_id,
                shop_id=actor_shop_id,
                barcode=payload.barcode,
                existing_product_id=existing.id,
                existing_status=existing.status.value,
            )
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"barcode '{payload.barcode}' already exists",
            ) from exc
        raise
    await db.refresh(product)

    # Cache the idempotency mapping so a same-key retry short-circuits.
    if idempotency_key:
        _quick_add_idem_cache[(actor_id, idempotency_key)] = {
            "product_id": product.id,
            "barcode": product.barcode,
        }
        _evict_quick_add_idem_cache()

    # Audit-log to the right domain table (D-v2-13). The origin header is
    # the source of truth for which log table to write to — defaults to
    # "receiving" for the in-scope #22 caller. Checkout is added in #26.
    origin = x_quick_add_origin or "receiving"
    log_payload = {
        "product_id": product.id,
        "barcode": product.barcode,
        "brand": product.brand,
        "size_label": product.size_label,
        "origin": origin,
    }
    log_cls = StockinLog if origin == "receiving" else InvoicingLog
    db.add(
        log_cls(
            shop_id=actor_shop_id,
            actor_user_id=actor_id,
            event_type="product.pending_created",
            payload=log_payload,
        )
    )
    await db.commit()

    log.info(
        "product.quick_add.created",
        actor_user_id=actor_id,
        shop_id=actor_shop_id,
        product_id=product.id,
        barcode=product.barcode,
        origin=origin,
    )
    return ProductPublic.model_validate(product)


# In-memory idempotency cache for /products/quick-add. Bounded to the
# most recent MAX_QUICK_ADD_IDEM entries to keep memory usage flat under
# normal traffic; old entries fall out on insertion. This is intentionally
# NOT a DB-backed IdempotencyKey — quick-add is a low-frequency
# counter-staff action, and a same-key retry from the same actor within
# seconds is the only realistic double-submit shape. If the bar raises,
# promote this to a proper IdempotencyKey row (#22 explicitly scopes
# this to the in-memory pattern — see D-v2-12).
MAX_QUICK_ADD_IDEM = 1024
_quick_add_idem_cache: dict[tuple[int, str], dict] = {}


def _evict_quick_add_idem_cache() -> None:
    """Evict oldest half when the cache exceeds its cap. Called inline
    on every insert so the cache stays bounded without a background
    task."""
    if len(_quick_add_idem_cache) > MAX_QUICK_ADD_IDEM:
        # dict preserves insertion order in CPython 3.7+; drop the
        # first half (oldest).
        keep = MAX_QUICK_ADD_IDEM // 2
        for old_key in list(_quick_add_idem_cache.keys())[:-keep]:
            _quick_add_idem_cache.pop(old_key, None)


@router.get(
    "",
    response_model=list[ProductPublic],
    summary="List products (owner: own shop; superadmin: all shops)",
)
async def list_products(
    db: DbSession,
    _user: User = Depends(require_role(*_write_roles, *_lookup_roles)),
    active_only: Annotated[bool, Query(description="Filter out deactivated products")] = True,
    q: Annotated[str | None, Query(description="Substring match on brand")] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
    shop_id: Annotated[
        int | None,
        Query(description="Superadmin only: scope the listing to one shop (D-66)"),
    ] = None,
) -> list[ProductPublic]:
    actor_role = _user.role
    actor_shop_id = _user.shop_id
    stmt = select(Product)
    if actor_role != UserRole.SUPERADMIN:
        if shop_id is not None and shop_id != actor_shop_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="only superadmin may specify shop_id",
            )
        stmt = stmt.where(Product.shop_id == actor_shop_id)
    elif shop_id is not None:
        # Superadmin scoped to one shop via the acting-shop picker (D-66) —
        # the checkout/receiving catalog cache should reflect the shop
        # being operated on, not every shop. Omit shop_id to keep the
        # cross-shop browse behavior the admin products list still uses.
        stmt = stmt.where(Product.shop_id == shop_id)
    if active_only:
        stmt = stmt.where(Product.is_active.is_(True))
    if q:
        stmt = stmt.where(Product.brand.ilike(f"%{q}%"))
    stmt = stmt.order_by(Product.brand, Product.size_label).limit(limit).offset(offset)
    rows = (await db.execute(stmt)).scalars().all()
    return [ProductPublic.model_validate(r) for r in rows]


@router.get(
    "/lookup",
    response_model=ProductPublic,
    summary="Resolve a product by barcode (used by receiver/cashier scan flows)",
)
async def lookup_product(
    db: DbSession,
    _user: User = Depends(require_role(*_lookup_roles)),
    barcode: Annotated[str, Query(min_length=1, max_length=64)] = ...,
    shop_id: Annotated[
        int | None,
        Query(description="Superadmin only: scope the lookup to one shop (D-66)"),
    ] = None,
) -> ProductPublic:
    """Scan-time product fetch. The locally-cached catalog (R-12 / D-30)
    lives client-side; this endpoint is the cold-start / cache-miss path
    AND the server-side lookup the cashier and receiver use in their
    respective flows.

    A ``pending`` product IS resolvable here — the receiver needs to scan
    it into a Lot (D-v2-6) and the cashier needs the status field to
    decide whether to block the line (#26). The `is_active=False` check
    is unchanged: deactivating a product still hides it from scan.
    """
    actor_role = _user.role
    actor_shop_id = _user.shop_id
    stmt = select(Product).where(Product.barcode == barcode)
    if actor_role != UserRole.SUPERADMIN:
        if shop_id is not None and shop_id != actor_shop_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="only superadmin may specify shop_id",
            )
        stmt = stmt.where(Product.shop_id == actor_shop_id)
    elif shop_id is not None:
        # Superadmin scoped to its acting shop (D-66): a scan during
        # checkout/receiving should resolve against that shop's catalog,
        # not browse across every shop. Barcode is globally unique (D-52)
        # so this can't disambiguate a collision — there isn't one to
        # disambiguate — it just matches the acting-shop-scoped model
        # every other superadmin action uses.
        stmt = stmt.where(Product.shop_id == shop_id)
    product = (await db.execute(stmt)).scalar_one_or_none()
    if product is None or not product.is_active:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"no active product with barcode '{barcode}'",
        )
    return ProductPublic.model_validate(product)


@router.patch(
    "/{product_id}",
    response_model=ProductPublic,
    summary="Owner updates a product's price, brand, threshold, or active flag",
)
async def update_product(
    product_id: int,
    payload: ProductUpdate,
    db: DbSession,
    _user: User = Depends(require_role(*_write_roles)),
) -> ProductPublic:
    actor_id = _user.id
    actor_role = _user.role
    actor_shop_id = _user.shop_id
    stmt = select(Product).where(Product.id == product_id)
    if actor_role != UserRole.SUPERADMIN:
        stmt = stmt.where(Product.shop_id == actor_shop_id)
    product = (await db.execute(stmt)).scalar_one_or_none()
    if product is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="product not found")

    data = payload.model_dump(exclude_unset=True)
    for field_name, value in data.items():
        setattr(product, field_name, value)
    await db.commit()
    await db.refresh(product)
    log.info(
        "product.updated",
        actor_user_id=actor_id,
        shop_id=product.shop_id,
        product_id=product.id,
        changed_fields=sorted(data.keys()),
    )
    return ProductPublic.model_validate(product)


# --- CSV bulk import ---


_CSV_REQUIRED_COLUMNS = ("barcode", "brand", "size_label", "price")
_CSV_OPTIONAL_COLUMNS = ("low_stock_threshold",)


@router.post(
    "/import-csv",
    response_model=ProductImportResponse,
    summary="Owner bulk-uploads a CSV of products (per-row errors surfaced)",
)
async def import_products_csv(
    db: DbSession,
    _user: User = Depends(require_role(*_write_roles)),
    file: UploadFile = File(..., description="CSV with header row"),
    shop_id: Annotated[
        int | None,
        Form(description="Superadmin-only (D-65): target shop for the import"),
    ] = None,
) -> ProductImportResponse:
    """Bulk import per D-61 / R-42. Returns 200 even when some rows fail —
    per-row errors are listed in the response so the cashier-facing UI
    can show "X succeeded, Y failed" rather than silently partial-failing.
    A row fails if validation rejects it OR if its barcode collides with
    an existing product (D-52)."""
    # Capture actor fields up front — `_user` is detached after the
    # auth dep's session closes, and accessing `.id` / `.shop_id` later
    # triggers a lazy load on a closed session.
    actor_id = _user.id
    actor_shop_id = await resolve_write_shop_id(db, _user, shop_id)

    raw = await file.read()
    try:
        text = raw.decode("utf-8-sig")  # tolerate BOM
    except UnicodeDecodeError:
        text = raw.decode("latin-1", errors="replace")

    reader = csv.DictReader(io.StringIO(text))
    if reader.fieldnames is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="empty CSV")
    missing = [c for c in _CSV_REQUIRED_COLUMNS if c not in reader.fieldnames]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"CSV missing required columns: {missing}",
        )

    created = 0
    errors: list[ProductImportError] = []

    for row_index, raw_row in enumerate(reader, start=2):  # row 1 is header
        row_num = row_index  # already 1-based for the data rows
        barcode = (raw_row.get("barcode") or "").strip()
        brand = (raw_row.get("brand") or "").strip()
        size_label = (raw_row.get("size_label") or "").strip()
        price_raw = (raw_row.get("price") or "").strip()
        threshold_raw = (raw_row.get("low_stock_threshold") or "").strip()

        # Per-row validation
        if not barcode or not brand or not size_label or not price_raw:
            errors.append(
                ProductImportError(
                    row=row_num,
                    barcode=barcode or None,
                    error="barcode, brand, size_label, and price are all required",
                )
            )
            continue
        try:
            price = Decimal(price_raw)
        except (InvalidOperation, ValueError):
            errors.append(
                ProductImportError(
                    row=row_num,
                    barcode=barcode,
                    error=f"price '{price_raw}' is not a valid decimal",
                )
            )
            continue
        if price <= 0:
            errors.append(
                ProductImportError(row=row_num, barcode=barcode, error="price must be > 0")
            )
            continue
        threshold: int | None = None
        if threshold_raw:
            try:
                threshold = int(threshold_raw)
            except ValueError:
                errors.append(
                    ProductImportError(
                        row=row_num,
                        barcode=barcode,
                        error=f"low_stock_threshold '{threshold_raw}' is not a valid integer",
                    )
                )
                continue
            if threshold < 0:
                errors.append(
                    ProductImportError(
                        row=row_num,
                        barcode=barcode,
                        error="low_stock_threshold must be >= 0",
                    )
                )
                continue

        product = Product(
            shop_id=actor_shop_id,
            barcode=barcode,
            brand=brand,
            size_label=size_label,
            price=price,
            low_stock_threshold=threshold,
            is_active=True,
            status=ProductStatus.ACTIVE,
        )
        db.add(product)
        try:
            await db.flush()
        except (IntegrityError, AsyncAdapt_asyncpg_dbapi.IntegrityError) as exc:
            if is_unique_violation(exc):
                # Roll back so the failed INSERT doesn't leave the
                # session in a DEACTIVE state. The `product` instance
                # becomes detached automatically; we don't need to
                # expunge it explicitly.
                await db.rollback()
                errors.append(
                    ProductImportError(
                        row=row_num,
                        barcode=barcode,
                        error=f"barcode '{barcode}' already exists",
                    )
                )
                continue
            raise

        created += 1
        # Let the session forget the row so a later failure doesn't
        # poison this row's in-memory state. Use expunge (not rollback)
        # because the INSERT succeeded.
        db.expunge(product)

    if created:
        await db.commit()

    log.info(
        "product.import_csv",
        actor_user_id=actor_id,
        shop_id=actor_shop_id,
        created=created,
        failed=len(errors),
    )
    return ProductImportResponse(created=created, failed=len(errors), errors=errors)