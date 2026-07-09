"""business day tracking, invoice archive tables, rejected products

Revision ID: a9c4f9d2b7e1
Revises: 7b1e86a4f0c2
Create Date: 2026-07-09 12:00:00.000000

"""
from typing import Union

from alembic import op
import sqlalchemy as sa


revision: str = "a9c4f9d2b7e1"
down_revision: Union[str, None] = "7b1e86a4f0c2"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


invoice_status = sa.Enum(
    "FINALIZED",
    "VOIDED",
    "REVERSAL",
    "PENDING_VOID",
    name="invoice_status",
    native_enum=False,
    length=32,
)
payment_mode = sa.Enum("CASH", "UPI", "CARD", name="payment_mode", native_enum=False, length=16)


def upgrade() -> None:
    op.add_column(
        "shops",
        sa.Column("current_business_date", sa.Date(), server_default=sa.text("CURRENT_DATE"), nullable=False),
    )
    op.add_column(
        "invoices",
        sa.Column("business_date", sa.Date(), server_default=sa.text("CURRENT_DATE"), nullable=False),
    )

    op.create_table(
        "past_invoices",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("original_invoice_id", sa.Integer(), nullable=True),
        sa.Column("shop_id", sa.Integer(), nullable=False),
        sa.Column("cashier_user_id", sa.Integer(), nullable=False),
        sa.Column("invoice_number", sa.Integer(), nullable=False),
        sa.Column("status", invoice_status, nullable=False),
        sa.Column("total_amount", sa.Numeric(12, 2), nullable=False),
        sa.Column("finalized_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("business_date", sa.Date(), nullable=False),
        sa.Column("eod_signed_off_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("eod_signed_off_by_user_id", sa.Integer(), nullable=True),
        sa.Column("note", sa.String(length=200), nullable=True),
        sa.Column("reverses_past_invoice_id", sa.Integer(), nullable=True),
        sa.Column("void_requested_by_user_id", sa.Integer(), nullable=True),
        sa.Column("void_requested_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["cashier_user_id"], ["users.id"], ondelete="restrict"),
        sa.ForeignKeyConstraint(["eod_signed_off_by_user_id"], ["users.id"], ondelete="set null"),
        sa.ForeignKeyConstraint(["reverses_past_invoice_id"], ["past_invoices.id"], ondelete="set null"),
        sa.ForeignKeyConstraint(["shop_id"], ["shops.id"], ondelete="restrict"),
        sa.ForeignKeyConstraint(["void_requested_by_user_id"], ["users.id"], ondelete="set null"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("shop_id", "invoice_number", name="uq_past_invoices_shop_number"),
    )
    op.create_index("ix_past_invoices_original_invoice_id", "past_invoices", ["original_invoice_id"])
    op.create_index("ix_past_invoices_reverses_past_invoice_id", "past_invoices", ["reverses_past_invoice_id"])
    op.create_index("ix_past_invoices_shop_business_date", "past_invoices", ["shop_id", "business_date"])
    op.create_index("ix_past_invoices_shop_status", "past_invoices", ["shop_id", "status"])

    op.create_table(
        "past_invoice_lines",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("invoice_id", sa.Integer(), nullable=False),
        sa.Column("product_id", sa.Integer(), nullable=False),
        sa.Column("quantity", sa.Integer(), nullable=False),
        sa.Column("unit_price", sa.Numeric(12, 2), nullable=False),
        sa.Column("line_total", sa.Numeric(12, 2), nullable=False),
        sa.Column("product_brand", sa.String(length=200), nullable=True),
        sa.Column("product_size_label", sa.String(length=64), nullable=True),
        sa.ForeignKeyConstraint(["invoice_id"], ["past_invoices.id"], ondelete="cascade"),
        sa.ForeignKeyConstraint(["product_id"], ["products.id"], ondelete="restrict"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("invoice_id", "product_id", name="uq_past_invoice_lines_invoice_product"),
    )
    op.create_table(
        "past_payments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("invoice_id", sa.Integer(), nullable=False),
        sa.Column("mode", payment_mode, nullable=False),
        sa.Column("amount", sa.Numeric(12, 2), nullable=False),
        sa.ForeignKeyConstraint(["invoice_id"], ["past_invoices.id"], ondelete="cascade"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_past_payments_invoice", "past_payments", ["invoice_id"])

    op.drop_constraint("ck_products_price_iff_active", "products", type_="check")
    op.create_check_constraint(
        "ck_products_price_iff_active",
        "products",
        "((status = 'active' AND price IS NOT NULL AND price > 0) OR (status IN ('pending', 'rejected') AND price IS NULL))",
    )


def downgrade() -> None:
    op.drop_constraint("ck_products_price_iff_active", "products", type_="check")
    op.create_check_constraint(
        "ck_products_price_iff_active",
        "products",
        "((status = 'active' AND price IS NOT NULL AND price > 0) OR (status = 'pending' AND price IS NULL))",
    )
    op.drop_index("ix_past_payments_invoice", table_name="past_payments")
    op.drop_table("past_payments")
    op.drop_table("past_invoice_lines")
    op.drop_index("ix_past_invoices_shop_status", table_name="past_invoices")
    op.drop_index("ix_past_invoices_shop_business_date", table_name="past_invoices")
    op.drop_index("ix_past_invoices_reverses_past_invoice_id", table_name="past_invoices")
    op.drop_index("ix_past_invoices_original_invoice_id", table_name="past_invoices")
    op.drop_table("past_invoices")
    op.drop_column("invoices", "business_date")
    op.drop_column("shops", "current_business_date")
