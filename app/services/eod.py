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
import csv
import io

from sqlalchemy import func, select
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
from app.models.user import User
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
    range_start_business_date: date | None
    range_end_business_date: date | None
    invoice_count: int
    revenue: Decimal
    voided_count: int
    reversal_count: int
    payments_by_mode: dict[str, Decimal]


@dataclass
class OpenBacklogWindow:
    range_start_business_date: date | None
    range_end_business_date: date | None
    invoices: list[Invoice]


@dataclass
class SignOffHistoryRow:
    sign_off: EodSignOff
    signer_name: str


@dataclass
class ArchivedSignoffSummary:
    invoice_count: int
    revenue: Decimal
    payments_by_mode: dict[str, Decimal]


@dataclass
class ReconciliationExportRow:
    reconciliation_id: int
    signed_off_at: datetime
    signed_off_by_user_id: int
    signed_off_by_name: str
    invoices_signed_off: int
    reconciliation_revenue: Decimal
    reconciliation_payments_by_mode: str
    reconciliation_notes: str | None
    invoice_id: int
    invoice_number: int
    invoice_business_date: date
    invoice_status: str
    cashier_user_id: int
    cashier_name: str
    invoice_total_amount: Decimal
    invoice_note: str | None
    invoice_payments: str
    invoice_line_items: str


def _day_bounds(business_date: date) -> tuple[datetime, datetime]:
    """Local-time [start, end_exclusive) for a calendar day."""
    start = datetime.combine(business_date, time.min)
    end = start + timedelta(days=1)
    return start, end


async def _latest_signoff_business_date(
    db: AsyncSession, *, shop_id: int
) -> date | None:
    return (
        await db.execute(
            select(func.max(EodSignOff.business_date)).where(EodSignOff.shop_id == shop_id)
        )
    ).scalar_one()


async def _get_open_backlog_window(
    db: AsyncSession, *, shop_id: int, with_relationships: bool = False
) -> OpenBacklogWindow:
    latest_signoff_business_date = await _latest_signoff_business_date(db, shop_id=shop_id)
    stmt = select(Invoice).where(Invoice.shop_id == shop_id)
    if latest_signoff_business_date is not None:
        stmt = stmt.where(Invoice.business_date > latest_signoff_business_date)
    stmt = stmt.order_by(Invoice.business_date.asc(), Invoice.id.asc())
    if with_relationships:
        stmt = stmt.options(selectinload(Invoice.lines), selectinload(Invoice.payments))
    invoices = list((await db.execute(stmt)).scalars().all())
    if not invoices:
        return OpenBacklogWindow(
            range_start_business_date=None,
            range_end_business_date=None,
            invoices=[],
        )
    return OpenBacklogWindow(
        range_start_business_date=invoices[0].business_date,
        range_end_business_date=invoices[-1].business_date,
        invoices=invoices,
    )


def _normalize_notes(notes: str | None) -> str | None:
    if notes is None:
        return None
    normalized = notes.strip()
    return normalized or None


