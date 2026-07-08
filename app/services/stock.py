"""Derived stock — the one query for checkout's oversell check and the
low-stock evaluator (D-17, issue #28).

Stock is never stored on Product; it's derived as
SUM(lot_lines.quantity) - SUM(invoice_lines.quantity) for invoices in
`STATUSES_COUNTING_AS_SOLD`. Checkout scopes this to the cart's
product ids under a row lock; the low-stock evaluator scopes it to
every active product in a shop. Both need the same net-per-product
number, so this is the one query-builder either calls — previously
each service carried its own copy of the same two-armed union_all.
"""
from __future__ import annotations

from sqlalchemy import func, literal, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.invoice import STATUSES_COUNTING_AS_SOLD, Invoice, InvoiceLine
from app.models.lot import LotLine


async def compute_derived_stock(
    db: AsyncSession, *, product_ids: list[int]
) -> dict[int, int]:
    """Per-product stock: SUM(lot_lines.quantity) - SUM(invoice_lines.quantity),
    for invoices whose status is in `STATUSES_COUNTING_AS_SOLD`.

    One round-trip for any number of product ids. Callers scope the id
    list themselves — checkout passes the cart's resolved product ids
    (locked with SELECT ... FOR UPDATE beforehand so a concurrent
    finalize for the same SKU can't race); the low-stock evaluator
    passes every active product id in a shop.
    """
    if not product_ids:
        return {}
    received_subq = (
        select(
            LotLine.product_id.label("product_id"),
            func.coalesce(func.sum(LotLine.quantity), 0).label("received"),
        )
        .where(LotLine.product_id.in_(product_ids))
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
            InvoiceLine.product_id.in_(product_ids),
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
    # The union has one row per (product, side); sum the per-side
    # stock so a product with both received and sold rows aggregates
    # into a single net value.
    net: dict[int, int] = {}
    for pid, stock in rows:
        net[pid] = net.get(pid, 0) + int(stock)
    return net


__all__ = ["compute_derived_stock"]
