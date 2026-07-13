"""vendors and lot purchase details

Revision ID: 9a7b6c5d4e3f
Revises: f66dd42ad7e7
Create Date: 2026-07-13 21:30:00.000000

"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "9a7b6c5d4e3f"
down_revision: str | Sequence[str] | None = "f66dd42ad7e7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "vendors",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("shop_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("gstin", sa.String(length=15), nullable=True),
        sa.Column("address", sa.String(length=500), nullable=True),
        sa.Column("email", sa.String(length=255), nullable=True),
        sa.Column("phone", sa.String(length=20), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["shop_id"], ["shops.id"], ondelete="restrict"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_vendors_shop_id"), "vendors", ["shop_id"], unique=False)
    op.create_index("ix_vendors_shop_active_name", "vendors", ["shop_id", "is_active", "name"], unique=False)

    op.add_column("lots", sa.Column("vendor_id", sa.Integer(), nullable=True))
    op.add_column("lots", sa.Column("purchase_date", sa.Date(), nullable=True))
    op.add_column("lots", sa.Column("vendor_invoice_number", sa.String(length=100), nullable=True))
    op.add_column("lots", sa.Column("invoice_value", sa.Numeric(12, 2), nullable=True))
    op.add_column(
        "lot_lines",
        sa.Column("good_condition_quantity", sa.Integer(), nullable=True),
    )

    conn = op.get_bind()
    shop_ids = [row[0] for row in conn.execute(sa.text("SELECT id FROM shops ORDER BY id")).all()]
    for shop_id in shop_ids:
        vendor_id = conn.execute(
            sa.text(
                """
                INSERT INTO vendors (shop_id, name, gstin, address, email, phone, is_active)
                VALUES (:shop_id, :name, NULL, NULL, NULL, NULL, true)
                RETURNING id
                """
            ),
            {"shop_id": shop_id, "name": "Legacy vendor"},
        ).scalar_one()
        conn.execute(
            sa.text(
                """
                UPDATE lots
                SET vendor_id = :vendor_id,
                    purchase_date = COALESCE(purchase_date, COALESCE(received_at::date, CURRENT_DATE)),
                    vendor_invoice_number = COALESCE(vendor_invoice_number, COALESCE(reference, CONCAT('LEGACY-', id::text))),
                    invoice_value = COALESCE(invoice_value, 0.00)
                WHERE shop_id = :shop_id
                """
            ),
            {"vendor_id": vendor_id, "shop_id": shop_id},
        )

    conn.execute(
        sa.text(
            """
            UPDATE lot_lines
            SET good_condition_quantity = quantity
            WHERE good_condition_quantity IS NULL
            """
        )
    )

    op.alter_column("lots", "vendor_id", nullable=False)
    op.alter_column("lots", "purchase_date", nullable=False)
    op.alter_column("lots", "vendor_invoice_number", nullable=False)
    op.alter_column("lots", "invoice_value", nullable=False)
    op.alter_column("lot_lines", "good_condition_quantity", nullable=False)
    op.create_foreign_key(
        "fk_lots_vendor_id",
        "lots",
        "vendors",
        ["vendor_id"],
        ["id"],
        ondelete="restrict",
    )
    op.create_index(op.f("ix_lots_vendor_id"), "lots", ["vendor_id"], unique=False)
    op.create_index("ix_lots_shop_purchase_date", "lots", ["shop_id", "purchase_date"], unique=False)
    op.create_check_constraint(
        "ck_lot_lines_good_condition_quantity",
        "lot_lines",
        "good_condition_quantity >= 0 AND good_condition_quantity <= quantity",
    )


def downgrade() -> None:
    op.drop_constraint("ck_lot_lines_good_condition_quantity", "lot_lines", type_="check")
    op.drop_index("ix_lots_shop_purchase_date", table_name="lots")
    op.drop_index(op.f("ix_lots_vendor_id"), table_name="lots")
    op.drop_constraint("fk_lots_vendor_id", "lots", type_="foreignkey")
    op.drop_column("lot_lines", "good_condition_quantity")
    op.drop_column("lots", "invoice_value")
    op.drop_column("lots", "vendor_invoice_number")
    op.drop_column("lots", "purchase_date")
    op.drop_column("lots", "vendor_id")
    op.drop_index("ix_vendors_shop_active_name", table_name="vendors")
    op.drop_index(op.f("ix_vendors_shop_id"), table_name="vendors")
    op.drop_table("vendors")
