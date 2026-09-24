"""OSBCL purchase orders and reconciliation

Revision ID: aa2b3c4d5e6f
Revises: 7c9e1a2b3d4f
Create Date: 2026-09-23 10:00:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "aa2b3c4d5e6f"
down_revision: str | Sequence[str] | None = "7c9e1a2b3d4f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "shop_case_pack_rules",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("shop_id", sa.Integer(), sa.ForeignKey("shops.id", ondelete="CASCADE"), nullable=False),
        sa.Column("size_ml", sa.Integer(), nullable=False),
        sa.Column("bottles_per_case", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("size_ml > 0", name="ck_case_pack_size_positive"),
        sa.CheckConstraint("bottles_per_case > 0", name="ck_case_pack_count_positive"),
        sa.UniqueConstraint("shop_id", "size_ml", name="uq_shop_case_pack_size"),
    )
    op.create_index("ix_shop_case_pack_rules_shop_id", "shop_case_pack_rules", ["shop_id"])
    op.execute(
        """INSERT INTO shop_case_pack_rules (shop_id, size_ml, bottles_per_case)
        SELECT shops.id, defaults.size_ml, defaults.bottles
        FROM shops CROSS JOIN (VALUES (90,96),(180,48),(375,24),(500,12),(650,6),(750,8))
          AS defaults(size_ml,bottles)"""
    )

    op.create_table(
        "purchase_orders",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("shop_id", sa.Integer(), sa.ForeignKey("shops.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("osbcl_token", sa.String(100), nullable=True),
        sa.Column("order_date", sa.Date(), nullable=True),
        sa.Column("order_type", sa.String(50), nullable=True),
        sa.Column("retailer_name", sa.String(200), nullable=True),
        sa.Column("retailer_code", sa.String(100), nullable=True),
        sa.Column("vehicle_number", sa.String(50), nullable=True),
        sa.Column("total_cases", sa.Integer(), nullable=True),
        sa.Column("total_loose_bottles", sa.Integer(), nullable=True),
        sa.Column("mger_total", sa.Numeric(14, 2), nullable=True),
        sa.Column("order_total", sa.Numeric(14, 2), nullable=True),
        sa.Column("source_filename", sa.String(255), nullable=False),
        sa.Column("source_sha256", sa.String(64), nullable=False),
        sa.Column("source_path", sa.String(500), nullable=False),
        sa.Column("page_count", sa.Integer(), nullable=False),
        sa.Column("extraction_status", sa.String(24), nullable=False),
        sa.Column("extraction_confidence", sa.Numeric(5, 4), nullable=True),
        sa.Column("review_flags", postgresql.JSONB(astext_type=sa.Text()), server_default="[]", nullable=False),
        sa.Column("raw_ocr", postgresql.JSONB(astext_type=sa.Text()), server_default="{}", nullable=False),
        sa.Column("status", sa.String(24), server_default="draft", nullable=False),
        sa.Column("created_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=False),
        sa.Column("confirmed_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=True),
        sa.Column("cancelled_by_user_id", sa.Integer(), sa.ForeignKey("users.id", ondelete="RESTRICT"), nullable=True),
        sa.Column("confirmed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("cancellation_reason", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("status IN ('draft','open','partially_received','fulfilled','cancelled')", name="ck_purchase_order_status"),
        sa.CheckConstraint("extraction_status IN ('pending','review_required','ready','failed')", name="ck_po_extraction_status"),
        sa.UniqueConstraint("shop_id", "osbcl_token", name="uq_purchase_orders_shop_token"),
        sa.UniqueConstraint("shop_id", "source_sha256", name="uq_purchase_orders_shop_hash"),
    )
    op.create_index("ix_purchase_orders_shop_id", "purchase_orders", ["shop_id"])
    op.create_index("ix_purchase_orders_shop_status", "purchase_orders", ["shop_id", "status"])

    op.create_table(
        "purchase_order_lines",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("purchase_order_id", sa.Integer(), sa.ForeignKey("purchase_orders.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source_item_name", sa.String(500), nullable=False),
        sa.Column("size_ml", sa.Integer(), nullable=True),
        sa.Column("product_id", sa.Integer(), sa.ForeignKey("products.id", ondelete="RESTRICT"), nullable=True),
        sa.Column("cases", sa.Integer(), server_default="0", nullable=False),
        sa.Column("loose_bottles", sa.Integer(), server_default="0", nullable=False),
        sa.Column("pack_size_snapshot", sa.Integer(), nullable=True),
        sa.Column("ordered_bottles", sa.Integer(), nullable=True),
        sa.Column("case_rate", sa.Numeric(14, 2), nullable=True),
        sa.Column("mger", sa.Numeric(14, 2), nullable=True),
        sa.Column("amount", sa.Numeric(14, 2), nullable=True),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("ocr_confidence", sa.Numeric(5, 4), nullable=True),
        sa.Column("field_confidence", postgresql.JSONB(astext_type=sa.Text()), server_default="{}", nullable=False),
        sa.Column("match_candidates", postgresql.JSONB(astext_type=sa.Text()), server_default="[]", nullable=False),
        sa.CheckConstraint("cases >= 0 AND loose_bottles >= 0", name="ck_po_line_quantities_nonnegative"),
        sa.UniqueConstraint("purchase_order_id", "sequence", name="uq_purchase_order_line_sequence"),
    )
    op.create_index("ix_purchase_order_lines_purchase_order_id", "purchase_order_lines", ["purchase_order_id"])
    op.create_index("ix_purchase_order_lines_product", "purchase_order_lines", ["product_id"])

    op.add_column("stock_inwards", sa.Column("purchase_order_id", sa.Integer(), nullable=True))
    op.add_column("stock_inwards", sa.Column("over_receipt_reason", sa.String(500), nullable=True))
    op.create_foreign_key("fk_stock_inwards_purchase_order", "stock_inwards", "purchase_orders", ["purchase_order_id"], ["id"], ondelete="RESTRICT")
    op.create_index("ix_stock_inwards_purchase_order_id", "stock_inwards", ["purchase_order_id"])
    op.add_column("stock_inward_lines", sa.Column("purchase_order_line_id", sa.Integer(), nullable=True))
    op.create_foreign_key("fk_stock_inward_lines_po_line", "stock_inward_lines", "purchase_order_lines", ["purchase_order_line_id"], ["id"], ondelete="RESTRICT")
    op.create_index("ix_stock_inward_lines_purchase_order_line_id", "stock_inward_lines", ["purchase_order_line_id"])


def downgrade() -> None:
    op.drop_index("ix_stock_inward_lines_purchase_order_line_id", table_name="stock_inward_lines")
    op.drop_constraint("fk_stock_inward_lines_po_line", "stock_inward_lines", type_="foreignkey")
    op.drop_column("stock_inward_lines", "purchase_order_line_id")
    op.drop_index("ix_stock_inwards_purchase_order_id", table_name="stock_inwards")
    op.drop_constraint("fk_stock_inwards_purchase_order", "stock_inwards", type_="foreignkey")
    op.drop_column("stock_inwards", "over_receipt_reason")
    op.drop_column("stock_inwards", "purchase_order_id")
    op.drop_table("purchase_order_lines")
    op.drop_table("purchase_orders")
    op.drop_table("shop_case_pack_rules")
