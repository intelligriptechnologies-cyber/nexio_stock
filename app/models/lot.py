"""Lot + LotLine - first-class stock-receipt entity (D-17, R-6)."""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, Date, DateTime, ForeignKey, Index, Integer, Numeric, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

if TYPE_CHECKING:
    from app.models.product import Product
    from app.models.shop import Shop
    from app.models.user import User
    from app.models.vendor import Vendor


class Lot(Base):
    __tablename__ = "lots"
    __table_args__ = (
        Index("ix_lots_shop_received_at", "shop_id", "received_at"),
        Index("ix_lots_shop_purchase_date", "shop_id", "purchase_date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    shop_id: Mapped[int] = mapped_column(
        ForeignKey("shops.id", ondelete="restrict"),
        nullable=False,
        index=True,
    )
    vendor_id: Mapped[int] = mapped_column(
        ForeignKey("vendors.id", ondelete="restrict"),
        nullable=False,
        index=True,
    )
    received_by_user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="restrict"),
        nullable=False,
        index=True,
    )
    reference: Mapped[str | None] = mapped_column(String(100), nullable=True)
    purchase_date: Mapped[date] = mapped_column(Date, nullable=False)
    vendor_invoice_number: Mapped[str] = mapped_column(String(100), nullable=False)
    invoice_value: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    lines: Mapped[list["LotLine"]] = relationship(back_populates="lot", cascade="all, delete-orphan")
    received_by: Mapped[User] = relationship()
    shop: Mapped[Shop] = relationship()
    vendor: Mapped[Vendor] = relationship()


class LotLine(Base):
    __tablename__ = "lot_lines"
    __table_args__ = (
        Index("uq_lot_lines_lot_product", "lot_id", "product_id", unique=True),
        Index("ix_lot_lines_product", "product_id"),
        CheckConstraint(
            "good_condition_quantity >= 0 AND good_condition_quantity <= quantity",
            name="ck_lot_lines_good_condition_quantity",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    lot_id: Mapped[int] = mapped_column(
        ForeignKey("lots.id", ondelete="cascade"),
        nullable=False,
    )
    product_id: Mapped[int] = mapped_column(
        ForeignKey("products.id", ondelete="restrict"),
        nullable=False,
    )
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    good_condition_quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    product_brand: Mapped[str | None] = mapped_column(String(200), nullable=True)
    product_size_label: Mapped[str | None] = mapped_column(String(64), nullable=True)

    lot: Mapped[Lot] = relationship(back_populates="lines")
    product: Mapped[Product] = relationship()

    @property
    def breakage_quantity(self) -> int:
        return self.quantity - self.good_condition_quantity
