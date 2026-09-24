"""OSBCL purchase orders and shop-specific bottle case packs."""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from enum import StrEnum
from typing import TYPE_CHECKING

from sqlalchemy import (
    JSON,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

if TYPE_CHECKING:
    from app.models.product import Product
    from app.models.shop import Shop
    from app.models.user import User


class PurchaseOrderStatus(StrEnum):
    DRAFT = "draft"
    OPEN = "open"
    PARTIALLY_RECEIVED = "partially_received"
    FULFILLED = "fulfilled"
    CANCELLED = "cancelled"


class ExtractionStatus(StrEnum):
    PENDING = "pending"
    REVIEW_REQUIRED = "review_required"
    READY = "ready"
    FAILED = "failed"


class ShopCasePackRule(Base):
    __tablename__ = "shop_case_pack_rules"
    __table_args__ = (UniqueConstraint("shop_id", "size_ml", name="uq_shop_case_pack_size"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id", ondelete="cascade"), nullable=False, index=True)
    size_ml: Mapped[int] = mapped_column(nullable=False)
    bottles_per_case: Mapped[int] = mapped_column(nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    shop: Mapped[Shop] = relationship()


class PurchaseOrder(Base):
    __tablename__ = "purchase_orders"
    __table_args__ = (
        UniqueConstraint("shop_id", "osbcl_token", name="uq_purchase_orders_shop_token"),
        UniqueConstraint("shop_id", "source_sha256", name="uq_purchase_orders_shop_hash"),
        Index("ix_purchase_orders_shop_status", "shop_id", "status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    shop_id: Mapped[int] = mapped_column(ForeignKey("shops.id", ondelete="restrict"), nullable=False, index=True)
    osbcl_token: Mapped[str | None] = mapped_column(String(100), nullable=True)
    order_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    order_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    retailer_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    retailer_code: Mapped[str | None] = mapped_column(String(100), nullable=True)
    vehicle_number: Mapped[str | None] = mapped_column(String(50), nullable=True)
    total_cases: Mapped[int | None] = mapped_column(nullable=True)
    total_loose_bottles: Mapped[int | None] = mapped_column(nullable=True)
    mger_total: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    order_total: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    source_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    source_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    source_path: Mapped[str] = mapped_column(String(500), nullable=False)
    page_count: Mapped[int] = mapped_column(nullable=False)
    extraction_status: Mapped[ExtractionStatus] = mapped_column(
        Enum(ExtractionStatus, name="po_extraction_status", native_enum=False, length=24, values_callable=lambda e: [m.value for m in e]),
        nullable=False,
        default=ExtractionStatus.PENDING,
    )
    extraction_confidence: Mapped[Decimal | None] = mapped_column(Numeric(5, 4), nullable=True)
    review_flags: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    raw_ocr: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    status: Mapped[PurchaseOrderStatus] = mapped_column(
        Enum(PurchaseOrderStatus, name="purchase_order_status", native_enum=False, length=24, values_callable=lambda e: [m.value for m in e]),
        nullable=False,
        default=PurchaseOrderStatus.DRAFT,
    )
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="restrict"), nullable=False)
    confirmed_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="restrict"), nullable=True)
    cancelled_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="restrict"), nullable=True)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancellation_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    shop: Mapped[Shop] = relationship()
    created_by: Mapped[User] = relationship(foreign_keys=[created_by_user_id])
    confirmed_by: Mapped[User | None] = relationship(foreign_keys=[confirmed_by_user_id])
    cancelled_by: Mapped[User | None] = relationship(foreign_keys=[cancelled_by_user_id])
    lines: Mapped[list[PurchaseOrderLine]] = relationship(back_populates="purchase_order", cascade="all, delete-orphan", order_by="PurchaseOrderLine.sequence")


class PurchaseOrderLine(Base):
    __tablename__ = "purchase_order_lines"
    __table_args__ = (
        UniqueConstraint("purchase_order_id", "sequence", name="uq_purchase_order_line_sequence"),
        Index("ix_purchase_order_lines_product", "product_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    purchase_order_id: Mapped[int] = mapped_column(ForeignKey("purchase_orders.id", ondelete="cascade"), nullable=False, index=True)
    source_item_name: Mapped[str] = mapped_column(String(500), nullable=False)
    size_ml: Mapped[int | None] = mapped_column(nullable=True)
    product_id: Mapped[int | None] = mapped_column(ForeignKey("products.id", ondelete="restrict"), nullable=True)
    cases: Mapped[int] = mapped_column(nullable=False, default=0)
    loose_bottles: Mapped[int] = mapped_column(nullable=False, default=0)
    pack_size_snapshot: Mapped[int | None] = mapped_column(nullable=True)
    ordered_bottles: Mapped[int | None] = mapped_column(nullable=True)
    case_rate: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    mger: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    amount: Mapped[Decimal | None] = mapped_column(Numeric(14, 2), nullable=True)
    sequence: Mapped[int] = mapped_column(nullable=False)
    ocr_confidence: Mapped[Decimal | None] = mapped_column(Numeric(5, 4), nullable=True)
    field_confidence: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    match_candidates: Mapped[list] = mapped_column(JSON, nullable=False, default=list)

    purchase_order: Mapped[PurchaseOrder] = relationship(back_populates="lines")
    product: Mapped[Product | None] = relationship()

    @property
    def product_barcode(self) -> str | None:
        return self.product.barcode if self.product is not None else None

    @property
    def product_brand(self) -> str | None:
        return self.product.brand if self.product is not None else None

    @property
    def product_size_label(self) -> str | None:
        return self.product.size_label if self.product is not None else None
