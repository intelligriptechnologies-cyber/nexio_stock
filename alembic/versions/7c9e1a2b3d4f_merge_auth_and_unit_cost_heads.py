"""merge auth and unit cost heads

Revision ID: 7c9e1a2b3d4f
Revises: e2f4a6b8c0d2, f1a2b3c4d5e6
Create Date: 2026-08-25 19:35:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence


revision: str = "7c9e1a2b3d4f"
down_revision: str | Sequence[str] | None = ("e2f4a6b8c0d2", "f1a2b3c4d5e6")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Merge heads only."""


def downgrade() -> None:
    """Downgrade merge only."""
