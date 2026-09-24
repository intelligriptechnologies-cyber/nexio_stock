"""approval-gated inventory adjustment movements

Revision ID: bb3c4d5e6f70
Revises: aa2b3c4d5e6f
Create Date: 2026-09-24 09:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "bb3c4d5e6f70"
down_revision: str | Sequence[str] | None = "aa2b3c4d5e6f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "stock_inwards",
        sa.Column("movement_type", sa.String(length=16), nullable=False, server_default="receipt"),
    )
    op.create_check_constraint(
        "ck_stock_inwards_movement_type",
        "stock_inwards",
        "movement_type IN ('receipt', 'adjustment')",
    )
    op.drop_constraint("ck_lot_lines_good_condition_quantity", "lot_lines", type_="check")
    op.create_check_constraint(
        "ck_lot_lines_good_condition_quantity",
        "lot_lines",
        "(quantity > 0 AND good_condition_quantity >= 0 AND good_condition_quantity <= quantity) "
        "OR (quantity < 0 AND good_condition_quantity = quantity)",
    )


def downgrade() -> None:
    op.drop_constraint("ck_lot_lines_good_condition_quantity", "lot_lines", type_="check")
    op.create_check_constraint(
        "ck_lot_lines_good_condition_quantity",
        "lot_lines",
        "good_condition_quantity >= 0 AND good_condition_quantity <= quantity",
        postgresql_not_valid=True,
    )
    op.drop_constraint("ck_stock_inwards_movement_type", "stock_inwards", type_="check")
    op.drop_column("stock_inwards", "movement_type")
