"""Lot + LotLine — first-class stock-receipt entity (D-17, R-6).

A Lot is one delivery from a supplier, recorded by a receiver_user, with
one or more line items (product, quantity). Stock for a SKU is derived:
sum of LotLine.quantity for the product minus sum of sale-line quantities
in #4. Every sale traces back to (or at least depletes) a lot.

Cost / purchase price is intentionally NOT tracked (D-50, v1 default).
Only quantity and who/when.
"""
from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

if TYPE_CHECKING:
    from app.models.product import Product
    from app.models.shop import Shop
    from app.models.user import User


class Lot(Base):
    __tablename__ = "lots"
    __table_args__ = (
        Index("ix_lots_shop_received_at", "shop_id", "received_at"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    shop_id: Mapped[int] = mapped_column(
        ForeignKey("shops.id", ondelete="restrict"),
        nullable=False,
        index=True,
    )
    # The receiver who recorded the lot (D-25, D-27 — full account, not
    # per-shift). Owner may also create lots; we don't restrict at the
    # column level since the role gate lives in the API.
    received_by_user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="restrict"),
        nullable=False,
        index=True,
    )
    # Free-form supplier-side reference (invoice number, delivery note id,
    # etc.). Not validated; intentionally optional.
    reference: Mapped[str | None] = mapped_column(String(100), nullable=True)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    received_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    lines: Mapped[list[LotLine]] = relationship(
        back_populates="lot", cascade="all, delete-orphan"
    )
    received_by: Mapped[User] = relationship()
    shop: Mapped[Shop] = relationship()


class LotLine(Base):
    __tablename__ = "lot_lines"
    __table_args__ = (
        # One line per (lot, product) — a lot can't have two lines for
        # the same product. If a supplier ships the same SKU twice in one
        # delivery, merge the quantities on the receiver screen rather
        # than the API accepting two rows.
        Index("uq_lot_lines_lot_product", "lot_id", "product_id", unique=True),
        Index("ix_lot_lines_product", "product_id"),
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

    lot: Mapped[Lot] = relationship(back_populates="lines")
    product: Mapped[Product] = relationship()
