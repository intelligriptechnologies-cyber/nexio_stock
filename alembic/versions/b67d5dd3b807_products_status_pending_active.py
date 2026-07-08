"""products: status (pending | active) + nullable price for pending rows

Revision ID: b67d5dd3b807
Revises: f66dd42ad7e7
Create Date: 2026-07-07 23:10:00.000000

Issue #22 — provisional product quick-add. A pending product is a real
Product row everywhere (lots, stock views, catalog) — just unsellable
and unpriced. Existing rows migrate to ``status='active'`` and keep
their ``price`` (which stays NOT NULL once the backfill completes).
"""
from typing import Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "b67d5dd3b807"
down_revision: Union[str, None] = "f66dd42ad7e7"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    """Upgrade schema.

    1. Add ``status`` column with default 'active' so existing rows backfill.
    2. Make ``price`` nullable — a pending product has no price.
    3. Add CHECK constraint that price is non-null when status='active'
       (Pydantic enforces this on the wire; the CHECK is a belt-and-braces
       defense for direct-SQL writes).

    The order matters: column-add with server_default runs once per row,
    so the existing 1000+ rows are backfilled in-place. Then we drop the
    NOT NULL on price. Finally the CHECK ties the two together.
    """
    op.add_column(
        "products",
        sa.Column(
            "status",
            sa.String(length=16),
            nullable=False,
            server_default=sa.text("'active'"),
        ),
    )
    # Backfill index for "list pending products for shop" (issue #25).
    op.create_index(
        "ix_products_shop_status",
        "products",
        ["shop_id", "status"],
    )
    # Drop NOT NULL on price. Pending rows will have NULL.
    op.alter_column("products", "price", existing_type=sa.Numeric(precision=12, scale=2), nullable=True)
    # CHECK: active rows must have a price > 0; pending rows must have NULL.
    op.create_check_constraint(
        "ck_products_price_iff_active",
        "products",
        "(status = 'pending' AND price IS NULL) OR (status = 'active' AND price IS NOT NULL AND price > 0)",
    )


def downgrade() -> None:
    """Downgrade schema.

    Drops CHECK, restores NOT NULL on price (will fail if any pending rows
    remain — caller must complete/activate them first), drops the index
    and the ``status`` column.
    """
    op.drop_constraint("ck_products_price_iff_active", "products", type_="check")
    op.alter_column("products", "price", existing_type=sa.Numeric(precision=12, scale=2), nullable=False)
    op.drop_index("ix_products_shop_status", table_name="products")
    op.drop_column("products", "status")