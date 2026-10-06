"""PO single approved receipt and closed-short lifecycle

Revision ID: d4e5f6a7b8c9
Revises: bb3c4d5e6f70
Create Date: 2026-10-03 00:00:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "d4e5f6a7b8c9"
down_revision: str | Sequence[str] | None = "bb3c4d5e6f70"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # The original PO migration used a named check because the application
    # enum is deliberately non-native. Keep the DB contract in sync.
    with op.batch_alter_table("purchase_orders") as batch:
        batch.drop_constraint("ck_purchase_order_status", type_="check")
        batch.create_check_constraint(
            "ck_purchase_order_status",
            "status IN ('draft','open','partially_received','fulfilled','closed_short','cancelled')",
        )
    op.create_index(
        "uq_stock_inwards_completed_purchase_order",
        "stock_inwards",
        ["purchase_order_id"],
        unique=True,
        postgresql_where=sa.text("status = 'completed' AND purchase_order_id IS NOT NULL"),
        sqlite_where=sa.text("status = 'completed' AND purchase_order_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_stock_inwards_completed_purchase_order", table_name="stock_inwards")
    with op.batch_alter_table("purchase_orders") as batch:
        batch.drop_constraint("ck_purchase_order_status", type_="check")
        batch.create_check_constraint(
            "ck_purchase_order_status",
            "status IN ('draft','open','partially_received','fulfilled','cancelled')",
        )