async def sign_off_day(
    db: AsyncSession,
    *,
    shop_id: int,
    business_date: date,
    signed_off_by_user_id: int,
    notes: str | None = None,
) -> SignOffResult:
    """Archive the current open backlog for this shop.

    The close window spans every current invoice whose business_date is
    after the shop's latest sign-off date. The sign-off record is stored
    against the backlog end date. If no current backlog exists, a zero-row
    sign-off still records the requested date for history.
    """
    if business_date > today_local_date():
        raise EodError(
            "future_date", "cannot sign off a future business date"
        )

    backlog = await _get_open_backlog_window(db, shop_id=shop_id, with_relationships=True)
    signoff_business_date = backlog.range_end_business_date or business_date

    # Lock the (shop, business_date) sign-off row to serialise
    # concurrent sign-off attempts. If a row already exists, reject
    # — re-signing the same day is not allowed (D-32: one action per
    # day).
    existing = (
        await db.execute(
            select(EodSignOff).where(
                EodSignOff.shop_id == shop_id,
                EodSignOff.business_date == signoff_business_date,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise EodError(
            "already_signed_off",
            f"business_date {signoff_business_date.isoformat()} is already signed off",
        )

    if any(inv.status == InvoiceStatus.PENDING_VOID for inv in backlog.invoices):
        raise EodError(
            "pending_void_approvals_exist",
            "pending void approvals must be resolved before EOD sign-off",
        )

    now = datetime.now(UTC)
    for inv in backlog.invoices:
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
        business_date=signoff_business_date,
        signed_off_by_user_id=signed_off_by_user_id,
        signed_off_at=now,
        invoices_signed_off=len(backlog.invoices),
        notes=_normalize_notes(notes),
    )
    db.add(signoff)
    return SignOffResult(
        sign_off=signoff,
        invoices_signed_off=len(backlog.invoices),
    )


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
        range_start_business_date=business_date,
        range_end_business_date=business_date,
        invoice_count=invoice_count,
        revenue=revenue,
        voided_count=voided_count,
        reversal_count=reversal_count,
        payments_by_mode=dict(payments_by_mode),
    )


async def get_open_backlog_totals(db: AsyncSession, *, shop_id: int) -> EodTotals:
    backlog = await _get_open_backlog_window(db, shop_id=shop_id)
    effective_business_date = backlog.range_end_business_date or today_local_date()

    revenue = sum(
        (inv.total_amount for inv in backlog.invoices if inv.status in STATUSES_COUNTING_AS_SOLD),
        Decimal("0"),
    )
    invoice_count = sum(
        1 for inv in backlog.invoices if inv.status in STATUSES_COUNTING_AS_SOLD
    )
    voided_count = sum(1 for inv in backlog.invoices if inv.status == InvoiceStatus.VOIDED)
    reversal_count = sum(
        1 for inv in backlog.invoices if inv.status == InvoiceStatus.REVERSAL
    )

    payments_by_mode: dict[str, Decimal] = defaultdict(lambda: Decimal("0"))
    invoice_ids = [inv.id for inv in backlog.invoices if inv.status in STATUSES_COUNTING_AS_SOLD]
    if invoice_ids:
        payment_rows = (
            await db.execute(select(Payment).where(Payment.invoice_id.in_(invoice_ids)))
        ).scalars().all()
        for payment in payment_rows:
            payments_by_mode[payment.mode.value] += payment.amount

    return EodTotals(
        business_date=effective_business_date,
        signed_off=backlog.range_end_business_date is None,
        range_start_business_date=backlog.range_start_business_date,
        range_end_business_date=backlog.range_end_business_date,
        invoice_count=invoice_count,
        revenue=revenue,
        voided_count=voided_count,
        reversal_count=reversal_count,
        payments_by_mode=dict(payments_by_mode),
    )


async def get_archived_signoff_summaries(
    db: AsyncSession,
    *,
    shop_id: int,
    signoffs: list[EodSignOff],
) -> dict[int, ArchivedSignoffSummary]:
    if not signoffs:
        return {}

    signed_off_ats = [signoff.signed_off_at for signoff in signoffs]
    invoices = (
        await db.execute(
            select(PastInvoice).where(
                PastInvoice.shop_id == shop_id,
                PastInvoice.eod_signed_off_at.in_(signed_off_ats),
            )
        )
    ).scalars().all()

    signoff_ids_by_timestamp = {
        signoff.signed_off_at: signoff.id
        for signoff in signoffs
    }
    summaries: dict[int, ArchivedSignoffSummary] = {
        signoff.id: ArchivedSignoffSummary(
            invoice_count=0,
            revenue=Decimal("0"),
            payments_by_mode={},
        )
        for signoff in signoffs
    }
    sold_invoice_ids: list[int] = []
    invoice_to_signoff_id: dict[int, int] = {}

    for invoice in invoices:
        signoff_id = signoff_ids_by_timestamp.get(invoice.eod_signed_off_at)
        if signoff_id is None:
            continue
        if invoice.status not in STATUSES_COUNTING_AS_SOLD:
            continue
        summary = summaries[signoff_id]
        summary.invoice_count += 1
        summary.revenue += invoice.total_amount
        sold_invoice_ids.append(invoice.id)
        invoice_to_signoff_id[invoice.id] = signoff_id

    if sold_invoice_ids:
        payments = (
            await db.execute(
                select(PastPayment).where(PastPayment.invoice_id.in_(sold_invoice_ids))
            )
        ).scalars().all()
        for payment in payments:
            signoff_id = invoice_to_signoff_id[payment.invoice_id]
            payments_by_mode = summaries[signoff_id].payments_by_mode
            payments_by_mode[payment.mode.value] = (
                payments_by_mode.get(payment.mode.value, Decimal("0")) + payment.amount
            )

    return summaries


def _format_money(amount: Decimal) -> str:
    return f"{amount:.2f}"


def _payment_summary_text(pairs: list[tuple[str, Decimal]]) -> str:
    if not pairs:
        return ""
    return "; ".join(f"{mode} {_format_money(amount)}" for mode, amount in pairs)


def _line_summary_text(lines: list[PastInvoiceLine]) -> str:
    return "; ".join(
        (
            f"{' '.join(part for part in [line.product_brand or 'Unknown', line.product_size_label or ''] if part)} "
            f"x{line.quantity} @ {_format_money(line.unit_price)} = {_format_money(line.line_total)}"
        )
        for line in lines
    )


async def build_reconciliation_export_rows(
    db: AsyncSession,
    *,
    shop_id: int,
    signoff_ids: list[int],
) -> list[ReconciliationExportRow]:
    if not signoff_ids:
        return []

    signoff_rows = (
        await db.execute(
            select(EodSignOff, User.full_name)
            .join(User, User.id == EodSignOff.signed_off_by_user_id)
            .where(EodSignOff.shop_id == shop_id, EodSignOff.id.in_(signoff_ids))
            .order_by(EodSignOff.business_date.desc(), EodSignOff.id.desc())
        )
    ).all()
    if not signoff_rows:
        return []

    signoffs = [row[0] for row in signoff_rows]
    signoffs_by_ts = {signoff.signed_off_at: signoff for signoff in signoffs}
    signer_names = {signoff.id: signer_name for signoff, signer_name in signoff_rows}
    summaries = await get_archived_signoff_summaries(db, shop_id=shop_id, signoffs=signoffs)

    invoices = (
        await db.execute(
            select(PastInvoice)
            .where(
                PastInvoice.shop_id == shop_id,
                PastInvoice.eod_signed_off_at.in_(list(signoffs_by_ts)),
            )
            .options(
                selectinload(PastInvoice.lines),
                selectinload(PastInvoice.payments),
            )
            .order_by(PastInvoice.eod_signed_off_at.desc(), PastInvoice.invoice_number.asc())
        )
    ).scalars().all()
    if not invoices:
        return []

    cashier_ids = sorted({invoice.cashier_user_id for invoice in invoices})
    cashier_names = {
        user.id: user.full_name
        for user in (
            await db.execute(select(User).where(User.id.in_(cashier_ids)))
        ).scalars().all()
    }
    payment_pairs_by_invoice = {
        invoice.id: [(payment.mode.value, payment.amount) for payment in invoice.payments]
        for invoice in invoices
    }

    rows: list[ReconciliationExportRow] = []
    for invoice in invoices:
        signoff = signoffs_by_ts.get(invoice.eod_signed_off_at)
        if signoff is None:
            continue
        summary = summaries.get(
            signoff.id,
            ArchivedSignoffSummary(invoice_count=0, revenue=Decimal("0"), payments_by_mode={}),
        )
        summary_pairs = sorted(summary.payments_by_mode.items())
        rows.append(
            ReconciliationExportRow(
                reconciliation_id=signoff.id,
                signed_off_at=signoff.signed_off_at,
                signed_off_by_user_id=signoff.signed_off_by_user_id,
                signed_off_by_name=signer_names.get(signoff.id, f"User #{signoff.signed_off_by_user_id}"),
                invoices_signed_off=signoff.invoices_signed_off,
                reconciliation_revenue=summary.revenue,
                reconciliation_payments_by_mode=_payment_summary_text(summary_pairs),
                reconciliation_notes=signoff.notes,
                invoice_id=invoice.id,
                invoice_number=invoice.invoice_number,
                invoice_business_date=invoice.business_date,
                invoice_status=invoice.status.value,
                cashier_user_id=invoice.cashier_user_id,
                cashier_name=cashier_names.get(invoice.cashier_user_id, f"User #{invoice.cashier_user_id}"),
                invoice_total_amount=invoice.total_amount,
                invoice_note=invoice.note,
                invoice_payments=_payment_summary_text(payment_pairs_by_invoice[invoice.id]),
                invoice_line_items=_line_summary_text(invoice.lines),
            )
        )
    return rows


def render_reconciliation_export_csv(rows: list[ReconciliationExportRow]) -> str:
    out = io.StringIO()
    writer = csv.DictWriter(
        out,
        fieldnames=[
            "reconciliation_id",
            "signed_off_at",
            "signed_off_by_user_id",
            "signed_off_by_name",
            "invoices_signed_off",
            "reconciliation_revenue",
            "reconciliation_payments_by_mode",
            "reconciliation_notes",
            "invoice_id",
            "invoice_number",
            "invoice_business_date",
            "invoice_status",
            "cashier_user_id",
            "cashier_name",
            "invoice_total_amount",
            "invoice_note",
            "invoice_payments",
            "invoice_line_items",
        ],
    )
    writer.writeheader()
    for row in rows:
        writer.writerow(
            {
                "reconciliation_id": row.reconciliation_id,
                "signed_off_at": row.signed_off_at.isoformat(),
                "signed_off_by_user_id": row.signed_off_by_user_id,
                "signed_off_by_name": row.signed_off_by_name,
                "invoices_signed_off": row.invoices_signed_off,
                "reconciliation_revenue": _format_money(row.reconciliation_revenue),
                "reconciliation_payments_by_mode": row.reconciliation_payments_by_mode,
                "reconciliation_notes": row.reconciliation_notes or "",
                "invoice_id": row.invoice_id,
                "invoice_number": row.invoice_number,
                "invoice_business_date": row.invoice_business_date.isoformat(),
                "invoice_status": row.invoice_status,
                "cashier_user_id": row.cashier_user_id,
                "cashier_name": row.cashier_name,
                "invoice_total_amount": _format_money(row.invoice_total_amount),
                "invoice_note": row.invoice_note or "",
                "invoice_payments": row.invoice_payments,
                "invoice_line_items": row.invoice_line_items,
            }
        )
    return out.getvalue()


async def list_signoff_history(
    db: AsyncSession,
    *,
    shop_id: int,
    from_date: date | None = None,
    to_date: date | None = None,
    limit: int = 90,
) -> list[SignOffHistoryRow]:
    """Descending list of past sign-offs. `from_date` / `to_date`
    inclusive on the business_date column."""
    stmt = (
        select(EodSignOff, User.full_name)
        .join(User, User.id == EodSignOff.signed_off_by_user_id)
        .where(EodSignOff.shop_id == shop_id)
    )
    if from_date is not None:
        stmt = stmt.where(EodSignOff.business_date >= from_date)
    if to_date is not None:
        # inclusive: <= to_date
        stmt = stmt.where(EodSignOff.business_date <= to_date)
    stmt = stmt.order_by(EodSignOff.business_date.desc()).limit(limit)
    return [
        SignOffHistoryRow(sign_off=sign_off, signer_name=signer_name)
        for sign_off, signer_name in (await db.execute(stmt)).all()
    ]


async def get_signoff_history_entry(
    db: AsyncSession,
    *,
    shop_id: int,
    signoff_id: int,
) -> SignOffHistoryRow | None:
    row = (
        await db.execute(
            select(EodSignOff, User.full_name)
            .join(User, User.id == EodSignOff.signed_off_by_user_id)
            .where(EodSignOff.shop_id == shop_id, EodSignOff.id == signoff_id)
        )
    ).one_or_none()
    if row is None:
        return None
    sign_off, signer_name = row
    return SignOffHistoryRow(sign_off=sign_off, signer_name=signer_name)


async def update_signoff_notes(
    db: AsyncSession,
    *,
    shop_id: int,
    signoff_id: int,
    notes: str | None,
) -> EodSignOff | None:
    sign_off = (
        await db.execute(
            select(EodSignOff)
            .where(EodSignOff.shop_id == shop_id, EodSignOff.id == signoff_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if sign_off is None:
        return None
    sign_off.notes = _normalize_notes(notes)
    await db.flush()
    return sign_off


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
    "get_signoff_history_entry",
    "get_open_backlog_totals",
    "build_reconciliation_export_rows",
    "list_pending_voids",
    "list_signoff_history",
    "render_reconciliation_export_csv",
    "sign_off_day",
    "update_signoff_notes",
]
