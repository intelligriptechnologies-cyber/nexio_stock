"""shop and user two-factor auth

Revision ID: e2f4a6b8c0d2
Revises: b91f4d2a6c8e
Create Date: 2026-07-27 00:00:00.000000
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = "e2f4a6b8c0d2"
down_revision = "b91f4d2a6c8e"
branch_labels = None
depends_on = None


two_factor_subject_type = sa.Enum(
    "shop",
    "user",
    name="two_factor_subject_type",
    native_enum=False,
    length=16,
)
two_factor_factor_subject_type = sa.Enum(
    "shop",
    "user",
    name="two_factor_factor_subject_type",
    native_enum=False,
    length=16,
)


def upgrade() -> None:
    two_factor_subject_type.create(op.get_bind(), checkfirst=True)
    two_factor_factor_subject_type.create(op.get_bind(), checkfirst=True)

    op.add_column(
        "shops",
        sa.Column("two_factor_enabled", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column("shops", sa.Column("two_factor_secret_version", sa.Integer(), nullable=True))
    op.add_column("shops", sa.Column("two_factor_rotated_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "shops",
        sa.Column(
            "two_factor_required_for_roles",
            postgresql.ARRAY(sa.String()),
            nullable=False,
            server_default=sa.text("'{owner,cashier_user,receiver_user}'::varchar[]"),
        ),
    )

    op.add_column(
        "users",
        sa.Column("two_factor_enabled", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column("users", sa.Column("two_factor_secret_version", sa.Integer(), nullable=True))
    op.add_column("users", sa.Column("two_factor_rotated_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("two_factor_disabled_at", sa.DateTime(timezone=True), nullable=True))

    op.create_table(
        "two_factor_secrets",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("subject_type", two_factor_subject_type, nullable=False),
        sa.Column("shop_id", sa.Integer(), nullable=True),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("secret_ciphertext", sa.String(length=2048), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_by_user_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("retired_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "(subject_type = 'shop' AND shop_id IS NOT NULL AND user_id IS NULL) OR "
            "(subject_type = 'user' AND user_id IS NOT NULL AND shop_id IS NULL)",
            name="ck_two_factor_secrets_subject_target",
        ),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="set null"),
        sa.ForeignKeyConstraint(["shop_id"], ["shops.id"], ondelete="cascade"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="cascade"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("subject_type", "shop_id", "version", name="uq_two_factor_secrets_shop_version"),
        sa.UniqueConstraint("subject_type", "user_id", "version", name="uq_two_factor_secrets_user_version"),
    )
    op.create_index("ix_two_factor_secrets_subject_type", "two_factor_secrets", ["subject_type"])
    op.create_index("ix_two_factor_secrets_shop_id", "two_factor_secrets", ["shop_id"])
    op.create_index("ix_two_factor_secrets_user_id", "two_factor_secrets", ["user_id"])
    op.create_index("ix_two_factor_secrets_created_by_user_id", "two_factor_secrets", ["created_by_user_id"])
    op.create_index(
        "ix_two_factor_secrets_active_shop",
        "two_factor_secrets",
        ["shop_id"],
        unique=True,
        postgresql_where=sa.text("is_active = true AND subject_type = 'shop'"),
    )
    op.create_index(
        "ix_two_factor_secrets_active_user",
        "two_factor_secrets",
        ["user_id"],
        unique=True,
        postgresql_where=sa.text("is_active = true AND subject_type = 'user'"),
    )

    op.create_table(
        "pending_auth_challenges",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("challenge_token_hash", sa.String(length=128), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("shop_id", sa.Integer(), nullable=True),
        sa.Column("factor_subject_type", two_factor_factor_subject_type, nullable=False),
        sa.Column("factor_shop_id", sa.Integer(), nullable=True),
        sa.Column("factor_user_id", sa.Integer(), nullable=True),
        sa.Column("factor_secret_version", sa.Integer(), nullable=False),
        sa.Column("device_key_hash", sa.String(length=128), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("failed_attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("last_failed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["factor_shop_id"], ["shops.id"], ondelete="cascade"),
        sa.ForeignKeyConstraint(["factor_user_id"], ["users.id"], ondelete="cascade"),
        sa.ForeignKeyConstraint(["shop_id"], ["shops.id"], ondelete="cascade"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="cascade"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("challenge_token_hash"),
    )
    op.create_index(
        "ix_pending_auth_challenges_challenge_token_hash",
        "pending_auth_challenges",
        ["challenge_token_hash"],
    )
    op.create_index("ix_pending_auth_challenges_user_id", "pending_auth_challenges", ["user_id"])
    op.create_index("ix_pending_auth_challenges_shop_id", "pending_auth_challenges", ["shop_id"])
    op.create_index("ix_pending_auth_challenges_factor_shop_id", "pending_auth_challenges", ["factor_shop_id"])
    op.create_index("ix_pending_auth_challenges_factor_user_id", "pending_auth_challenges", ["factor_user_id"])
    op.create_index(
        "ix_pending_auth_challenges_user_created",
        "pending_auth_challenges",
        ["user_id", "created_at"],
    )
    op.create_index(
        "ix_pending_auth_challenges_shop_created",
        "pending_auth_challenges",
        ["shop_id", "created_at"],
    )
    op.create_index(
        "ix_pending_auth_challenges_expiry",
        "pending_auth_challenges",
        ["expires_at", "consumed_at"],
    )

    op.create_table(
        "authenticator_activations",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("shop_id", sa.Integer(), nullable=False),
        sa.Column("secret_version", sa.Integer(), nullable=False),
        sa.Column("machine_label", sa.String(length=120), nullable=True),
        sa.Column("machine_fingerprint_hash", sa.String(length=128), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("activated_by_user_id", sa.Integer(), nullable=True),
        sa.Column("activated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deactivated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["activated_by_user_id"], ["users.id"], ondelete="set null"),
        sa.ForeignKeyConstraint(["shop_id"], ["shops.id"], ondelete="cascade"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_authenticator_activations_shop_id", "authenticator_activations", ["shop_id"])
    op.create_index(
        "ix_authenticator_activations_machine_fingerprint_hash",
        "authenticator_activations",
        ["machine_fingerprint_hash"],
    )
    op.create_index(
        "ix_authenticator_activations_shop_active",
        "authenticator_activations",
        ["shop_id", "is_active"],
    )
    op.create_index(
        "ix_authenticator_activations_activated_by_user_id",
        "authenticator_activations",
        ["activated_by_user_id"],
    )

    op.create_table(
        "authenticator_activation_tokens",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("token_hash", sa.String(length=128), nullable=False),
        sa.Column("shop_id", sa.Integer(), nullable=False),
        sa.Column("secret_version", sa.Integer(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_by_user_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="restrict"),
        sa.ForeignKeyConstraint(["shop_id"], ["shops.id"], ondelete="cascade"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index(
        "ix_authenticator_activation_tokens_token_hash",
        "authenticator_activation_tokens",
        ["token_hash"],
    )
    op.create_index(
        "ix_authenticator_activation_tokens_shop_id",
        "authenticator_activation_tokens",
        ["shop_id"],
    )
    op.create_index(
        "ix_authenticator_activation_tokens_created_by_user_id",
        "authenticator_activation_tokens",
        ["created_by_user_id"],
    )
    op.create_index(
        "ix_authenticator_activation_tokens_shop_created",
        "authenticator_activation_tokens",
        ["shop_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_authenticator_activation_tokens_shop_created", table_name="authenticator_activation_tokens")
    op.drop_index("ix_authenticator_activation_tokens_created_by_user_id", table_name="authenticator_activation_tokens")
    op.drop_index("ix_authenticator_activation_tokens_shop_id", table_name="authenticator_activation_tokens")
    op.drop_index("ix_authenticator_activation_tokens_token_hash", table_name="authenticator_activation_tokens")
    op.drop_table("authenticator_activation_tokens")

    op.drop_index("ix_authenticator_activations_activated_by_user_id", table_name="authenticator_activations")
    op.drop_index("ix_authenticator_activations_shop_active", table_name="authenticator_activations")
    op.drop_index("ix_authenticator_activations_machine_fingerprint_hash", table_name="authenticator_activations")
    op.drop_index("ix_authenticator_activations_shop_id", table_name="authenticator_activations")
    op.drop_table("authenticator_activations")

    op.drop_index("ix_pending_auth_challenges_expiry", table_name="pending_auth_challenges")
    op.drop_index("ix_pending_auth_challenges_shop_created", table_name="pending_auth_challenges")
    op.drop_index("ix_pending_auth_challenges_user_created", table_name="pending_auth_challenges")
    op.drop_index("ix_pending_auth_challenges_factor_user_id", table_name="pending_auth_challenges")
    op.drop_index("ix_pending_auth_challenges_factor_shop_id", table_name="pending_auth_challenges")
    op.drop_index("ix_pending_auth_challenges_shop_id", table_name="pending_auth_challenges")
    op.drop_index("ix_pending_auth_challenges_user_id", table_name="pending_auth_challenges")
    op.drop_index("ix_pending_auth_challenges_challenge_token_hash", table_name="pending_auth_challenges")
    op.drop_table("pending_auth_challenges")

    op.drop_index("ix_two_factor_secrets_active_user", table_name="two_factor_secrets")
    op.drop_index("ix_two_factor_secrets_active_shop", table_name="two_factor_secrets")
    op.drop_index("ix_two_factor_secrets_created_by_user_id", table_name="two_factor_secrets")
    op.drop_index("ix_two_factor_secrets_user_id", table_name="two_factor_secrets")
    op.drop_index("ix_two_factor_secrets_shop_id", table_name="two_factor_secrets")
    op.drop_index("ix_two_factor_secrets_subject_type", table_name="two_factor_secrets")
    op.drop_table("two_factor_secrets")

    op.drop_column("users", "two_factor_disabled_at")
    op.drop_column("users", "two_factor_rotated_at")
    op.drop_column("users", "two_factor_secret_version")
    op.drop_column("users", "two_factor_enabled")

    op.drop_column("shops", "two_factor_required_for_roles")
    op.drop_column("shops", "two_factor_rotated_at")
    op.drop_column("shops", "two_factor_secret_version")
    op.drop_column("shops", "two_factor_enabled")

    two_factor_factor_subject_type.drop(op.get_bind(), checkfirst=True)
    two_factor_subject_type.drop(op.get_bind(), checkfirst=True)
