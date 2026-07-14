"""users: personal profile fields for owner/superadmin settings

Adds own-profile fields required by the new Settings > Security section.
These are nullable so existing accounts migrate without disruption.

Revision ID: d0b1a2c3d4e5
Revises: c1a2b3c4d5e6
Create Date: 2026-07-15 00:00:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "d0b1a2c3d4e5"
down_revision: str | Sequence[str] | None = "c1a2b3c4d5e6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("email", sa.String(length=255), nullable=True))
    op.add_column("users", sa.Column("date_of_birth", sa.Date(), nullable=True))
    op.add_column("users", sa.Column("pan", sa.String(length=10), nullable=True))
    op.add_column("users", sa.Column("gstin", sa.String(length=15), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "gstin")
    op.drop_column("users", "pan")
    op.drop_column("users", "date_of_birth")
    op.drop_column("users", "email")
