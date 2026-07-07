"""Product catalog + bulk CSV import (D-7, D-19, D-52, D-61, R-7, R-10, R-27, R-42).

Write endpoints are owner (own shop) or superadmin (any shop, via an
explicit shop_id — D-64/D-65). The /lookup endpoint is the scanner's
product-fetch path used by the cashier in #4 and the receiver in #3 — it's
read-only and accepts a barcode (scanned or manually typed per the
fallback in R-10/R-27) and returns the product record. It's exposed
through this router rather than one in #3/#4 so a single place owns the
contract.
"""
from __future__ import annotations

import csv
import io
from decimal import Decimal, InvalidOperation
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from sqlalchemy import select
from sqlalchemy.dialects.postgresql.asyncpg import AsyncAdapt_asyncpg_dbapi
from sqlalchemy.exc import IntegrityError

from app.api._errors import is_unique_violation
from app.api.deps import DbSession, require_role, resolve_write_shop_id
from app.logging_config import get_logger
from app.models.product import Product
from app.models.user import User, UserRole
from app.schemas.product import (
    ProductCreate,
    ProductImportError,
    ProductImportResponse,
    ProductPublic,
    ProductUpdate,
)

router = APIRouter(prefix="/products", tags=["products"])
log = get_logger(__name__)

# Read-only access for cashier + receiver too — they both need to look up
# a product by barcode (scan or manual entry) during their respective
# flows (#3 receiving, #4 checkout). Owner and superadmin have it too.
_lookup_roles = (UserRole.OWNER, UserRole.RECEIVER_USER, UserRole.CASHIER_USER, UserRole.SUPERADMIN)
_write_roles = (UserRole.OWNER, UserRole.SUPERADMIN)


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
    respective flows."""
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
