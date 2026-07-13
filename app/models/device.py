"""Device bindings for shop terminals.

Each physical tablet/PC/browser profile is represented by a stable device
key stored client-side. The binding points that device at exactly one shop
and optional counter label so the same deployment can serve multiple
locations without a login-time shop picker.
"""
from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

if TYPE_CHECKING:
    from app.models.shop import Shop
    from app.models.user import User


class DeviceBinding(Base):
    __tablename__ = "device_bindings"

    id: Mapped[int] = mapped_column(primary_key=True)
    device_key: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    shop_id: Mapped[int] = mapped_column(
        ForeignKey("shops.id", ondelete="restrict"), nullable=False, index=True
    )
    counter_name: Mapped[str | None] = mapped_column(String(80), nullable=True)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true"
    )
    registered_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="set null"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    shop: Mapped[Shop] = relationship()
    registered_by: Mapped[User | None] = relationship(foreign_keys=[registered_by_user_id])
