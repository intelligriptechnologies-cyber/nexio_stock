"""shops: configurable sidebar menu text colors

Revision ID: 2f0d9c8b7a61
Revises: e6b1a6f8c9d2
Create Date: 2026-07-09 15:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision: str = "2f0d9c8b7a61"
down_revision: str | None = "e6b1a6f8c9d2"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.execute("UPDATE shops SET app_display_name = 'BarStock' WHERE app_display_name IS NULL")
    op.alter_column("shops", "app_display_name", server_default="BarStock")
    op.add_column(
        "shops",
        sa.Column(
            "sidebar_menu_inactive_text_color",
            sa.String(length=9),
            server_default="#535353cf",
            nullable=False,
        ),
    )
    op.add_column(
        "shops",
        sa.Column(
            "sidebar_menu_active_text_color",
            sa.String(length=9),
            server_default="#ffffff",
            nullable=False,
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("shops", "sidebar_menu_active_text_color")
    op.drop_column("shops", "sidebar_menu_inactive_text_color")
    op.alter_column("shops", "app_display_name", server_default=None)
