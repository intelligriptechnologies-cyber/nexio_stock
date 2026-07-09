"""shops: per-shop app and email settings

Revision ID: 7b1e86a4f0c2
Revises: d323bd1fc4d8
Create Date: 2026-07-09 11:00:00.000000

"""
from typing import Union

from alembic import op
import sqlalchemy as sa


revision: str = "7b1e86a4f0c2"
down_revision: Union[str, None] = "d323bd1fc4d8"
branch_labels: Union[str, None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("shops", sa.Column("app_display_name", sa.String(length=80), nullable=True))
    op.add_column(
        "shops",
        sa.Column(
            "action_color",
            sa.String(length=7),
            server_default="#22c55e",
            nullable=False,
        ),
    )
    op.add_column(
        "shops",
        sa.Column("email_enabled", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )
    op.add_column("shops", sa.Column("smtp_host", sa.String(length=255), nullable=True))
    op.add_column("shops", sa.Column("smtp_port", sa.Integer(), nullable=True))
    op.add_column("shops", sa.Column("smtp_username", sa.String(length=255), nullable=True))
    op.add_column("shops", sa.Column("smtp_password", sa.String(length=1024), nullable=True))
    op.add_column("shops", sa.Column("smtp_from_email", sa.String(length=255), nullable=True))
    op.add_column("shops", sa.Column("smtp_from_name", sa.String(length=255), nullable=True))
    op.add_column(
        "shops",
        sa.Column("smtp_use_tls", sa.Boolean(), server_default=sa.text("true"), nullable=False),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("shops", "smtp_use_tls")
    op.drop_column("shops", "smtp_from_name")
    op.drop_column("shops", "smtp_from_email")
    op.drop_column("shops", "smtp_password")
    op.drop_column("shops", "smtp_username")
    op.drop_column("shops", "smtp_port")
    op.drop_column("shops", "smtp_host")
    op.drop_column("shops", "email_enabled")
    op.drop_column("shops", "action_color")
    op.drop_column("shops", "app_display_name")
