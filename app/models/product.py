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

Lifecycle (issue #22, D-v2-5):
  - ``status = 'pending'``: a provisional product quick-added by a
    receiver/cashier (brand + size only, no price). Can be received into a
    Lot like an active one (stock counts immediately, D-v2-6), but cannot
    be sold at checkout (R-9). The owner completes it later by setting a
    price, which flips the row to ``active``.
  - ``status = 'active'``: a fully-specified product with a price. The
    default state for every row in v1.

There is NO separate staging table for pending products (D-v2-5) — a
pending Product is a real row everywhere (lots, stock views, catalog),
just unsellable and unpriced.
"""
from __future__ import annotations

import enum
from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Numeric,
    String,
    UniqueConstraint,
    func,
    select,
)
from sqlalchemy.ext.hybrid import hybrid_property
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

if TYPE_CHECKING:
    from app.models.shop import Shop


class ProductStatus(str, enum.Enum):
    """Product lifecycle state (issue #22, D-v2-5).

    Wire values are the lowercase enum ``.value`` — stable, never renamed.
    Member names match the values so SQLAlchemy's default Enum storage
    (which persists ``.name``) lines up with the wire format used by the
    CHECK constraint and the API contract (matches the UserRole pattern
    in ``app.models.user``).
    """

    PENDING = "pending"
    ACTIVE = "active"
    REJECTED = "rejected"


class MasterProduct(Base):
    __tablename__ = "master_products"

    id: Mapped[int] = mapped_column(primary_key=True)
    barcode: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    brand: Mapped[str] = mapped_column(String(200), nullable=False)
    size_label: Mapped[str] = mapped_column(String(64), nullable=False)
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


class Product(Base):
    __tablename__ = "products"
    __table_args__ = (
        UniqueConstraint(
            "shop_id",
            "master_product_id",
            name="uq_products_shop_master_product",
        ),
        Index("ix_products_shop_master_product", "shop_id", "master_product_id"),
        # Used by the Pending Products screen (#25) to filter the
        # owner-dashboard badge / list query to a single shop.
        Index("ix_products_shop_status", "shop_id", "status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    shop_id: Mapped[int] = mapped_column(
        ForeignKey("shops.id", ondelete="restrict"),
        nullable=False,
        index=True,
    )
    master_product_id: Mapped[int] = mapped_column(
        ForeignKey("master_products.id", ondelete="restrict"),
        nullable=False,
        index=True,
    )
    # Nullable when ``status = 'pending'``. A DB-level CHECK
    # (``ck_products_price_iff_active``) ties the two together.
    price: Mapped[Decimal | None] = mapped_column(Numeric(12, 2), nullable=True)
    # Per-product low-stock override. NULL = fall back to shop default (#7).
    low_stock_threshold: Mapped[int | None] = mapped_column(nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # Pending / active lifecycle (issue #22). String column with a Python
    # enum for type safety; ``values_callable`` tells SQLAlchemy to persist
    # the enum's lowercase ``.value`` (matching the wire format and the
    # CHECK constraint) instead of the default uppercase ``.name``. The
    # UserRole column in ``app.models.user`` has the same default
    # behaviour but no DB-level CHECK constraint, so the bug is invisible
    # there; here the CHECK would reject an uppercase value.
    status: Mapped[ProductStatus] = mapped_column(
        Enum(
            ProductStatus,
            name="product_status",
            native_enum=False,
            length=16,
            values_callable=lambda e: [m.value for m in e],
        ),
        nullable=False,
        default=ProductStatus.ACTIVE,
        server_default="active",
    )
    # Recorded once, at quick-add write time (issue #31) — the
    # X-Quick-Add-Origin header the caller already sent. NULL for
    # products created via the regular POST/CSV-import paths (always
    # active, never quick-added) and for pending rows that predate this
    # column. The Pending Products list (#25) reads these two columns
    # directly instead of re-deriving origin by scanning
    # stockin_logs/invoicing_logs on every list call.
    pending_origin: Mapped[str | None] = mapped_column(String(16), nullable=True)
    pending_added_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="set null"),
        nullable=True,
    )

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
    master_product: Mapped[MasterProduct] = relationship(lazy="joined", innerjoin=True)

    def _ensure_master_product(self) -> MasterProduct:
        if self.master_product is None:  # type: ignore[truthy-function]
            self.master_product = MasterProduct(barcode="", brand="", size_label="")
        return self.master_product

    @hybrid_property
    def barcode(self) -> str:
        return self.master_product.barcode

    @barcode.inplace.setter
    def _set_barcode(self, value: str) -> None:
        self._ensure_master_product().barcode = value

    @barcode.inplace.expression
    @classmethod
    def _barcode_expression(cls):
        return (
            select(MasterProduct.barcode)
            .where(MasterProduct.id == cls.master_product_id)
            .scalar_subquery()
        )

    @hybrid_property
    def brand(self) -> str:
        return self.master_product.brand

    @brand.inplace.setter
    def _set_brand(self, value: str) -> None:
        self._ensure_master_product().brand = value

    @brand.inplace.expression
    @classmethod
    def _brand_expression(cls):
        return (
            select(MasterProduct.brand)
            .where(MasterProduct.id == cls.master_product_id)
            .scalar_subquery()
        )

    @hybrid_property
    def size_label(self) -> str:
        return self.master_product.size_label

    @size_label.inplace.setter
    def _set_size_label(self, value: str) -> None:
        self._ensure_master_product().size_label = value

    @size_label.inplace.expression
    @classmethod
    def _size_label_expression(cls):
        return (
            select(MasterProduct.size_label)
            .where(MasterProduct.id == cls.master_product_id)
            .scalar_subquery()
        )
