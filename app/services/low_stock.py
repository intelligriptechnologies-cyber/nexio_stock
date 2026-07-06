"""Low-stock evaluation (D-34, D-15, R-15).

A product is "low stock" when its current derived stock (per
`app.services.checkout._current_stock_for`'s formula) is at or below
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
from typing import TYPE_CHECKING

from sqlalchemy import func, literal, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.invoice import (
    STATUSES_COUNTING_AS_SOLD,
    Invoice,
    InvoiceLine,
)
from app.models.lot import LotLine
from app.models.product import Product

if TYPE_CHECKING:
    pass


@dataclass
class LowStockRow:
    product: Product
    current_stock: int
    effective_threshold: int | None  # NULL means "no threshold configured"


async def _stock_per_product(
    db: AsyncSession, *, shop_id: int
) -> dict[int, int]:
    """Return {product_id: net_stock} for every active product in the
    shop, using the same derived-stock formula as the checkout
    service (SUM(lot_lines) - SUM(invoice_lines where invoice.status
    counts as 'sold')). One round-trip."""
    received_subq = (
        select(
            LotLine.product_id.label("product_id"),
            func.coalesce(func.sum(LotLine.quantity), 0).label("received"),
        )
        .where(LotLine.product_id.in_(
            select(Product.id).where(
                Product.shop_id == shop_id, Product.is_active.is_(True)
            )
        ))
        .group_by(LotLine.product_id)
        .subquery()
    )
    sold_subq = (
        select(
            InvoiceLine.product_id.label("product_id"),
            func.coalesce(func.sum(InvoiceLine.quantity), 0).label("sold"),
        )
        .join(Invoice, InvoiceLine.invoice_id == Invoice.id)
        .where(
            InvoiceLine.product_id.in_(
                select(Product.id).where(
                    Product.shop_id == shop_id, Product.is_active.is_(True)
                )
            ),
            Invoice.status.in_(STATUSES_COUNTING_AS_SOLD),
        )
        .group_by(InvoiceLine.product_id)
        .subquery()
    )
    rows = (
        await db.execute(
            select(
                func.coalesce(received_subq.c.product_id, sold_subq.c.product_id).label(
                    "product_id"
                ),
                (
                    func.coalesce(received_subq.c.received, 0)
                    - func.coalesce(sold_subq.c.sold, 0)
                ).label("stock"),
            )
            .select_from(received_subq)
            .outerjoin(
                sold_subq, received_subq.c.product_id == sold_subq.c.product_id
            )
            .union_all(
                select(
                    sold_subq.c.product_id.label("product_id"),
                    (
                        literal(0)
                        - func.coalesce(sold_subq.c.sold, 0)
                    ).label("stock"),
                )
                .select_from(sold_subq)
                .outerjoin(
                    received_subq, sold_subq.c.product_id == received_subq.c.product_id
                )
                .where(received_subq.c.product_id.is_(None))
            )
        )
    ).all()
    net: dict[int, int] = {}
    for pid, stock in rows:
        net[pid] = net.get(pid, 0) + int(stock)
    return net


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

    stock_by_id = await _stock_per_product(db, shop_id=shop_id)

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
