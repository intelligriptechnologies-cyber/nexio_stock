"""User + roles.

Four roles per D-13:
  - superadmin : dev/ops, cross-shop, every action written to admin_logs
  - owner      : full shop-scoped access, superset of receiver + cashier
  - receiver_user : stock receiving only (D-25, R-2)
  - cashier_user  : checkout / invoicing only (D-25, R-2)

Authorization boundaries are enforced server-side, not just in the UI
(R-21, D-25). See `app/api/deps.py` for the `require_role(...)` dependency.

Receiver/cashier accounts are full persistent accounts created by the owner
(D-27) — no per-shift registration, no anonymous check-in.
"""
from __future__ import annotations

import enum
from datetime import date
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Date, DateTime, Enum, ForeignKey, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

if TYPE_CHECKING:
    from app.models.shop import Shop


class UserRole(str, enum.Enum):
    SUPERADMIN = "superadmin"
    OWNER = "owner"
    RECEIVER_USER = "receiver_user"
    CASHIER_USER = "cashier_user"


# Roles that are scoped to a single shop. superadmin is explicitly NOT in
# this set — it has cross-shop access (D-28, R-5).
SHOP_SCOPED_ROLES: frozenset[UserRole] = frozenset(
    {
        UserRole.OWNER,
        UserRole.RECEIVER_USER,
        UserRole.CASHIER_USER,
    }
)


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        # Username is the primary login identifier for every role and is
        # therefore globally unique across the whole system.
        UniqueConstraint("username", name="uq_users_username"),
        # Phone is the shop-scoped login identifier and must be globally
        # unique across *all* shops (not just within one), since login
        # looks a user up by phone alone without knowing which shop they
        # belong to. A per-shop constraint here would let two different
        # shops' owners share a phone number, which login's single-row
        # lookup can't disambiguate — it would raise MultipleResultsFound.
        UniqueConstraint("phone", name="uq_users_phone"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    # shop_id is nullable ONLY for superadmin, who is global. Every other
    # role has it NOT NULL — see __table_args__ constraints above.
    shop_id: Mapped[int | None] = mapped_column(
        ForeignKey("shops.id", ondelete="restrict"),
        nullable=True,
        index=True,
    )
    role: Mapped[UserRole] = mapped_column(
        Enum(UserRole, name="user_role", native_enum=False, length=32),
        nullable=False,
        index=True,
    )
    username: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    full_name: Mapped[str] = mapped_column(String(200), nullable=False)
    phone: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    date_of_birth: Mapped[date | None] = mapped_column(Date, nullable=True)
    pan: Mapped[str | None] = mapped_column(String(10), nullable=True)
    gstin: Mapped[str | None] = mapped_column(String(15), nullable=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    shop: Mapped[Shop | None] = relationship(back_populates="users")
