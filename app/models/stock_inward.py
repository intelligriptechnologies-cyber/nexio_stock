"""Stock inward request - pending/approved/rejected/completed workflow."""
from __future__ import annotations

import enum
from datetime import date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import Date, DateTime, Enum, ForeignKey, Index, Numeric, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

if TYPE_CHECKING:
    from app.models.lot import Lot
    from app.models.product import Product
    from app.models.shop import Shop
    from app.models.user import User
    from app.models.vendor import Vendor


class StockInwardStatus(str, enum.Enum):
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"
    COMPLETED = "completed"


class StockInward(Base):
    __tablename__ = "stock_inwards"
    __table_args__ = (
        Index("ix_stock_inwards_shop_status", "shop_id", "status"),
        Index("ix_stock_inwards_shop_created_at", "shop_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    shop_id: Mapped[int] = mapped_column(
        ForeignKey("shops.id", ondelete="restrict"),
        nullable=False,
        index=True,
    )
    vendor_id: Mapped[int | None] = mapped_column(
        ForeignKey("vendors.id", ondelete="restrict"),
        nullable=True,
        index=True,
    )
    created_by_user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="restrict"),
        nullable=False,
        index=True,
    )
    approved_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="restrict"),
        nullable=True,
        index=True,
    )
    rejected_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="restrict"),
        nullable=True,
        index=True,
    )
    lot_id: Mapped[int | None] = mapped_column(
        ForeignKey("lots.id", ondelete="set null"),
        nullable=True,
        unique=True,
        index=True,
    )
    reference: Mapped[str | None] = mapped_column(String(100), nullable=True)
    purchase_date: Mapped[date] = mapped_column(Date, nullable=False)
    vendor_invoice_number: Mapped[str] = mapped_column(String(100), nullable=False)
    invoice_value: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    status: Mapped[StockInwardStatus] = mapped_column(
        Enum(
            StockInwardStatus,
            name="stock_inward_status",
            native_enum=False,
            length=16,
            values_callable=lambda e: [m.value for m in e],
        ),
        nullable=False,
        default=StockInwardStatus.PENDING,
        server_default=StockInwardStatus.PENDING.value,
    )
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    rejected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    shop: Mapped[Shop] = relationship()
    vendor: Mapped[Vendor | None] = relationship()
    created_by: Mapped[User] = relationship(foreign_keys=[created_by_user_id])
    approved_by: Mapped[User | None] = relationship(foreign_keys=[approved_by_user_id])
    rejected_by: Mapped[User | None] = relationship(foreign_keys=[rejected_by_user_id])
    lines: Mapped[list["StockInwardLine"]] = relationship(
        back_populates="stock_inward", cascade="all, delete-orphan"
    )

    @property
    def received_by_user_id(self) -> int:
        return self.created_by_user_id

    @property
    def received_at(self) -> datetime:
        return self.completed_at or self.approved_at or self.created_at

    @property
    def created_by_name(self) -> str | None:
        return self.created_by.full_name if self.created_by is not None else None

    @property
    def approved_by_name(self) -> str | None:
        return self.approved_by.full_name if self.approved_by is not None else None

    @property
    def rejected_by_name(self) -> str | None:
        return self.rejected_by.full_name if self.rejected_by is not None else None


class StockInwardLine(Base):
    __tablename__ = "stock_inward_lines"
    __table_args__ = (
        Index("uq_stock_inward_lines_inward_product", "stock_inward_id", "product_id", unique=True),
        Index("ix_stock_inward_lines_product", "product_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    stock_inward_id: Mapped[int] = mapped_column(
        ForeignKey("stock_inwards.id", ondelete="cascade"),
        nullable=False,
    )
    product_id: Mapped[int] = mapped_column(
        ForeignKey("products.id", ondelete="restrict"),
        nullable=False,
    )
    quantity: Mapped[int] = mapped_column(nullable=False)
    good_condition_quantity: Mapped[int] = mapped_column(nullable=False)
    product_brand: Mapped[str | None] = mapped_column(String(200), nullable=True)
    product_size_label: Mapped[str | None] = mapped_column(String(64), nullable=True)

    stock_inward: Mapped[StockInward] = relationship(back_populates="lines")
    product: Mapped[Product] = relationship()

    @property
    def breakage_quantity(self) -> int:
        return self.quantity - self.good_condition_quantity
