"""Issue #40 — attach ``current_stock`` to a batch of products in one
round-trip.

The catalog list and the single-product lookup both need to surface a
stock count per product. Computing it inside the route handler keeps
the catalog service layer free of stock concerns (stock lives in
``app.services.stock``), and centralising the enrichment here means
both call sites share the same one-query behaviour: pass a list of
``Product`` rows, get back a ``{product_id: current_stock}`` mapping
populated in a single ``compute_derived_stock`` call. No N+1.
"""
from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.product import Product
from app.services.stock import compute_derived_stock


async def stock_counts_for(
    db: AsyncSession, products: Iterable[Product]
) -> dict[int, int]:
    """Return ``{product_id: current_stock}`` for every product in the
    iterable. One round-trip via the shared
    ``compute_derived_stock`` service — never one query per row.

    Used by ``GET /products`` (list) and ``GET /products/lookup``
    (single) so the catalog column always matches the dashboard's
    low-stock list value for the same product.
    """
    products = list(products)
    if not products:
        return {}
    return await compute_derived_stock(db, product_ids=[p.id for p in products])


__all__ = ["stock_counts_for"]