"""Product — one record per SKU/bottle-size.

Each bottle size of a brand is a fully separate Product (D-19): e.g. 180ml
and 750ml of the same whisky are two products, each with its own
manufacturer-printed barcode and its own price. No parent-brand entity with
size variants — keeps the data model flat and matches how bottles are
actually barcoded in the wild (D-7, D-19).

Identity:
  - `barcode` is whatever code is already printed on the bottle, scanned
    as-is (D-7). Globally UNIQUE at the DB level per D-52 — creating a
    second product with the same barcode is rejected with a clear error.

Stock is NOT stored on the product — it's derived from lots received (#3)
minus sales (#4) per D-17. The "current stock" view is computed at read
time (a SQL view or a join), not maintained on the row.

`low_stock_threshold` is the per-product override (D-34, #7). The shop
default lives on `Shop`; the effective threshold at evaluation time is
`product.low_stock_threshold ?? shop.low_stock_threshold_default`.
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Numeric, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

if TYPE_CHECKING:
    from app.models.shop import Shop


class Product(Base):
    __tablename__ = "products"
    __table_args__ = (
        # The unique-constraint is global across all shops (D-52): barcodes
        # are physical, so two products with the same code is always a
        # mistake, never an intended overlap. shop_id is still on every
        # row (D-35) for multi-tenant scoping of other operations.
        Index("ix_products_shop_barcode", "shop_id", "barcode"),
        Index("ix_products_shop_brand", "shop_id", "brand"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    shop_id: Mapped[int] = mapped_column(
        ForeignKey("shops.id", ondelete="restrict"),
        nullable=False,
        index=True,
    )
    barcode: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    brand: Mapped[str] = mapped_column(String(200), nullable=False)
    size_label: Mapped[str] = mapped_column(String(64), nullable=False)
    price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    # Per-product low-stock override. NULL = fall back to shop default (#7).
    low_stock_threshold: Mapped[int | None] = mapped_column(nullable=True)
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

    shop: Mapped[Shop] = relationship()
