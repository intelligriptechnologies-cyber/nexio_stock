"""Invoice + InvoiceLine + Payment (D-18, D-40, D-59, R-8, R-12, R-13, R-40).

Lifecycle of an Invoice (R-8):
  open  -> finalized+paid (cart submit; line items become immutable)
        -> void (pre-EOD-signoff, direct)
        -> voided via compensating entry (post-EOD-signoff, #5)

This module holds the model + the atomic finalize transaction. The
two-tier storage (working sales table vs `confirmed_sales`) lands in #6
— for v1's first cut, invoices live in a single `invoices` table; the
move-to-confirmed_sales step is the EOD sign-off action.

Invoice number: shop-scoped, monotonic per shop. For v1 we use a
sequence per shop (DB sequence per row would be heavy; an integer
counter on the Shop table is simpler and matches the D-35 shop-as-tenant
shape). The counter is a `last_invoice_number` column on Shop, incremented
under the finalize transaction's row lock so two concurrent finalizes
get distinct numbers.
"""
from __future__ import annotations

import enum
from datetime import date as date_cls
from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import (
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

if TYPE_CHECKING:
    from app.models.product import Product


class InvoiceStatus(str, enum.Enum):
    FINALIZED = "finalized"  # paid, line items immutable
    VOIDED = "voided"  # pre-EOD-signoff direct void (#5)
    REVERSAL = "reversal"  # post-EOD compensating entry that undoes a FINALIZED
    PENDING_VOID = "pending_void"  # post-EOD, owner approval requested (#5)


# Module-level constant for the statuses that count as "sold" in the
# stock-derivation and revenue-aggregation queries. The set is the
# single source of truth — app.services.stock.compute_derived_stock,
# the dashboard's get_day_totals, and #7's low-stock query all filter
# against it. Currently {FINALIZED} — a single-element set. If you
# add a new status that should count (e.g. a "RETURNED" status that
# nets out instead of fully reverses), add it here AND update the
# queries that consume this set.
#
# PENDING_VOID still counts as sold: until an owner/superadmin approves
# the request, stock and revenue must remain financially active.
#
# Lives at module level (not on the InvoiceStatus class) because
# `InvoiceStatus(str, enum.Enum)` coerces any plain class attribute
# to a string at class-construction time.
STATUSES_COUNTING_AS_SOLD: frozenset[InvoiceStatus] = frozenset(
    {InvoiceStatus.FINALIZED, InvoiceStatus.PENDING_VOID}
)


class PaymentMode(str, enum.Enum):
    CASH = "cash"
    UPI = "upi"
    CARD = "card"  # credit card, per D-15
    OTHER = "other"


class Invoice(Base):
    __tablename__ = "invoices"
    __table_args__ = (
        # Invoice numbers are shop-scoped and unique within a shop (D-35).
        UniqueConstraint("shop_id", "invoice_number", name="uq_invoices_shop_number"),
        Index("ix_invoices_shop_finalized_at", "shop_id", "finalized_at"),
        Index("ix_invoices_shop_status", "shop_id", "status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    shop_id: Mapped[int] = mapped_column(
        ForeignKey("shops.id", ondelete="restrict"),
        nullable=False,
    )
    cashier_user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="restrict"),
        nullable=False,
    )
    # Monotonic per-shop. Allocated under row lock on Shop at finalize
    # time. We store the integer directly here so reads are simple.
    invoice_number: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[InvoiceStatus] = mapped_column(
        Enum(InvoiceStatus, name="invoice_status", native_enum=False, length=32),
        nullable=False,
        default=InvoiceStatus.FINALIZED,
    )
    total_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    finalized_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    business_date: Mapped[date_cls] = mapped_column(
        Date, nullable=False, server_default=func.current_date()
    )
    # #6 flips this true on EOD sign-off. The exact UTC timestamp and
    # the owner who signed off are recorded for audit (R-26).
    eod_signed_off: Mapped[bool] = mapped_column(
        nullable=False, default=False, server_default="false"
    )
    eod_signed_off_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    eod_signed_off_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="set null"),
        nullable=True,
    )
    # A short free-form note the cashier can attach (rare). Optional.
    note: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # For REVERSAL rows: which FINALIZED invoice this reverses. NULL
    # for normal invoices. D-37 says the original is never edited; a
    # REVERSAL row references it instead. set null on delete so a
    # corrupted delete of the original doesn't cascade to the
    # compensating row.
    reverses_invoice_id: Mapped[int | None] = mapped_column(
        ForeignKey("invoices.id", ondelete="set null"),
        nullable=True,
        index=True,
    )
    # For PENDING_VOID rows: the user who requested the void and when.
    # Cleared when the request is approved (reversal created) or
    # rejected (status reverts to FINALIZED).
    void_requested_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="set null"),
        nullable=True,
    )
    void_requested_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    lines: Mapped[list[InvoiceLine]] = relationship(
        back_populates="invoice", cascade="all, delete-orphan"
    )
    payments: Mapped[list[Payment]] = relationship(
        back_populates="invoice", cascade="all, delete-orphan"
    )


