"""master products and shop-specific catalog rows

Revision ID: e6b1a6f8c9d2
Revises: a9c4f9d2b7e1
Create Date: 2026-07-09 13:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision: str = "e6b1a6f8c9d2"
down_revision: str | None = "a9c4f9d2b7e1"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table(
        "master_products",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("barcode", sa.String(length=64), nullable=False),
        sa.Column("brand", sa.String(length=200), nullable=False),
        sa.Column("size_label", sa.String(length=64), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("barcode", name="uq_master_products_barcode"),
    )
    op.add_column("products", sa.Column("master_product_id", sa.Integer(), nullable=True))

    op.execute(
        """
        INSERT INTO master_products (barcode, brand, size_label, is_active)
        SELECT DISTINCT ON (barcode) barcode, brand, size_label, true
        FROM products
        ORDER BY barcode, id
        """
    )
    op.execute(
        """
        UPDATE products p
        SET master_product_id = mp.id
        FROM master_products mp
        WHERE mp.barcode = p.barcode
        """
    )

    op.alter_column("products", "master_product_id", nullable=False)
    op.create_foreign_key(
        "fk_products_master_product_id_master_products",
        "products",
        "master_products",
        ["master_product_id"],
        ["id"],
        ondelete="restrict",
    )
    op.create_index(
        "ix_products_master_product_id",
        "products",
        ["master_product_id"],
    )
    op.create_index(
        "ix_products_shop_master_product",
        "products",
        ["shop_id", "master_product_id"],
    )
    op.create_unique_constraint(
        "uq_products_shop_master_product",
        "products",
        ["shop_id", "master_product_id"],
    )

    op.drop_index("ix_products_shop_barcode", table_name="products")
    op.drop_index("ix_products_shop_brand", table_name="products")
    op.drop_constraint("products_barcode_key", "products", type_="unique")
    op.drop_column("products", "barcode")
    op.drop_column("products", "brand")
    op.drop_column("products", "size_label")


def downgrade() -> None:
    op.add_column("products", sa.Column("barcode", sa.String(length=64), nullable=True))
    op.add_column("products", sa.Column("brand", sa.String(length=200), nullable=True))
    op.add_column("products", sa.Column("size_label", sa.String(length=64), nullable=True))
    op.execute(
        """
        UPDATE products p
        SET barcode = mp.barcode,
            brand = mp.brand,
            size_label = mp.size_label
        FROM master_products mp
        WHERE mp.id = p.master_product_id
        """
    )
    op.alter_column("products", "barcode", nullable=False)
    op.alter_column("products", "brand", nullable=False)
    op.alter_column("products", "size_label", nullable=False)
    op.drop_constraint("uq_products_shop_master_product", "products", type_="unique")
    op.drop_index("ix_products_shop_master_product", table_name="products")
    op.drop_index("ix_products_master_product_id", table_name="products")
    op.drop_constraint("fk_products_master_product_id_master_products", "products", type_="foreignkey")
    op.drop_column("products", "master_product_id")
    op.create_unique_constraint("products_barcode_key", "products", ["barcode"])
    op.create_index("ix_products_shop_brand", "products", ["shop_id", "brand"])
    op.create_index("ix_products_shop_barcode", "products", ["shop_id", "barcode"])
    op.drop_table("master_products")
