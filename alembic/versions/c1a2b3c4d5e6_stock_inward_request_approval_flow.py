"""stock inward requests: approval-gated commit flow

Revision ID: c1a2b3c4d5e6
Revises: 9d4a7c2b1e8f
Create Date: 2026-07-14 00:00:00.000000
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "c1a2b3c4d5e6"
down_revision: Union[str, Sequence[str], None] = "9d4a7c2b1e8f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add inward request tables and link approved stock rows back to them."""
    op.create_table(
        "stock_inwards",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("shop_id", sa.Integer(), nullable=False),
        sa.Column("vendor_id", sa.Integer(), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), nullable=False),
        sa.Column("approved_by_user_id", sa.Integer(), nullable=True),
        sa.Column("rejected_by_user_id", sa.Integer(), nullable=True),
        sa.Column("lot_id", sa.Integer(), nullable=True),
        sa.Column("reference", sa.String(length=100), nullable=True),
        sa.Column("purchase_date", sa.Date(), nullable=False),
        sa.Column("vendor_invoice_number", sa.String(length=100), nullable=False),
        sa.Column("invoice_value", sa.Numeric(precision=12, scale=2), nullable=False),
        sa.Column("notes", sa.String(length=500), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False, server_default=sa.text("'pending'")),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("rejected_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.text("now()")),
        sa.ForeignKeyConstraint(["shop_id"], ["shops.id"], ondelete="restrict"),
        sa.ForeignKeyConstraint(["vendor_id"], ["vendors.id"], ondelete="restrict"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="restrict"),
        sa.ForeignKeyConstraint(["approved_by_user_id"], ["users.id"], ondelete="restrict"),
        sa.ForeignKeyConstraint(["rejected_by_user_id"], ["users.id"], ondelete="restrict"),
        sa.ForeignKeyConstraint(["lot_id"], ["lots.id"], ondelete="set null"),
        sa.CheckConstraint(
            "status IN ('pending', 'approved', 'rejected', 'completed')",
            name="ck_stock_inwards_status",
        ),
    )
    op.create_index("ix_stock_inwards_shop_status", "stock_inwards", ["shop_id", "status"])
    op.create_index("ix_stock_inwards_shop_created_at", "stock_inwards", ["shop_id", "created_at"])
    op.create_unique_constraint("uq_stock_inwards_lot_id", "stock_inwards", ["lot_id"])

    op.create_table(
        "stock_inward_lines",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("stock_inward_id", sa.Integer(), nullable=False),
        sa.Column("product_id", sa.Integer(), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("good_condition_quantity", sa.Integer(), nullable=False),
        sa.Column("product_brand", sa.String(length=200), nullable=True),
        sa.Column("product_size_label", sa.String(length=64), nullable=True),
        sa.ForeignKeyConstraint(["stock_inward_id"], ["stock_inwards.id"], ondelete="cascade"),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="restrict"),
    )
    op.create_index(
        "uq_stock_inward_lines_inward_product",
        "stock_inward_lines",
        ["stock_inward_id", "product_id"],
        unique=True,
    )
    op.create_index(
        "ix_stock_inward_lines_product",
        "stock_inward_lines",
        ["product_id"],
    )

    op.add_column(
        "lots",
        sa.Column("stock_inward_id", sa.Integer(), nullable=True),
    )
    op.create_unique_constraint("uq_lots_stock_inward_id", "lots", ["stock_inward_id"])
    op.create_foreign_key(
        "fk_lots_stock_inward_id",
        "lots",
        "stock_inwards",
        ["stock_inward_id"],
        ["id"],
        ondelete="set null",
    )


def downgrade() -> None:
    """Drop inward workflow tables and the lot back-reference."""
    op.drop_constraint("fk_lots_stock_inward_id", "lots", type_="foreignkey")
    op.drop_constraint("uq_lots_stock_inward_id", "lots", type_="unique")
    op.drop_column("lots", "stock_inward_id")

    op.drop_index("ix_stock_inward_lines_product", table_name="stock_inward_lines")
    op.drop_index("uq_stock_inward_lines_inward_product", table_name="stock_inward_lines")
    op.drop_table("stock_inward_lines")

    op.drop_constraint("uq_stock_inwards_lot_id", "stock_inwards", type_="unique")
    op.drop_index("ix_stock_inwards_shop_created_at", table_name="stock_inwards")
    op.drop_index("ix_stock_inwards_shop_status", table_name="stock_inwards")
    op.drop_table("stock_inwards")