class InvoiceLine(Base):
    """A line item on a finalized invoice.

    Line items are immutable after the invoice is finalized (R-9 / D-20):
    updates are forbidden by the application layer; corrections go
    through Void (D-18 / D-37). At the DB level there's no UPDATE in the
    normal path — the only way these rows are created is in the same
    transaction as the invoice finalize, and the only way they go away
    is via cascade on a void-reversal flow (lands in #5).
    """

    __tablename__ = "invoice_lines"
    __table_args__ = (
        # One line per (invoice, product) is the typical shape. Different
        # sizes or variants are separate Products (D-19), so this should
        # hold.
        UniqueConstraint("invoice_id", "product_id", name="uq_invoice_lines_invoice_product"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    invoice_id: Mapped[int] = mapped_column(
        ForeignKey("invoices.id", ondelete="cascade"),
        nullable=False,
    )
    product_id: Mapped[int] = mapped_column(
        ForeignKey("products.id", ondelete="restrict"),
        nullable=False,
    )
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    # Price captured at sale time (R-9: invoice must retain verbatim).
    unit_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    line_total: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    # Issue #38 — snapshot of the product's brand + size at sale time.
    # Populated at create time so a later product rename never changes
    # a historical invoice line (D-v3-4). NULL for rows created before
    # this migration; the API layer falls back to a live Product join
    # for those rows only.
    product_brand: Mapped[str | None] = mapped_column(String(200), nullable=True)
    product_size_label: Mapped[str | None] = mapped_column(String(64), nullable=True)

    invoice: Mapped[Invoice] = relationship(back_populates="lines")
    product: Mapped[Product] = relationship()


class Payment(Base):
    """One payment line on an invoice.

    Default is one payment per invoice (single mode). The payment-modes
    structure supports optional multi-mode splits (D-59, R-40) — a
    customer can pay part cash + part UPI on the same invoice. Each row
    here is one mode + amount; the sum of payments.amount must equal
    invoice.total_amount.
    """

    __tablename__ = "payments"
    __table_args__ = (Index("ix_payments_invoice", "invoice_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    invoice_id: Mapped[int] = mapped_column(
        ForeignKey("invoices.id", ondelete="cascade"),
        nullable=False,
    )
    mode: Mapped[PaymentMode] = mapped_column(
        Enum(PaymentMode, name="payment_mode", native_enum=False, length=16),
        nullable=False,
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)

    invoice: Mapped[Invoice] = relationship(back_populates="payments")


class PastInvoice(Base):
    """Archived invoice header created during EOD sign-off.

    Current invoices live in ``invoices`` until EOD. Sign-off copies them
    here, copies their lines/payments to the matching archive tables, then
    deletes the current rows.
    """

    __tablename__ = "past_invoices"
    __table_args__ = (
        UniqueConstraint("shop_id", "invoice_number", name="uq_past_invoices_shop_number"),
        Index("ix_past_invoices_shop_business_date", "shop_id", "business_date"),
        Index("ix_past_invoices_shop_status", "shop_id", "status"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    original_invoice_id: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    shop_id: Mapped[int] = mapped_column(
        ForeignKey("shops.id", ondelete="restrict"), nullable=False
    )
    cashier_user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="restrict"), nullable=False
    )
    invoice_number: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[InvoiceStatus] = mapped_column(
        Enum(InvoiceStatus, name="invoice_status", native_enum=False, length=32),
        nullable=False,
    )
    total_amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    finalized_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    business_date: Mapped[date_cls] = mapped_column(Date, nullable=False)
    eod_signed_off_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    eod_signed_off_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="set null"), nullable=True
    )
    note: Mapped[str | None] = mapped_column(String(200), nullable=True)
    reverses_past_invoice_id: Mapped[int | None] = mapped_column(
        ForeignKey("past_invoices.id", ondelete="set null"),
        nullable=True,
        index=True,
    )
    void_requested_by_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="set null"), nullable=True
    )
    void_requested_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    lines: Mapped[list[PastInvoiceLine]] = relationship(
        back_populates="invoice", cascade="all, delete-orphan"
    )
    payments: Mapped[list[PastPayment]] = relationship(
        back_populates="invoice", cascade="all, delete-orphan"
    )

    @property
    def eod_signed_off(self) -> bool:
        return True


