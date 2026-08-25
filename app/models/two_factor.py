"""Two-factor auth persistence models."""
from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

if TYPE_CHECKING:
    from app.models.shop import Shop
    from app.models.user import User


class TwoFactorSubjectType(enum.StrEnum):
    SHOP = "shop"
    USER = "user"


_TWO_FACTOR_SUBJECT_ENUM = Enum(
    TwoFactorSubjectType,
    name="two_factor_subject_type",
    native_enum=False,
    length=16,
    values_callable=lambda enum_cls: [member.value for member in enum_cls],
)

_TWO_FACTOR_FACTOR_SUBJECT_ENUM = Enum(
    TwoFactorSubjectType,
    name="two_factor_factor_subject_type",
    native_enum=False,
    length=16,
    values_callable=lambda enum_cls: [member.value for member in enum_cls],
)


class TwoFactorSecret(Base):
    __tablename__ = "two_factor_secrets"
    __table_args__ = (
        CheckConstraint(
            "(subject_type = 'shop' AND shop_id IS NOT NULL AND user_id IS NULL) OR "
            "(subject_type = 'user' AND user_id IS NOT NULL AND shop_id IS NULL)",
            name="ck_two_factor_secrets_subject_target",
        ),
        UniqueConstraint(
            "subject_type",
            "shop_id",
            "version",
            name="uq_two_factor_secrets_shop_version",
        ),
        UniqueConstraint(
            "subject_type",
            "user_id",
            "version",
            name="uq_two_factor_secrets_user_version",
        ),
        Index(
            "ix_two_factor_secrets_active_shop",
            "shop_id",
            unique=True,
            postgresql_where=text("is_active = true AND subject_type = 'shop'"),
        ),
        Index(
            "ix_two_factor_secrets_active_user",
            "user_id",
            unique=True,
            postgresql_where=text("is_active = true AND subject_type = 'user'"),
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    subject_type: Mapped[TwoFactorSubjectType] = mapped_column(_TWO_FACTOR_SUBJECT_ENUM, nullable=False, index=True)
    shop_id: Mapped[int | None] = mapped_column(
        ForeignKey("shops.id", ondelete="cascade"),
        nullable=True,
        index=True,
    )
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="cascade"),
        nullable=True,
        index=True,
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    secret_ciphertext: Mapped[str] = mapped_column(String(2048), nullable=False)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true"
    )
    created_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="set null"),
        nullable=True,
        index=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    retired_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    shop: Mapped[Shop | None] = relationship(foreign_keys=[shop_id])
    user: Mapped[User | None] = relationship(foreign_keys=[user_id])
    created_by: Mapped[User | None] = relationship(foreign_keys=[created_by_user_id])


class PendingAuthChallenge(Base):
    __tablename__ = "pending_auth_challenges"
    __table_args__ = (
        Index("ix_pending_auth_challenges_user_created", "user_id", "created_at"),
        Index("ix_pending_auth_challenges_shop_created", "shop_id", "created_at"),
        Index("ix_pending_auth_challenges_expiry", "expires_at", "consumed_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    challenge_token_hash: Mapped[str] = mapped_column(
        String(128), nullable=False, unique=True, index=True
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="cascade"), nullable=False, index=True
    )
    shop_id: Mapped[int | None] = mapped_column(
        ForeignKey("shops.id", ondelete="cascade"),
        nullable=True,
        index=True,
    )
    factor_subject_type: Mapped[TwoFactorSubjectType] = mapped_column(
        _TWO_FACTOR_FACTOR_SUBJECT_ENUM, nullable=False
    )
    factor_shop_id: Mapped[int | None] = mapped_column(
        ForeignKey("shops.id", ondelete="cascade"),
        nullable=True,
        index=True,
    )
    factor_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="cascade"),
        nullable=True,
        index=True,
    )
    factor_secret_version: Mapped[int] = mapped_column(Integer, nullable=False)
    device_key_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    failed_attempts: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    last_failed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    user: Mapped[User] = relationship(foreign_keys=[user_id])
    shop: Mapped[Shop | None] = relationship(foreign_keys=[shop_id])
    factor_shop: Mapped[Shop | None] = relationship(foreign_keys=[factor_shop_id])
    factor_user: Mapped[User | None] = relationship(foreign_keys=[factor_user_id])


class AuthenticatorActivation(Base):
    __tablename__ = "authenticator_activations"
    __table_args__ = (
        Index("ix_authenticator_activations_shop_active", "shop_id", "is_active"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    shop_id: Mapped[int] = mapped_column(
        ForeignKey("shops.id", ondelete="cascade"), nullable=False, index=True
    )
    secret_version: Mapped[int] = mapped_column(Integer, nullable=False)
    machine_label: Mapped[str | None] = mapped_column(String(120), nullable=True)
    machine_fingerprint_hash: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true"
    )
    activated_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="set null"),
        nullable=True,
        index=True,
    )
    activated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deactivated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    shop: Mapped[Shop] = relationship(foreign_keys=[shop_id])
    activated_by: Mapped[User | None] = relationship(foreign_keys=[activated_by_user_id])


class AuthenticatorActivationToken(Base):
    __tablename__ = "authenticator_activation_tokens"
    __table_args__ = (
        Index("ix_authenticator_activation_tokens_shop_created", "shop_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    token_hash: Mapped[str] = mapped_column(String(128), nullable=False, unique=True, index=True)
    shop_id: Mapped[int] = mapped_column(
        ForeignKey("shops.id", ondelete="cascade"), nullable=False, index=True
    )
    secret_version: Mapped[int] = mapped_column(Integer, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_by_user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="restrict"), nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    shop: Mapped[Shop] = relationship(foreign_keys=[shop_id])
    created_by: Mapped[User] = relationship(foreign_keys=[created_by_user_id])
