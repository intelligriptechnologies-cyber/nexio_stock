"""shop cashier restriction and receiving vendor-link toggles

Revision ID: 9d4a7c2b1e8f
Revises: 3e2f1a0b9c8d
Create Date: 2026-07-14 00:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision: str = "9d4a7c2b1e8f"
down_revision: str | None = "3e2f1a0b9c8d"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "shops",
        sa.Column(
            "cashier_login_restriction_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )
    op.add_column(
        "shops",
        sa.Column(
            "receiving_vendor_link_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
    )
    op.alter_column("lots", "vendor_id", existing_type=sa.Integer(), nullable=True)


def downgrade() -> None:
    """Downgrade schema."""
    op.alter_column("lots", "vendor_id", existing_type=sa.Integer(), nullable=False)
    op.drop_column("shops", "receiving_vendor_link_enabled")
    op.drop_column("shops", "cashier_login_restriction_enabled")