class PastInvoiceLine(Base):
    __tablename__ = "past_invoice_lines"
    __table_args__ = (
        UniqueConstraint("invoice_id", "product_id", name="uq_past_invoice_lines_invoice_product"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    invoice_id: Mapped[int] = mapped_column(
        ForeignKey("past_invoices.id", ondelete="cascade"), nullable=False
    )
    product_id: Mapped[int] = mapped_column(
        ForeignKey("products.id", ondelete="restrict"), nullable=False
    )
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    unit_price: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    line_total: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    product_brand: Mapped[str | None] = mapped_column(String(200), nullable=True)
    product_size_label: Mapped[str | None] = mapped_column(String(64), nullable=True)

    invoice: Mapped[PastInvoice] = relationship(back_populates="lines")
    product: Mapped[Product] = relationship()


class PastPayment(Base):
    __tablename__ = "past_payments"
    __table_args__ = (Index("ix_past_payments_invoice", "invoice_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    invoice_id: Mapped[int] = mapped_column(
        ForeignKey("past_invoices.id", ondelete="cascade"), nullable=False
    )
    mode: Mapped[PaymentMode] = mapped_column(
        Enum(PaymentMode, name="payment_mode", native_enum=False, length=16),
        nullable=False,
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)

    invoice: Mapped[PastInvoice] = relationship(back_populates="payments")


class EodSignOff(Base):
    """One row per EOD sign-off action (R-44, D-32, D-36, D-63).

    Records that the owner marked the day `business_date` as closed.
    The set of invoices signed off by this action are all rows in
    `invoices` whose `eod_signed_off_at` matches this sign-off's
    timestamp, scoped to the same shop and business_date.

    The dashboard reads from this table to render the sign-off
    history ("which days have I closed out?") rather than scanning
    `invoices.eod_signed_off_at`, which is more natural for the
    end-of-day action log shape.
    """

    __tablename__ = "eod_signoffs"
    __table_args__ = (
        UniqueConstraint("shop_id", "business_date", name="uq_eod_signoffs_shop_date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    shop_id: Mapped[int] = mapped_column(
        ForeignKey("shops.id", ondelete="restrict"),
        nullable=False,
    )
    # The calendar day (in the shop's local timezone — IST for v1, D-55)
    # that this sign-off covers. Stored as a Date so range queries and
    # equality checks are unambiguous (no timezone / DST fuzziness).
    business_date: Mapped[date_cls] = mapped_column(Date, nullable=False)
    signed_off_by_user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="restrict"),
        nullable=False,
    )
    signed_off_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    invoices_signed_off: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0
    )
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)


class IdempotencyKey(Base):
    """Server-side dedup for checkout retries (D-30, R-12, R-14).

    The cashier's client includes an `Idempotency-Key` header on every
    POST /checkout/finalize. On a retry (offline-then-online, network
    blip, double-tap) the server looks up the key. If present, it
    returns the original invoice; if not, it proceeds and stores the
    key on success.

    Scoped per shop so a key collision across shops can't accidentally
    return a foreign shop's invoice.
    """

    __tablename__ = "idempotency_keys"
    __table_args__ = (
        UniqueConstraint("shop_id", "key", name="uq_idempotency_keys_shop_key"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    shop_id: Mapped[int] = mapped_column(
        ForeignKey("shops.id", ondelete="restrict"),
        nullable=False,
    )
    key: Mapped[str] = mapped_column(String(80), nullable=False)
    invoice_id: Mapped[int] = mapped_column(
        ForeignKey("invoices.id", ondelete="cascade"),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
