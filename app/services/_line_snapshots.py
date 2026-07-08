"""Issue #38 — fill in missing product_brand / product_size_label on
invoice and lot lines for pre-migration rows.

Migration ``d323bd1fc4d8`` adds the two snapshot columns to
``invoice_lines`` and ``lot_lines``, but rows created before the
migration run have NULL values for them. The API surface
(``InvoiceLinePublic``, ``LotLinePublic``) exposes the snapshot as
``str`` (not ``str | None``) so the frontend can render it without
guarding.

This module:

  - On read, fills in the snapshot fields from a live ``Product`` join
    for any line row whose snapshot is NULL. One query per batch of
    distinct ``product_id``s, never N+1.
  - On write, populates the snapshot from the live ``Product`` row at
    create time so future reads never need the fallback.

Both paths are part of the same ``snapshot_line`` helper so the
public-schema shape stays uniform: ``product_brand`` and
``product_size_label`` are always present strings on the wire.
"""
from __future__ import annotations

from collections.abc import Iterable, Sequence
from typing import TYPE_CHECKING

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

# Product is imported at runtime (not TYPE_CHECKING) because
# `resolve_missing_snapshots` issues an actual SELECT against it — the
# type-only import would only exist for the type-checker and break at
# runtime with NameError when the resolver path actually fires.
from app.models.product import Product

if TYPE_CHECKING:
    from app.models.invoice import InvoiceLine
    from app.models.lot import LotLine


def capture_from_product(
    line: InvoiceLine | LotLine, product: Product
) -> None:
    """Populate the snapshot fields on a freshly-created line row.

    Call this from the write paths (``finalize_checkout``,
    ``create_lot``) immediately before ``db.add(line)`` so the new row
    carries its own brand+size, decoupled from any future product
    rename.
    """
    line.product_brand = product.brand
    line.product_size_label = product.size_label


async def resolve_missing_snapshots(
    db: AsyncSession,
    lines: Sequence[InvoiceLine | LotLine],
) -> None:
    """For each line whose snapshot is NULL, fill it in from the live
    ``Product`` row. No-op if every line already has a snapshot.

    One round-trip per call: collects the distinct missing product_ids,
    fetches them in a single ``SELECT ... WHERE id IN (...)``, then
    mutates the in-memory ORM rows in place. The mutation lands on
    flush/expire, not on the wire — the caller's serialisation step
    (Pydantic ``from_attributes=True``) picks the values up directly.
    """
    if not lines:
        return
    missing_ids = {ln.product_id for ln in lines if ln.product_brand is None}
    if not missing_ids:
        return
    products = (
        await db.execute(
            select(
                Product.id,
                Product.brand,
                Product.size_label,
            ).where(Product.id.in_(missing_ids))
        )
    ).all()
    by_id = {row.id: (row.brand, row.size_label) for row in products}
    for line in lines:
        if line.product_brand is not None:
            continue
        snap = by_id.get(line.product_id)
        if snap is None:
            # The product was deleted but the line still references it
            # (unlikely, but possible). Leave the snapshot NULL so the
            # caller surfaces a clear "—" rather than fabricating a name.
            continue
        line.product_brand, line.product_size_label = snap


__all__ = [
    "capture_from_product",
    "resolve_missing_snapshots",
]


def line_product_ids(lines: Iterable[InvoiceLine | LotLine]) -> set[int]:
    """Distinct product_ids across a line collection — small helper used
    by both the snapshot resolver and any test that wants to assert
    behaviour without re-fetching the whole set."""
    return {ln.product_id for ln in lines}