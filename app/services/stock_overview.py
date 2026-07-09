"""Issue #41 — Dashboard cross-shop stock overview (R-v3-5, D-v3-5).

A new dedicated service for the ``/dashboard/stock-overview`` endpoint.
Deliberately separate from ``compute_low_stock`` (which scopes to one
shop and applies the per-product threshold filter) and
``compute_derived_stock`` (per-product, no shop dimension). The cross-
shop view needs every product x every shop the caller can see, so it
gets its own query path via ``compute_derived_stock_by_shop``.

Returns the rows shaped for the response schema — caller (the route
handler) only has to wrap them into Pydantic models.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.product import Product
from app.models.shop import Shop
from app.models.user import UserRole
from app.services.stock import compute_derived_stock_by_shop


@dataclass
class StockOverviewRow:
    """One (shop, product) row with the product's display fields
    pre-joined so the route handler doesn't need a second lookup."""

    shop_id: int
    product_id: int
    barcode: str
    brand: str
    size_label: str
    current_stock: int
    is_active: bool


@dataclass
class StockOverviewGroup:
    shop_id: int
    shop_name: str
    rows: list[StockOverviewRow]


async def build_stock_overview(
    db: AsyncSession, *, actor
) -> list[StockOverviewGroup]:
    """Return per-shop stock rows for every shop the actor is
    authorized to see.

    Owner: their own shop. Superadmin: every shop. The role check is
    enforced upstream by ``require_role(_owner_only)``; this function
    only does the scoping.
    """
    if actor.role == UserRole.SUPERADMIN:
        shops = (await db.execute(select(Shop).order_by(Shop.id))).scalars().all()
    else:
        # Owner / non-superadmin — single shop via the user row.
        assert actor.shop_id is not None
        shop = await db.get(Shop, actor.shop_id)
        shops = [shop] if shop is not None else []

    if not shops:
        return []

    # Pull every product in the in-scope shops so we can label the rows
    # (barcode, brand, size_label) even for stock=0 products that have
    # never moved through a lot/invoice. One round-trip; the index
    # ``ix_products_shop_status`` covers the shop filter.
    products = (
        await db.execute(
            select(Product)
            .where(Product.shop_id.in_([s.id for s in shops]))
            .order_by(Product.shop_id, Product.id)
        )
    ).scalars().all()

    # Cross-shop stock in one round-trip.
    stock = await compute_derived_stock_by_shop(db, shop_ids=[s.id for s in shops])

    # Bucket products by shop and build per-shop groups. Skips shops
    # with no products (empty shops are still in the actor's scope but
    # contribute no rows — caller decides whether to render an empty
    # group or omit it).
    products_by_shop: dict[int, list[Product]] = {}
    for p in products:
        products_by_shop.setdefault(p.shop_id, []).append(p)

    groups: list[StockOverviewGroup] = []
    for shop in shops:
        rows = [
            StockOverviewRow(
                shop_id=shop.id,
                product_id=p.id,
                barcode=p.barcode,
                brand=p.brand,
                size_label=p.size_label,
                current_stock=stock.get((p.id, shop.id), 0),
                is_active=p.is_active,
            )
            for p in products_by_shop.get(shop.id, [])
        ]
        groups.append(StockOverviewGroup(shop_id=shop.id, shop_name=shop.name, rows=rows))
    return groups


def now_utc() -> datetime:
    return datetime.now(UTC)


__all__ = [
    "StockOverviewGroup",
    "StockOverviewRow",
    "build_stock_overview",
    "now_utc",
]
