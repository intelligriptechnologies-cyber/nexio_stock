"""log file retention settings

Revision ID: 91b6a43f0c2d
Revises: 8d7a1f2b4c9e
Create Date: 2026-07-11 14:10:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision: str = "91b6a43f0c2d"
down_revision: str | None = "8d7a1f2b4c9e"
branch_labels: str | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table(
        "log_file_retention_settings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("shop_id", sa.Integer(), nullable=True),
        sa.Column("log_type", sa.String(length=32), nullable=False),
        sa.Column("retention_days", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["shop_id"], ["shops.id"], ondelete="cascade"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("shop_id", "log_type", name="uq_log_file_retention_shop_type"),
    )
    op.create_index("ix_log_file_retention_settings_shop_id", "log_file_retention_settings", ["shop_id"])
    op.create_index(
        "ix_log_file_retention_shop_type",
        "log_file_retention_settings",
        ["shop_id", "log_type"],
    )


def downgrade() -> None:
    op.drop_index("ix_log_file_retention_shop_type", table_name="log_file_retention_settings")
    op.drop_index("ix_log_file_retention_settings_shop_id", table_name="log_file_retention_settings")
    op.drop_table("log_file_retention_settings")
