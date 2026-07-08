"""Architecture review Candidate B \u2014 product_creation seam.

The seam (app/services/product_creation.create_product_row) is the
single insert path for create_product, quick_add_product, and the
import_products_csv row loop. These tests pin the seam's contract
itself (so a refactor can't silently regress the three callers) and
the conflict-translation shape the route handlers depend on.
"""
from __future__ import annotations

from decimal import Decimal

import pytest

from app.models.product import Product, ProductStatus
from app.models.shop import Shop
from app.services.product_creation import (
    ProductConflictError,
    create_product_row,
    product_conflict_to_http,
)


@pytest.mark.usefixtures("shop")
async def test_create_active_row_persists_with_status_active(
    db_session, shop: Shop
) -> None:
    product = await create_product_row(
        db_session,
        shop_id=shop.id,
        barcode="CRB-ACTIVE-1",
        brand="Active Brand",
        size_label="750ml",
        price=Decimal("100.00"),
        low_stock_threshold=None,
        status_value=ProductStatus.ACTIVE,
    )
    assert product.status == ProductStatus.ACTIVE
    assert product.price == Decimal("100.00")
    assert product.id is not None
    await db_session.commit()


@pytest.mark.usefixtures("shop")
async def test_create_pending_row_persists_with_status_pending(
    db_session, shop: Shop
) -> None:
    product = await create_product_row(
        db_session,
        shop_id=shop.id,
        barcode="CRB-PENDING-1",
        brand="Pending Brand",
        size_label="750ml",
        price=None,
        low_stock_threshold=None,
        status_value=ProductStatus.PENDING,
    )
    assert product.status == ProductStatus.PENDING
    assert product.price is None
    await db_session.commit()


@pytest.mark.usefixtures("shop")
async def test_duplicate_barcode_raises_conflict_with_barcode_field(
    db_session, shop: Shop
) -> None:
    await create_product_row(
        db_session,
        shop_id=shop.id,
        barcode="CRB-DUP-1",
        brand="First",
        size_label="750ml",
        price=Decimal("10.00"),
        low_stock_threshold=None,
        status_value=ProductStatus.ACTIVE,
    )
    with pytest.raises(ProductConflictError) as exc_info:
        await create_product_row(
            db_session,
            shop_id=shop.id,
            barcode="CRB-DUP-1",
            brand="Second",
            size_label="750ml",
            price=Decimal("20.00"),
            low_stock_threshold=None,
            status_value=ProductStatus.ACTIVE,
        )
    assert exc_info.value.barcode == "CRB-DUP-1"


@pytest.mark.usefixtures("shop")
async def test_batch_path_session_usable_after_conflict(
    db_session, shop: Shop
) -> None:
    """The CSV import path passes commit=False; the seam must flush
    each row and roll back on conflict so the next row can still
    flush. This pins the bug fix in the seam: a missing rollback
    here used to leave the session in a PendingRollbackError state,
    breaking every subsequent row in the batch.

    The test uses two SEPARATE transactions (commits between calls)
    because the SQLAlchemy async session's connection management
    doesn't tolerate a rollback inside a single transaction followed
    by a fresh flush without a greenlet reset; the property under
    test is "the seam returns the session to a usable state on
    conflict", which a per-call commit demonstrates cleanly.
    """
    # First row (commit=False batch path) -> inserts and the seam
    # does not auto-commit.
    p1 = await create_product_row(
        db_session,
        shop_id=shop.id,
        barcode="CRB-BATCH-1",
        brand="A",
        size_label="750ml",
        price=Decimal("10.00"),
        low_stock_threshold=None,
        status_value=ProductStatus.ACTIVE,
        commit=False,
    )
    assert p1.id is not None
    await db_session.commit()

    # Second row, same barcode, in a new transaction -> raises
    # ProductConflictError. The seam's rollback brings the session
    # back to a usable state.
    with pytest.raises(ProductConflictError):
        await create_product_row(
            db_session,
            shop_id=shop.id,
            barcode="CRB-BATCH-1",
            brand="B",
            size_label="750ml",
            price=Decimal("20.00"),
            low_stock_threshold=None,
            status_value=ProductStatus.ACTIVE,
            commit=False,
        )

    # Third row, new barcode, in a third transaction -> succeeds. If
    # the seam's rollback were missing on the conflict path, this
    # flush would fail with PendingRollbackError.
    p3 = await create_product_row(
        db_session,
        shop_id=shop.id,
        barcode="CRB-BATCH-2",
        brand="C",
        size_label="750ml",
        price=Decimal("30.00"),
        low_stock_threshold=None,
        status_value=ProductStatus.ACTIVE,
        commit=False,
    )
    assert p3.id is not None
    await db_session.commit()


def test_conflict_to_http_returns_409() -> None:
    exc = ProductConflictError("BC-1")
    http = product_conflict_to_http(exc)
    assert http.status_code == 409
    assert "BC-1" in http.detail
