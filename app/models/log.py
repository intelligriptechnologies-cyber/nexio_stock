"""Domain-specific business event log tables (R-37, D-47, D-49).

These are NOT a unified audit log (D-46 superseded). Each domain table holds
events meaningful to its slice, with payload-as-JSONB for slice-specific
fields, so the screen that triggered the event can render history without
joining a generic log table.

  invoicing_logs  — cart opened, item scanned/removed, checkout finalized,
                    void requested/approved/rejected (#2, #4, #5)
  stockin_logs    — lot received, line items+quantities, receiving user (#3)
  admin_logs      — superadmin cross-shop access, other cross-cutting ops
                    (D-28, R-5)

All three are append-only. They are part of the product's audit trail
(R-39) and survive the same indefinite retention as everything else
(R-19, D-36).
"""
from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import (
    JSON,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

if TYPE_CHECKING:
    from app.models.shop import Shop
    from app.models.user import User


class _BaseLog(Base):
    """Shared columns for every business event log table."""

    __abstract__ = True

    id: Mapped[int] = mapped_column(primary_key=True)
    shop_id: Mapped[int | None] = mapped_column(
        ForeignKey("shops.id", ondelete="restrict"),
        nullable=True,  # nullable for system / cross-shop superadmin events
        index=True,
    )
    actor_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="set null"),
        nullable=True,
        index=True,
    )
    event_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class InvoicingLog(_BaseLog):
    __tablename__ = "invoicing_logs"
    __table_args__ = (
        Index("ix_invoicing_logs_shop_created", "shop_id", "created_at"),
    )

    shop: Mapped[Shop | None] = relationship()
    actor_user: Mapped[User | None] = relationship()


class StockinLog(_BaseLog):
    __tablename__ = "stockin_logs"
    __table_args__ = (
        Index("ix_stockin_logs_shop_created", "shop_id", "created_at"),
    )

    shop: Mapped[Shop | None] = relationship()
    actor_user: Mapped[User | None] = relationship()


class AdminLog(_BaseLog):
    __tablename__ = "admin_logs"
    __table_args__ = (
        Index("ix_admin_logs_shop_created", "shop_id", "created_at"),
    )

    shop: Mapped[Shop | None] = relationship()
    actor_user: Mapped[User | None] = relationship()


class LogFileRetentionSetting(Base):
    """Per-shop retention setting for daily text log files."""

    __tablename__ = "log_file_retention_settings"
    __table_args__ = (
        UniqueConstraint("shop_id", "log_type", name="uq_log_file_retention_shop_type"),
        Index("ix_log_file_retention_shop_type", "shop_id", "log_type"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    shop_id: Mapped[int | None] = mapped_column(
        ForeignKey("shops.id", ondelete="cascade"),
        nullable=True,
        index=True,
    )
    log_type: Mapped[str] = mapped_column(String(32), nullable=False)
    retention_days: Mapped[int] = mapped_column(Integer, nullable=False, default=10)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
