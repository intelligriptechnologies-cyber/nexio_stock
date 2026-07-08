"""Product creation -- one seam for the three insert paths.

Architecture review Candidate B (2026-07-08, Worth exploring):
``create_product`` (active), ``quick_add_product`` (pending),
and ``import_products_csv`` (batch of active rows) each construct a
``Product``, ``db.add`` it, then commit-or-flush, then catch the same
unique-violation shape and translate it. Three copies of the same
insert-or-409 boilerplate.

This module owns the insert-or-409 path. The route handlers stay
where they are -- they own auth, validation, audit logging, response
shape -- and call into here for the actual insert + integrity-error
translation. The seam's signature carries the only two real
parameters: status (active vs pending) and commit (true for
single-row callers, false for the CSV batch which flushes per row
and commits once at the end).
"""
from __future__ import annotations

from decimal import Decimal

from fastapi import HTTPException, status
from sqlalchemy.dialects.postgresql.asyncpg import AsyncAdapt_asyncpg_dbapi
from sqlalchemy.exc import IntegrityError

from app.api._errors import is_unique_violation
from app.models.product import Product, ProductStatus


class ProductConflictError(Exception):
    """Same-barcode conflict on insert. The router maps this to 409.

    Carries the offending barcode so the UI can show a specific
    message (the cashier sees 'Someone already added this -- refreshing'
    and the CSV import surfaces it as a per-row error).
    """

    def __init__(self, barcode: str) -> None:
        super().__init__(f"barcode {barcode!r} already exists")
        self.barcode = barcode


async def create_product_row(
    db,
    *,
    shop_id: int,
    barcode: str,
    brand: str,
    size_label: str,
    price: Decimal | None,
    low_stock_threshold: int | None,
    status_value: ProductStatus,
    is_active: bool = True,
    commit: bool = True,
    pending_origin: str | None = None,
    pending_added_by_user_id: int | None = None,
) -> Product:
    """Insert one product row with integrity-error translation.

    Single-row callers (create_product, quick_add_product) pass
    commit=True: the row is committed before return. The CSV batch
    caller passes commit=False so it can flush each row (to surface
    unique violations per row) and commit the whole batch at the end.

    ``pending_origin``/``pending_added_by_user_id`` (issue #31) are set
    only by the quick-add caller — they record where a pending row came
    from at the moment it's created, so the Pending Products list can
    read them back directly instead of re-deriving them from the audit
    log tables.

    Raises ProductConflictError (409) on a UNIQUE(barcode) collision.
    Any other IntegrityError propagates (and currently none exist --
    the only DB-level uniqueness constraint is on barcode).
    """
    product = Product(
        shop_id=shop_id,
        barcode=barcode,
        brand=brand,
        size_label=size_label,
        price=price,
        low_stock_threshold=low_stock_threshold,
        is_active=is_active,
        status=status_value,
        pending_origin=pending_origin,
        pending_added_by_user_id=pending_added_by_user_id,
    )
    db.add(product)
    try:
        if commit:
            await db.commit()
        else:
            await db.flush()
    except (IntegrityError, AsyncAdapt_asyncpg_dbapi.IntegrityError) as exc:
        # The session is now in a failed-transaction state whether we
        # committed or just flushed. Roll back so the next operation
        # can proceed -- this is critical for the batch path (CSV
        # import), which calls flush() per row and needs the session
        # usable for the next row's flush.
        await db.rollback()
        if is_unique_violation(exc):
            raise ProductConflictError(barcode) from exc
        raise
    return product


def product_conflict_to_http(exc: ProductConflictError) -> HTTPException:
    """Translate a ProductConflictError to a 409 response. The router
    calls this at the exception boundary so the route handler doesn't
    need to know about the domain exception."""
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=f"barcode {exc.barcode!r} already exists",
    )


__all__ = [
    "ProductConflictError",
    "create_product_row",
    "product_conflict_to_http",
]