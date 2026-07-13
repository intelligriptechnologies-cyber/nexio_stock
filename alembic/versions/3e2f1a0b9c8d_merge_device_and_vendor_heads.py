"""merge device-binding and vendor migration heads

Revision ID: 3e2f1a0b9c8d
Revises: 2c6d8b7a1e4f, 9a7b6c5d4e3f
Create Date: 2026-07-13 22:15:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

revision: str = "3e2f1a0b9c8d"
down_revision: str | Sequence[str] | None = ("2c6d8b7a1e4f", "9a7b6c5d4e3f")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Merge heads only."""


def downgrade() -> None:
    """Downgrade merge only."""
