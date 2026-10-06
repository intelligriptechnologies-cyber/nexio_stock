"""persist delivery review and wastage declaration on PO drafts

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
"""
from __future__ import annotations

from collections.abc import Sequence
import sqlalchemy as sa
from alembic import op

revision: str = "e5f6a7b8c9d0"
down_revision: str | Sequence[str] | None = "d4e5f6a7b8c9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("purchase_orders") as batch:
        batch.add_column(sa.Column("vendor_id", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("purchase_date", sa.Date(), nullable=True))
        batch.add_column(sa.Column("vendor_invoice_number", sa.String(length=100), nullable=True))
        batch.add_column(sa.Column("invoice_value", sa.Numeric(12, 2), nullable=True))
        batch.add_column(sa.Column("wastage_reason", sa.Text(), nullable=True))
        batch.add_column(sa.Column("wastage_attested", sa.Boolean(), nullable=False, server_default=sa.false()))
        batch.add_column(sa.Column("wastage_attested_by_user_id", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("wastage_attested_at", sa.DateTime(timezone=True), nullable=True))
        batch.create_foreign_key("fk_po_vendor", "vendors", ["vendor_id"], ["id"])
        batch.create_foreign_key("fk_po_wastage_user", "users", ["wastage_attested_by_user_id"], ["id"])
    with op.batch_alter_table("purchase_order_lines") as batch:
        batch.add_column(sa.Column("delivered_bottles", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("accepted_bottles", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("unit_cost", sa.Numeric(12, 2), nullable=True))
    with op.batch_alter_table("stock_inwards") as batch:
        batch.add_column(sa.Column("wastage_reason", sa.Text(), nullable=True))
        batch.add_column(sa.Column("wastage_attested", sa.Boolean(), nullable=False, server_default=sa.false()))
        batch.add_column(sa.Column("wastage_attested_by_user_id", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("wastage_attested_at", sa.DateTime(timezone=True), nullable=True))
        batch.create_foreign_key("fk_inward_wastage_user", "users", ["wastage_attested_by_user_id"], ["id"])


def downgrade() -> None:
    with op.batch_alter_table("stock_inwards") as batch:
        batch.drop_constraint("fk_inward_wastage_user", type_="foreignkey")
        batch.drop_column("wastage_attested_at")
        batch.drop_column("wastage_attested_by_user_id")
        batch.drop_column("wastage_attested")
        batch.drop_column("wastage_reason")
    with op.batch_alter_table("purchase_order_lines") as batch:
        batch.drop_column("unit_cost")
        batch.drop_column("accepted_bottles")
        batch.drop_column("delivered_bottles")
    with op.batch_alter_table("purchase_orders") as batch:
        batch.drop_constraint("fk_po_wastage_user", type_="foreignkey")
        batch.drop_constraint("fk_po_vendor", type_="foreignkey")
        batch.drop_column("wastage_attested_at")
        batch.drop_column("wastage_attested_by_user_id")
        batch.drop_column("wastage_attested")
        batch.drop_column("wastage_reason")
        batch.drop_column("invoice_value")
        batch.drop_column("vendor_invoice_number")
        batch.drop_column("purchase_date")
        batch.drop_column("vendor_id")
