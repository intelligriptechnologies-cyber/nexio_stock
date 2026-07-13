"""shops: allowed_login_cidrs for login IP allowlist

Revision ID: c8f1d4ef2b7e
Revises: 91b6a43f0c2d
Create Date: 2026-07-12 00:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "c8f1d4ef2b7e"
down_revision: str | None = "91b6a43f0c2d"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        "shops",
        sa.Column(
            "allowed_login_cidrs",
            postgresql.ARRAY(sa.String()),
            nullable=False,
            server_default=sa.text("'{}'::varchar[]"),
        ),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("shops", "allowed_login_cidrs")
