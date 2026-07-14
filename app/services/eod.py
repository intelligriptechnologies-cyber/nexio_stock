"""End-of-day sign-off + dashboard aggregation (R-26, R-44, D-32, D-36, D-63).

Two-tier storage note: the frozen PRD originally specified a
two-table design (working sales + confirmed_sales). For v1's first
cut, we use a single `invoices` table with a per-row `eod_signed_off`
flag — the same data shape, just no row movement. Per D-36 we retain
indefinitely, and the data is queryable by date the same way
(R-19). The two-table move can land later as a one-shot migration
without changing the API surface.

Flow:
  - sign-off: owner archives the open invoices for `business_date`.
    Every invoice whose `finalized_at` falls in [business_date 00:00,
    business_date + 1 00:00) in the server's local time gets
    `eod_signed_off=True` and an `EodSignOff` row recorded. Idempotent
    on (shop, day): re-signing the same day is a no-op (or rejected,
    depending on the policy — we reject with 409).
  - totals: for a signed-off day, sum the invoices' total_amounts,
    group payments by mode, count invoices.
  - history: list past sign-offs in a date range, descending.
  - void queue: list PENDING_VOID invoices the owner should act on.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.invoice import (
    STATUSES_COUNTING_AS_SOLD,
    EodSignOff,
    Invoice,
    InvoiceStatus,
    PastInvoice,
    PastInvoiceLine,
    PastPayment,
    Payment,
)
from app.services.calendar import today_local_date


class EodError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class SignOffResult:
    sign_off: EodSignOff
    invoices_signed_off: int


@dataclass
class EodTotals:
    business_date: date
    signed_off: bool
    invoice_count: int
    revenue: Decimal
    voided_count: int
    reversal_count: int
    payments_by_mode: dict[str, Decimal]


def _day_bounds(business_date: date) -> tuple[datetime, datetime]:
    """Local-time [start, end_exclusive) for a calendar day."""
    start = datetime.combine(business_date, time.min)
    end = start + timedelta(days=1)
    return start, end


async def sign_off_day(
    db: AsyncSession,
    *,
    shop_id: int,
    business_date: date,
    signed_off_by_user_id: int,
    notes: str | None = None,
) -> SignOffResult:
    """Mark `business_date` as closed for this shop.

    Every invoice whose `finalized_at` is in [business_date 00:00,
    business_date+1 00:00) and that hasn't been signed off yet is
    flipped to `eod_signed_off=True` with the same timestamp. An
    EodSignOff row is recorded for history.
    """
    if business_date > today_local_date():
        raise EodError(
            "future_date", "cannot sign off a future business date"
        )

    # Lock the (shop, business_date) sign-off row to serialise
    # concurrent sign-off attempts. If a row already exists, reject
    # — re-signing the same day is not allowed (D-32: one action per
    # day).
    existing = (
        await db.execute(
            select(EodSignOff).where(
                EodSignOff.shop_id == shop_id,
                EodSignOff.business_date == business_date,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise EodError(
            "already_signed_off",
            f"business_date {business_date.isoformat()} is already signed off",
        )

    pending_void = (
        await db.execute(
            select(Invoice.id).where(
                Invoice.shop_id == shop_id,
                Invoice.business_date == business_date,
                Invoice.status == InvoiceStatus.PENDING_VOID,
            )
        )
    ).first()
    if pending_void is not None:
        raise EodError(
            "pending_void_approvals_exist",
            "pending void approvals must be resolved before EOD sign-off",
        )

    now = datetime.now(UTC)
    invoices = (
        await db.execute(
            select(Invoice)
            .where(
                Invoice.shop_id == shop_id,
                Invoice.business_date == business_date,
            )
            .options(selectinload(Invoice.lines), selectinload(Invoice.payments))
        )
    ).scalars().all()

    for inv in invoices:
        archived = PastInvoice(
            original_invoice_id=inv.id,
            shop_id=inv.shop_id,
            cashier_user_id=inv.cashier_user_id,
            invoice_number=inv.invoice_number,
            status=inv.status,
            total_amount=inv.total_amount,
            finalized_at=inv.finalized_at,
            business_date=inv.business_date,
            eod_signed_off_at=now,
            eod_signed_off_by_user_id=signed_off_by_user_id,
            note=inv.note,
            void_requested_by_user_id=inv.void_requested_by_user_id,
            void_requested_at=inv.void_requested_at,
        )
        db.add(archived)
        await db.flush()
        for line in inv.lines:
            db.add(
                PastInvoiceLine(
                    invoice_id=archived.id,
                    product_id=line.product_id,
                    quantity=line.quantity,
                    unit_price=line.unit_price,
                    line_total=line.line_total,
                    product_brand=line.product_brand,
                    product_size_label=line.product_size_label,
                )
            )
        for payment in inv.payments:
            db.add(
                PastPayment(
                    invoice_id=archived.id,
                    mode=payment.mode,
                    amount=payment.amount,
                )
            )
        await db.delete(inv)

    signoff = EodSignOff(
        shop_id=shop_id,
        business_date=business_date,
        signed_off_by_user_id=signed_off_by_user_id,
        signed_off_at=now,
        invoices_signed_off=len(invoices),
        notes=notes,
    )
    db.add(signoff)
    return SignOffResult(sign_off=signoff, invoices_signed_off=len(invoices))


async def get_day_totals(
    db: AsyncSession, *, shop_id: int, business_date: date
) -> EodTotals:
    """Aggregate the day's invoices. Returns `signed_off=False` and zero
    totals if the day hasn't been signed off — the UI shows this as
    'not yet closed'."""
    signed_off = (
        await db.execute(
            select(EodSignOff.id).where(
                EodSignOff.shop_id == shop_id,
                EodSignOff.business_date == business_date,
            )
        )
    ).first() is not None

    current_invoices = (
        await db.execute(
            select(Invoice).where(
                Invoice.shop_id == shop_id,
                Invoice.business_date == business_date,
            )
        )
    ).scalars().all()
    past_invoices = (
        await db.execute(
            select(PastInvoice).where(
                PastInvoice.shop_id == shop_id,
                PastInvoice.business_date == business_date,
            )
        )
    ).scalars().all()
    invoices = [*current_invoices, *past_invoices]

    # Use FINALIZED only for revenue (REVERSAL nets out, VOIDED
    # contributes nothing — same filter as the stock derivation).
    # Use the module-level STATUSES_COUNTING_AS_SOLD predicate for
    # revenue + count — same one the stock-derivation query uses.
    revenue = sum(
        (inv.total_amount for inv in invoices if inv.status in STATUSES_COUNTING_AS_SOLD),
        Decimal("0"),
    )
    invoice_count = sum(
        1 for inv in invoices if inv.status in STATUSES_COUNTING_AS_SOLD
    )
    voided_count = sum(1 for inv in invoices if inv.status == InvoiceStatus.VOIDED)
    reversal_count = sum(1 for inv in invoices if inv.status == InvoiceStatus.REVERSAL)

    # Payment-mode split. Eager-load payments once.
    current_invoice_ids = [
        inv.id for inv in current_invoices if inv.status in STATUSES_COUNTING_AS_SOLD
    ]
    past_invoice_ids = [
        inv.id for inv in past_invoices if inv.status in STATUSES_COUNTING_AS_SOLD
    ]
    payments_by_mode: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
    if current_invoice_ids:
        payment_rows = (
            await db.execute(
                select(Payment).where(Payment.invoice_id.in_(current_invoice_ids))
            )
        ).scalars().all()
        for p in payment_rows:
            payments_by_mode[p.mode.value] += p.amount
    if past_invoice_ids:
        payment_rows = (
            await db.execute(
                select(PastPayment).where(PastPayment.invoice_id.in_(past_invoice_ids))
            )
        ).scalars().all()
        for p in payment_rows:
            payments_by_mode[p.mode.value] += p.amount

    return EodTotals(
        business_date=business_date,
        signed_off=signed_off,
        invoice_count=invoice_count,
        revenue=revenue,
        voided_count=voided_count,
        reversal_count=reversal_count,
        payments_by_mode=dict(payments_by_mode),
    )


async def list_signoff_history(
    db: AsyncSession,
    *,
    shop_id: int,
    from_date: date | None = None,
    to_date: date | None = None,
    limit: int = 90,
) -> list[EodSignOff]:
    """Descending list of past sign-offs. `from_date` / `to_date`
    inclusive on the business_date column."""
    stmt = select(EodSignOff).where(EodSignOff.shop_id == shop_id)
    if from_date is not None:
        stmt = stmt.where(EodSignOff.business_date >= from_date)
    if to_date is not None:
        # inclusive: <= to_date
        stmt = stmt.where(EodSignOff.business_date <= to_date)
    stmt = stmt.order_by(EodSignOff.business_date.desc()).limit(limit)
    return list((await db.execute(stmt)).scalars().all())


async def list_pending_voids(
    db: AsyncSession,
    *,
    shop_id: int,
    limit: int = 50,
) -> list[Invoice | PastInvoice]:
    """Invoices waiting for the owner to approve or reject a post-EOD
    void request (R-26 dashboard widget)."""
    current_rows = list(
        (
            await db.execute(
                select(Invoice).where(
                    Invoice.shop_id == shop_id,
                    Invoice.status == InvoiceStatus.PENDING_VOID,
                )
            )
        )
        .scalars()
        .all()
    )
    past_rows = list(
        (
            await db.execute(
                select(PastInvoice).where(
                    PastInvoice.shop_id == shop_id,
                    PastInvoice.status == InvoiceStatus.PENDING_VOID,
                )
            )
        )
        .scalars()
        .all()
    )
    rows = [*current_rows, *past_rows]
    rows.sort(key=lambda row: row.void_requested_at or datetime.max.replace(tzinfo=UTC))
    return rows[:limit]


__all__ = [
    "EodError",
    "EodTotals",
    "SignOffResult",
    "get_day_totals",
    "list_pending_voids",
    "list_signoff_history",
    "sign_off_day",
]
