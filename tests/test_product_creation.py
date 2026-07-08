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
    """The CSV import path passes commit=False and flushes every row in
    ONE transaction, committing once at the end -- it never commits
    between rows. This pins the bug fix in the seam: a missing rollback
    on the conflict path here used to leave the session in a
    PendingRollbackError state, breaking every subsequent row in the
    batch. Mirrors the real caller's shape (app/api/products.py
    import_products_csv) rather than committing between calls.

    Captures shop.id up front: the seam's rollback on conflict expires
    every object in the session's identity map (including the `shop`
    fixture), so re-touching `shop.id` afterward would trigger an
    implicit lazy-load outside greenlet context.
    """
    shop_id = shop.id
    p1 = await create_product_row(
        db_session,
        shop_id=shop_id,
        barcode="CRB-BATCH-1",
        brand="A",
        size_label="750ml",
        price=Decimal("10.00"),
        low_stock_threshold=None,
        status_value=ProductStatus.ACTIVE,
        commit=False,
    )
    assert p1.id is not None

    # Same barcode -> raises ProductConflictError. The seam's rollback
    # must bring the (still-open) transaction back to a usable state.
    with pytest.raises(ProductConflictError):
        await create_product_row(
            db_session,
            shop_id=shop_id,
            barcode="CRB-BATCH-1",
            brand="B",
            size_label="750ml",
            price=Decimal("20.00"),
            low_stock_threshold=None,
            status_value=ProductStatus.ACTIVE,
            commit=False,
        )

    # New barcode, same transaction -> succeeds. If the seam's rollback
    # were missing on the conflict path, this flush would fail with
    # PendingRollbackError instead.
    p3 = await create_product_row(
        db_session,
        shop_id=shop_id,
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
