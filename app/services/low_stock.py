"""Low-stock evaluation (D-34, D-15, R-15).

A product is "low stock" when its current derived stock (per
`app.services.stock.compute_derived_stock`'s formula) is at or below
its effective threshold:

  effective_threshold = product.low_stock_threshold
                       ?? shop.low_stock_threshold_default

The shop-wide default lives on `Shop.low_stock_threshold_default` and
covers products that haven't been tuned individually (D-34).

This module's `compute_low_stock(db, shop_id)` returns the list
[(product, current_stock, effective_threshold), ...] sorted by
ascending stock (most-urgent first). The owner dashboard reads this
on demand; a startup task in `app.main.lifespan` also calls it on a
timer to satisfy the "A background job periodically evaluates"
acceptance criterion in #7.
"""
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.product import Product
from app.services.stock import compute_derived_stock


@dataclass
class LowStockRow:
    product: Product
    current_stock: int
    effective_threshold: int | None  # NULL means "no threshold configured"


async def compute_low_stock(
    db: AsyncSession, *, shop_id: int
) -> list[LowStockRow]:
    """Products at or below their effective threshold. Sorted by
    ascending stock (most-urgent first), then by name for stability.

    A product is included if:
      - it has an effective threshold (per-product override, or
        shop default), AND
      - its current derived stock is <= that threshold.

    Products with no effective threshold are excluded — the owner
    hasn't opted in to monitoring them yet.
    """
    from app.models.shop import Shop

    shop = await db.get(Shop, shop_id)
    if shop is None:
        return []
    shop_default = shop.low_stock_threshold_default

    products = (
        await db.execute(
            select(Product)
            .where(Product.shop_id == shop_id, Product.is_active.is_(True))
        )
    ).scalars().all()

    if not products:
        return []

    stock_by_id = await compute_derived_stock(db, product_ids=[p.id for p in products])

    rows: list[LowStockRow] = []
    for p in products:
        effective = p.low_stock_threshold if p.low_stock_threshold is not None else shop_default
        if effective is None:
            continue  # owner hasn't set any threshold for this product
        current = stock_by_id.get(p.id, 0)
        if current <= effective:
            rows.append(
                LowStockRow(
                    product=p,
                    current_stock=current,
                    effective_threshold=effective,
                )
            )

    rows.sort(key=lambda r: (r.current_stock, r.product.brand, r.product.size_label))
    return rows


__all__ = ["LowStockRow", "compute_low_stock"]
