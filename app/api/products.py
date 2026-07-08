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
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Query, UploadFile, status
from sqlalchemy import select

from app.api.deps import DbSession, require_role, resolve_write_shop_id
from app.logging_config import get_logger
from app.models.log import InvoicingLog, StockinLog
from app.models.product import Product, ProductStatus
from app.models.user import User, UserRole
from app.schemas.product import (
    PendingProductRow,
    ProductActivate,
    ProductCreate,
    ProductImportError,
    ProductImportResponse,
    ProductPublic,
    ProductQuickAdd,
    ProductUpdate,
)
from app.services.product_creation import (
    ProductConflictError,
    create_product_row,
    product_conflict_to_http,
)
from app.services.product_lifecycle import (
    ProductLifecycleError,
    apply_status_transition,
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

    # Architecture review Candidate B: insert + 409 lives in
    # app.services.product_creation (one seam for all three
    # create/quick-add/import call sites).
    try:
        product = await create_product_row(
            db,
            shop_id=actor_shop_id,
            barcode=payload.barcode,
            brand=payload.brand,
            size_label=payload.size_label,
            price=payload.price,
            low_stock_threshold=payload.low_stock_threshold,
            status_value=ProductStatus.ACTIVE,
        )
    except ProductConflictError as exc:
        raise product_conflict_to_http(exc) from exc
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

    # Architecture review Candidate B: insert + 409 lives in
    # app.services.product_creation. The quick-add-specific conflict
    # path (re-fetch the existing row, log a structured event for the
    # audit trail) stays here because it's a quick-add concern, not
    # a generic product-insert concern.
    try:
        product = await create_product_row(
            db,
            shop_id=actor_shop_id,
            barcode=payload.barcode,
            brand=payload.brand,
            size_label=payload.size_label,
            price=None,
            low_stock_threshold=None,
            status_value=ProductStatus.PENDING,
        )
    except ProductConflictError as exc:
        # The seam has already rolled back; we can safely SELECT now.
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
    await db.refresh(product)

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


# Idempotency note: the /products/quick-add handler accepts an optional
# Idempotency-Key header (D-v2-12). The cache that used to live here was
# deleted in the architecture review (Candidate C, 2026-07-08) -- the
# frontend always regenerates a random key per submit (qa-${origin}-
# ${barcode}-${uid()}), so the cache-hit branch was structurally
# unreachable through the actual UI. Same-barcode double-submits are
# caught by the global UNIQUE(barcode) constraint and surface as 409
# (handled by the same-barcode race path below). If a future caller
# wants server-side key replay, the right shape is a stable ref on
# the client (like CheckoutPage's idempotencyKeyRef) plus a small
# IdempotencyKey row table -- not a per-process LRU.


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
    # Apply the price/status coupling FIRST so a bad PATCH on price
    # surfaces as a 400 from the lifecycle module rather than a 500
    # from the DB CHECK violation path (architecture review
    # Candidate D, 2026-07-08).
    if "price" in data:
        try:
            apply_status_transition(product, price=data["price"])
        except ProductLifecycleError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"code": exc.code, "message": exc.message},
            ) from exc
        # apply_status_transition already wrote product.price; remove
        # it from the generic setattr loop so we don't double-assign.
        del data["price"]
    for field_name, value in data.items():
        setattr(product, field_name, value)
    await db.commit()
    await db.refresh(product)
    log.info(
        "product.updated",
        actor_user_id=actor_id,
        shop_id=product.shop_id,
        product_id=product.id,
        changed_fields=sorted(payload.model_dump(exclude_unset=True).keys()),
    )
    return ProductPublic.model_validate(product)


# --- Issue #25: Pending Products list + activation ---------------------
#
# Activation is the resolution action (D-v2-8): completing the product
# IS the dismissal -- there is no separate dismiss/acknowledge step. The
# owner sets a price, the row flips from pending to active, and the
# product drops off the pending list automatically.

_pending_roles = (UserRole.OWNER, UserRole.SUPERADMIN)


