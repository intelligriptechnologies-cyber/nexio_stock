"""Tests for app.db.unit_of_work (issue #27).

Unlike an API-seam test (which can't tell whether a request-level 200/4xx
came from the helper's commit/rollback or from some other commit already
in the route), these drive the context manager directly so a broken
commit or rollback branch actually fails the test.
"""
from __future__ import annotations

from sqlalchemy import func, select

from app.db import unit_of_work
from app.models.product import Product, ProductStatus
from app.models.shop import Shop

import pytest


async def _product_count(db_session, barcode: str) -> int:
    return (
        await db_session.execute(
            select(func.count()).select_from(Product).where(Product.barcode == barcode)
        )
    ).scalar()


@pytest.mark.usefixtures("shop")
async def test_unit_of_work_commits_on_success(db_session, shop: Shop) -> None:
    shop_id = shop.id
    async with unit_of_work(db_session):
        db_session.add(
            Product(
                shop_id=shop_id,
                barcode="UOW-COMMIT-1",
                brand="A",
                size_label="750ml",
                price=None,
                low_stock_threshold=None,
                is_active=True,
                status=ProductStatus.PENDING,
            )
        )
    assert await _product_count(db_session, "UOW-COMMIT-1") == 1


@pytest.mark.usefixtures("shop")
async def test_unit_of_work_rolls_back_on_error(db_session, shop: Shop) -> None:
    # Capture before entering the block: a rollback expires every object
    # in the identity map (including `shop`), so re-touching shop.id
    # afterward would trigger an implicit lazy-load outside greenlet
    # context (the same trap test_product_creation.py hit).
    shop_id = shop.id
    with pytest.raises(RuntimeError):
        async with unit_of_work(db_session):
            db_session.add(
                Product(
                    shop_id=shop_id,
                    barcode="UOW-ROLLBACK-1",
                    brand="A",
                    size_label="750ml",
                    price=None,
                    low_stock_threshold=None,
                    is_active=True,
                    status=ProductStatus.PENDING,
                )
            )
            raise RuntimeError("boom")

    assert await _product_count(db_session, "UOW-ROLLBACK-1") == 0

    # The session must still be usable for a subsequent operation.
    db_session.add(
        Product(
            shop_id=shop_id,
            barcode="UOW-ROLLBACK-2",
            brand="B",
            size_label="750ml",
            price=None,
            low_stock_threshold=None,
            is_active=True,
            status=ProductStatus.PENDING,
        )
    )
    await db_session.commit()
    assert await _product_count(db_session, "UOW-ROLLBACK-2") == 1
