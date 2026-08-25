"""stock inward unit costs

Revision ID: f1a2b3c4d5e6
Revises: c1a2b3c4d5e6
Create Date: 2026-08-25 16:00:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "f1a2b3c4d5e6"
down_revision: str | Sequence[str] | None = "c1a2b3c4d5e6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "stock_inward_lines",
        sa.Column("unit_cost", sa.Numeric(12, 2), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("stock_inward_lines", "unit_cost")