@router.get(
    "/pending",
    response_model=list[PendingProductRow],
    summary="List pending products awaiting a price (issue #25, D-v2-8)",
)
async def list_pending_products(
    db: DbSession,
    _user: User = Depends(require_role(*_pending_roles)),
    shop_id: Annotated[
        int | None,
        Query(description="Superadmin only: scope the listing to one shop"),
    ] = None,
) -> list[PendingProductRow]:
    # Owner / superadmin view of every product still in
    # status='pending' (D-v2-5). The list itself is the notification
    # surface -- there's no separate dismissible notification record
    # (D-v2-8). Newest first.
    #
    # Joins the latest product.pending_created log entry per product so
    # the owner can see who added it and whether it came from receiving
    # or checkout (D-v2-13).
    actor_role = _user.role
    actor_shop_id = _user.shop_id

    stmt = (
        select(Product)
        .where(Product.status == ProductStatus.PENDING)
        .order_by(Product.created_at.desc())
    )
    if actor_role != UserRole.SUPERADMIN:
        if shop_id is not None and shop_id != actor_shop_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="only superadmin may specify shop_id",
            )
        stmt = stmt.where(Product.shop_id == actor_shop_id)
    elif shop_id is not None:
        stmt = stmt.where(Product.shop_id == shop_id)

    rows = (await db.execute(stmt)).scalars().all()
    if not rows:
        return []

    # Pull the most recent pending_created event per product across both
    # log tables (D-v2-13). The codebase's log tables store ``payload``
    # as the generic SQLAlchemy ``JSON`` type which renders as JSONB
    # on Postgres but doesn't expose a typed ``astext`` accessor
    # through SQLAlchemy's generic JSON comparator. Rather than fight
    # the type system, fetch the events and filter to the relevant
    # product_ids in Python -- the pending list is small (N <= dozens
    # in any realistic deployment), and the per-product scan below is
    # O(N events) where N is bounded by total pending_created events
    # ever logged, which is itself a low-frequency counter-staff action.
    product_ids = {p.id for p in rows}

    stockin_events = (
        await db.execute(
            select(StockinLog).where(StockinLog.event_type == "product.pending_created")
        )
    ).scalars().all()
    invoicing_events = (
        await db.execute(
            select(InvoicingLog).where(InvoicingLog.event_type == "product.pending_created")
        )
    ).scalars().all()

    # Per-product: pick the most-recent event across both tables. The
    # schema only allows one such event per product today (the
    # create-and-activate is the resolution, not a repeat action), but
    # the order-by keeps the code correct if that invariant loosens.
    by_product: dict[int, tuple[str, int | None, datetime]] = {}
    for ev in stockin_events:
        pid = ev.payload.get("product_id")
        if pid is None or pid not in product_ids:
            continue
        cur = by_product.get(pid)
        if cur is None or ev.created_at > cur[2]:
            by_product[pid] = ("receiving", ev.actor_user_id, ev.created_at)
    for ev in invoicing_events:
        pid = ev.payload.get("product_id")
        if pid is None or pid not in product_ids:
            continue
        cur = by_product.get(pid)
        if cur is None or ev.created_at > cur[2]:
            by_product[pid] = ("checkout", ev.actor_user_id, ev.created_at)

    # Resolve actor names (small N, one query).
    actor_ids = {cur[1] for cur in by_product.values() if cur[1] is not None}
    actor_names: dict[int, str] = {}
    if actor_ids:
        actor_rows = (
            await db.execute(
                select(User).where(User.id.in_(actor_ids))
            )
        ).scalars().all()
        actor_names = {u.id: u.full_name for u in actor_rows}

    out: list[PendingProductRow] = []
    for p in rows:
        cur = by_product.get(p.id)
        out.append(
            PendingProductRow(
                id=p.id,
                barcode=p.barcode,
                brand=p.brand,
                size_label=p.size_label,
                created_at=p.created_at,
                updated_at=p.updated_at,
                last_event_origin=cur[0] if cur else None,
                last_event_actor_id=cur[1] if cur else None,
                last_event_actor_name=(
                    actor_names.get(cur[1]) if cur and cur[1] is not None else None
                ),
            )
        )
    return out


@router.post(
    "/{product_id}/activate",
    response_model=ProductPublic,
    summary="Owner completes a pending product by setting its price (issue #25)",
)
async def activate_product(
    product_id: int,
    payload: ProductActivate,
    db: DbSession,
    _user: User = Depends(require_role(*_pending_roles)),
) -> ProductPublic:
    # Activation is the resolution action for the Pending Products list
    # (D-v2-8). The price/status coupling is delegated to
    # apply_status_transition so the rule lives in one place
    # (architecture review Candidate D, 2026-07-08). Activating a
    # deactivated (is_active=False) product is a 400.
    actor_id = _user.id
    actor_role = _user.role
    actor_shop_id = _user.shop_id
    stmt = select(Product).where(Product.id == product_id)
    if actor_role != UserRole.SUPERADMIN:
        stmt = stmt.where(Product.shop_id == actor_shop_id)
    product = (await db.execute(stmt)).scalar_one_or_none()
    if product is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="product not found")

    if not product.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="cannot activate a deactivated product",
        )

    was_pending = product.status == ProductStatus.PENDING
    try:
        apply_status_transition(product, price=payload.price)
    except ProductLifecycleError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": exc.code, "message": exc.message},
        ) from exc
    product.low_stock_threshold = payload.low_stock_threshold

    await db.commit()
    await db.refresh(product)
    log.info(
        "product.activated",
        actor_user_id=actor_id,
        shop_id=product.shop_id,
        product_id=product.id,
        was_pending=was_pending,
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

        # Architecture review Candidate B: insert + 409 lives in
        # app.services.product_creation. The CSV batch passes
        # commit=False so we can flush per row and surface per-row
        # 409s as ProductImportError entries (the existing
        # per-row-validation shape).
        try:
            product = await create_product_row(
                db,
                shop_id=actor_shop_id,
                barcode=barcode,
                brand=brand,
                size_label=size_label,
                price=price,
                low_stock_threshold=threshold,
                status_value=ProductStatus.ACTIVE,
                commit=False,
            )
        except ProductConflictError as exc:
            errors.append(
                ProductImportError(
                    row=row_num,
                    barcode=barcode,
                    error=f"barcode '{exc.barcode}' already exists",
                )
            )
            continue

        created += 1
        # Let the session forget the row so a later failure doesn't
        # poison this row's in-memory state. Use expunge (not
        # rollback) because the INSERT succeeded (it was flushed,
        # not committed).
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