"""shops: configurable active tab color

Revision ID: 4c3d2e1f0a9b
Revises: 2f0d9c8b7a61
Create Date: 2026-07-09 16:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision: str = "4c3d2e1f0a9b"
down_revision: str | None = "2f0d9c8b7a61"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.add_column(
        "shops",
        sa.Column(
            "active_tab_color",
            sa.String(length=7),
            server_default="#5a5148",
            nullable=False,
        ),
    )


def downgrade() -> None:
    op.drop_column("shops", "active_tab_color")
