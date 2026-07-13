"""device bindings + global usernames for device-bound shop login

Revision ID: 2c6d8b7a1e4f
Revises: c8f1d4ef2b7e
Create Date: 2026-07-13 21:30:00.000000
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "2c6d8b7a1e4f"
down_revision: str | Sequence[str] | None = "c8f1d4ef2b7e"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    op.drop_constraint("uq_users_shop_username", "users", type_="unique")
    op.drop_index("uq_users_username_superadmin", table_name="users")
    op.create_unique_constraint("uq_users_username", "users", ["username"])

    op.create_table(
        "device_bindings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("device_key", sa.String(length=64), nullable=False),
        sa.Column("shop_id", sa.Integer(), nullable=False),
        sa.Column("counter_name", sa.String(length=80), nullable=True),
        sa.Column(
            "is_active",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
        sa.Column("registered_by_user_id", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["registered_by_user_id"], ["users.id"], ondelete="set null"),
        sa.ForeignKeyConstraint(["shop_id"], ["shops.id"], ondelete="restrict"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("device_key", name="uq_device_bindings_device_key"),
    )
    op.create_index("ix_device_bindings_shop_id", "device_bindings", ["shop_id"], unique=False)
    op.create_index(
        "ix_device_bindings_registered_by_user_id",
        "device_bindings",
        ["registered_by_user_id"],
        unique=False,
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index("ix_device_bindings_registered_by_user_id", table_name="device_bindings")
    op.drop_index("ix_device_bindings_shop_id", table_name="device_bindings")
    op.drop_table("device_bindings")

    op.drop_constraint("uq_users_username", "users", type_="unique")
    op.create_index(
        "uq_users_username_superadmin",
        "users",
        ["username"],
        unique=True,
        postgresql_where=sa.text("shop_id IS NULL"),
    )
    op.create_unique_constraint("uq_users_shop_username", "users", ["shop_id", "username"])
