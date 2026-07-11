"""guarded offline sessions

Revision ID: 8d7a1f2b4c9e
Revises: 4c3d2e1f0a9b
Create Date: 2026-07-11 07:30:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision: str = "8d7a1f2b4c9e"
down_revision: str | None = "4c3d2e1f0a9b"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table(
        "offline_sessions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("shop_id", sa.Integer(), nullable=False),
        sa.Column("cashier_user_id", sa.Integer(), nullable=False),
        sa.Column("state", sa.Enum(
            "preparing",
            "active",
            "syncing",
            "synced",
            "failed",
            "discarded",
            "expired",
            name="offline_session_state",
            native_enum=False,
            length=32,
        ), server_default="preparing", nullable=False),
        sa.Column("baseline_business_date", sa.Date(), nullable=False),
        sa.Column("baseline_catalog_snapshot", sa.JSON(), nullable=False),
        sa.Column("baseline_stock_snapshot", sa.JSON(), nullable=False),
        sa.Column("server_last_invoice_number", sa.Integer(), nullable=False),
        sa.Column("receipt_counter", sa.Integer(), server_default="0", nullable=False),
        sa.Column("receipt_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("gross_total", sa.Numeric(12, 2), server_default="0", nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("max_expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("extension_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column("sync_attempts", sa.Integer(), server_default="0", nullable=False),
        sa.Column("sync_result", sa.JSON(), nullable=True),
        sa.Column("failure_reason", sa.JSON(), nullable=True),
        sa.Column("discard_reason", sa.Text(), nullable=True),
        sa.Column("discarded_by_user_id", sa.Integer(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("state_changed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("discarded_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("expired_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["cashier_user_id"], ["users.id"], ondelete="restrict"),
        sa.ForeignKeyConstraint(["discarded_by_user_id"], ["users.id"], ondelete="set null"),
        sa.ForeignKeyConstraint(["shop_id"], ["shops.id"], ondelete="restrict"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_offline_sessions_expires_at", "offline_sessions", ["expires_at"])
    op.create_index("ix_offline_sessions_shop_id", "offline_sessions", ["shop_id"])
    op.create_index("ix_offline_sessions_cashier_user_id", "offline_sessions", ["cashier_user_id"])
    op.create_index("ix_offline_sessions_shop_state", "offline_sessions", ["shop_id", "state"])


def downgrade() -> None:
    op.drop_index("ix_offline_sessions_shop_state", table_name="offline_sessions")
    op.drop_index("ix_offline_sessions_cashier_user_id", table_name="offline_sessions")
    op.drop_index("ix_offline_sessions_shop_id", table_name="offline_sessions")
    op.drop_index("ix_offline_sessions_expires_at", table_name="offline_sessions")
    op.drop_table("offline_sessions")
