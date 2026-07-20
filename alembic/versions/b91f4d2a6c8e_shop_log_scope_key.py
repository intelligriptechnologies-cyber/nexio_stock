"""shops add immutable log scope key

Revision ID: b91f4d2a6c8e
Revises: d0b1a2c3d4e5
Create Date: 2026-07-20 00:00:00.000000
"""
from __future__ import annotations

import uuid

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "b91f4d2a6c8e"
down_revision = "d0b1a2c3d4e5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("shops", sa.Column("log_scope_key", sa.String(length=32), nullable=True))

    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT id FROM shops ORDER BY id")).all()
    for row in rows:
        conn.execute(
            sa.text("UPDATE shops SET log_scope_key = :log_scope_key WHERE id = :shop_id"),
            {"shop_id": row.id, "log_scope_key": uuid.uuid4().hex},
        )

    op.alter_column("shops", "log_scope_key", nullable=False)


def downgrade() -> None:
    op.drop_column("shops", "log_scope_key")
