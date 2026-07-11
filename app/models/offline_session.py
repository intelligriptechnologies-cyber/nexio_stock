"""Guarded cashier offline sessions.

An offline session is a deliberate shop-level checkout lock. While a
session is active, syncing, or failed, normal checkout and stock-changing
writes are rejected so offline receipts can be reconciled before the shop
continues operating online.
"""
from __future__ import annotations

import enum
from datetime import date as date_cls
from datetime import datetime
from decimal import Decimal

from sqlalchemy import (
    JSON,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.models.shop import Shop
from app.models.user import User


class OfflineSessionState(enum.StrEnum):
    PREPARING = "preparing"
    ACTIVE = "active"
    SYNCING = "syncing"
    SYNCED = "synced"
    FAILED = "failed"
    DISCARDED = "discarded"
    EXPIRED = "expired"


class OfflineSession(Base):
    __tablename__ = "offline_sessions"
    __table_args__ = (
        Index("ix_offline_sessions_shop_state", "shop_id", "state"),
        Index("ix_offline_sessions_expires_at", "expires_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    shop_id: Mapped[int] = mapped_column(
        ForeignKey("shops.id", ondelete="restrict"), nullable=False, index=True
    )
    cashier_user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="restrict"), nullable=False, index=True
    )
    state: Mapped[OfflineSessionState] = mapped_column(
        Enum(
            OfflineSessionState,
            name="offline_session_state",
            native_enum=False,
            length=32,
            values_callable=lambda e: [m.value for m in e],
        ),
        nullable=False,
        default=OfflineSessionState.PREPARING,
        server_default=OfflineSessionState.PREPARING.value,
    )
    baseline_business_date: Mapped[date_cls] = mapped_column(Date, nullable=False)
    baseline_catalog_snapshot: Mapped[dict] = mapped_column(JSON, nullable=False)
    baseline_stock_snapshot: Mapped[dict] = mapped_column(JSON, nullable=False)
    server_last_invoice_number: Mapped[int] = mapped_column(Integer, nullable=False)
    receipt_counter: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    receipt_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    gross_total: Mapped[Decimal] = mapped_column(
        Numeric(12, 2), nullable=False, default=Decimal("0"), server_default="0"
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    max_expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    extension_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    sync_attempts: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    sync_result: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    failure_reason: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    discard_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    discarded_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="set null"), nullable=True
    )
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    state_changed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    discarded_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    expired_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    shop: Mapped[Shop] = relationship()
    cashier: Mapped[User] = relationship(foreign_keys=[cashier_user_id])
    discarded_by: Mapped[User | None] = relationship(foreign_keys=[discarded_by_user_id])


LOCKING_OFFLINE_STATES: frozenset[OfflineSessionState] = frozenset(
    {
        OfflineSessionState.PREPARING,
        OfflineSessionState.ACTIVE,
        OfflineSessionState.SYNCING,
        OfflineSessionState.FAILED,
    }
)


__all__ = [
    "LOCKING_OFFLINE_STATES",
    "OfflineSession",
    "OfflineSessionState",
]
