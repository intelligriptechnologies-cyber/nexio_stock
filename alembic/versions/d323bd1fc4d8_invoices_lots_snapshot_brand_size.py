"""invoices + lots: snapshot product brand + size onto lines (issue #38)

Revision ID: d323bd1fc4d8
Revises: 535c5717cfea
Create Date: 2026-07-09 00:00:00.000000

Issue #38 — checkout & receiving confirmation popups were rendering a
raw `product_id` instead of the product's name/brand, and the same bug
carried into the invoice preview. Two reasons to fix it with a persisted
snapshot rather than a display-only join to ``products`` (D-v3-4):

  1. A later product rename must not retroactively alter a historical
     invoice or lot — the audit-trail / excise-record requirement
     (v1 R-34) says finalized invoice line items never silently change
     after the fact.
  2. The lookup joins we already had (``product_id`` → ``Product``) are
     not free; a denormalised snapshot on the line row keeps the
     rendering path constant-time regardless of how the catalog grows.

Both columns are nullable. Existing ``invoice_lines`` / ``lot_lines``
rows created before this migration have no snapshot; the API + frontend
fall back to a live ``Product`` join for those rows only — see
``app/api/_line_snapshots.py`` for the resolver used by both schemas.
"""
from typing import Union, Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "d323bd1fc4d8"
down_revision: Union[str, Sequence[str], None] = "535c5717cfea"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add the two snapshot columns to each line table.

    Sizes mirror ``products.brand`` (200) and ``products.size_label``
    (64) so the snapshot is exactly as wide as it needs to be — no
    silent truncation, and no need for a cross-table length check.
    Nullable so the migration is backfill-free for existing rows.
    """
    op.add_column(
        "invoice_lines",
        sa.Column("product_brand", sa.String(length=200), nullable=True),
    )
    op.add_column(
        "invoice_lines",
        sa.Column("product_size_label", sa.String(length=64), nullable=True),
    )
    op.add_column(
        "lot_lines",
        sa.Column("product_brand", sa.String(length=200), nullable=True),
    )
    op.add_column(
        "lot_lines",
        sa.Column("product_size_label", sa.String(length=64), nullable=True),
    )


def downgrade() -> None:
    """Drop the snapshot columns. Loses any captured names — only safe
    on databases that have no historical rows yet."""
    op.drop_column("lot_lines", "product_size_label")
    op.drop_column("lot_lines", "product_brand")
    op.drop_column("invoice_lines", "product_size_label")
    op.drop_column("invoice_lines", "product_brand")