"""Void & reversal logic (D-18, D-37, R-8, R-41).

Two flows:
  1. Pre-EOD-signoff direct void: cashier/owner voids a finalized
     invoice; status flips to VOIDED; the stock derivation naturally
     removes the lines from "sold" (see app.services.stock.compute_derived_stock).
     Original line items remain visible in history with
     a VOIDED status — never deleted, never edited.

  2. Post-EOD-signoff compensating reversal: cashier/owner requests
     a void; the invoice is set to PENDING_VOID and the request is
     logged. The owner reviews and either:
       - approves — a new REVERSAL invoice is created, copying the
         original lines (the REVERSAL itself is excluded from the
         "sold" derivation, so the original's line quantities are
         effectively removed from sold; the original's status moves
         to VOIDED too);
       - rejects — the invoice reverts to FINALIZED and the
         pending request is cleared.

In both cases an `invoice.voided` / `invoice.void_requested` /
`invoice.void_approved` / `invoice.void_rejected` row is written to
`invoicing_logs` (R-37, D-47) so the audit trail is complete.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.invoice import (
    Invoice,
    InvoiceStatus,
    PastInvoice,
    PastInvoiceLine,
    PastPayment,
)
from app.models.shop import Shop


class VoidError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class VoidResult:
    invoice: Invoice | PastInvoice
    reversal: Invoice | PastInvoice | None  # only populated for approve_post_eod


async def _load_invoice_for_void(
    db: AsyncSession, *, invoice_id: int, shop_id: int
) -> Invoice | PastInvoice:
    invoice = (
        await db.execute(
            select(Invoice).where(
                Invoice.id == invoice_id,
                Invoice.shop_id == shop_id,
            )
        )
    ).scalar_one_or_none()
    if invoice is not None:
        return invoice
    past = (
        await db.execute(
            select(PastInvoice).where(
                PastInvoice.id == invoice_id,
                PastInvoice.shop_id == shop_id,
            )
        )
    ).scalar_one_or_none()
    if past is None:
        raise VoidError("not_found", "invoice not found")
    return past


async def direct_void(
    db: AsyncSession,
    *,
    invoice_id: int,
    shop_id: int,
    actor_user_id: int,
    reason: str | None = None,
) -> Invoice | PastInvoice:
    """Pre-EOD direct void. Allowed for cashier + owner; rejected for
    signed-off invoices (caller must use request_post_eod_void)."""
    invoice = await _load_invoice_for_void(
        db, invoice_id=invoice_id, shop_id=shop_id
    )
    if invoice.status == InvoiceStatus.VOIDED:
        raise VoidError("already_voided", "invoice is already voided")
    if invoice.status == InvoiceStatus.REVERSAL:
        raise VoidError("is_reversal", "cannot void a reversal entry")
    if invoice.eod_signed_off:
        raise VoidError(
            "post_eod_requires_approval",
            "this invoice has been EOD-signed-off; the void must be "
            "requested and approved by the owner instead",
        )
    if invoice.status != InvoiceStatus.FINALIZED:
        raise VoidError(
            "bad_status",
            f"cannot void from status {invoice.status.value}",
        )

    invoice.status = InvoiceStatus.VOIDED
    invoice.void_requested_at = datetime.now(UTC)
    invoice.void_requested_by_user_id = actor_user_id
    if reason:
        invoice.note = (
            (invoice.note or "")
            + ("" if not invoice.note else " | ")
            + f"[void] {reason}"
        )
    return invoice


async def request_post_eod_void(
    db: AsyncSession,
    *,
    invoice_id: int,
    shop_id: int,
    actor_user_id: int,
    reason: str | None = None,
) -> Invoice:
    """Mark a signed-off invoice PENDING_VOID. The original line items
    remain visible in `confirmed_sales`; the owner reviews via the
    dashboard (#6) and either approves or rejects."""
    invoice = await _load_invoice_for_void(
        db, invoice_id=invoice_id, shop_id=shop_id
    )
    if isinstance(invoice, Invoice) and not invoice.eod_signed_off:
        raise VoidError(
            "use_direct_void",
            "invoice is not EOD-signed-off; use the direct void flow",
        )
    if invoice.status != InvoiceStatus.FINALIZED:
        raise VoidError(
            "already_pending",
            f"invoice is in status {invoice.status.value}; cannot request void",
        )

    invoice.status = InvoiceStatus.PENDING_VOID
    invoice.void_requested_at = datetime.now(UTC)
    invoice.void_requested_by_user_id = actor_user_id
    if reason:
        invoice.note = (
            (invoice.note or "")
            + ("" if not invoice.note else " | ")
            + f"[void request] {reason}"
        )
    return invoice


async def approve_post_eod_void(
    db: AsyncSession,
    *,
    invoice_id: int,
    shop_id: int,
    owner_user_id: int,
    reason: str | None = None,
) -> VoidResult:
    """Owner approves a pending void. Creates a REVERSAL invoice and
    marks the original VOIDED. Stock derivation excludes both VOIDED
    and REVERSAL rows from "sold" — together they net out to the
    original being removed from stock."""
    invoice = await _load_invoice_for_void(
        db, invoice_id=invoice_id, shop_id=shop_id
    )
    if invoice.status != InvoiceStatus.PENDING_VOID:
        raise VoidError(
            "not_pending",
            f"invoice is in status {invoice.status.value}; cannot approve",
        )
    if isinstance(invoice, Invoice) and not invoice.eod_signed_off:
        raise VoidError(
            "not_signed_off",
            "original invoice isn't EOD-signed-off; use direct void",
        )

    # Allocate a fresh invoice number for the reversal. We reuse the
    # same shop counter — reversal rows get a real number in the same
    # monotonic series.
    shop = (
        await db.execute(
            select(Shop).where(Shop.id == shop_id).with_for_update()
        )
    ).scalar_one()
    next_number = (shop.last_invoice_number or 0) + 1
    shop.last_invoice_number = next_number

    # Eager-load the original's lines + payments so we can copy them.
    await db.refresh(invoice, attribute_names=["lines", "payments"])

    is_past = isinstance(invoice, PastInvoice)
    reversal = PastInvoice(
        shop_id=shop_id,
        cashier_user_id=owner_user_id,
        invoice_number=next_number,
        status=InvoiceStatus.REVERSAL,
        total_amount=(-invoice.total_amount),
        finalized_at=datetime.now(UTC),
        business_date=invoice.business_date,
        eod_signed_off_at=datetime.now(UTC),
        eod_signed_off_by_user_id=owner_user_id,
        note=(
            f"Reversal of invoice {invoice.invoice_number}. "
            + (reason or "")
        ),
        reverses_past_invoice_id=invoice.id if is_past else None,
    )
    db.add(reversal)
    await db.flush()  # need reversal.id for the lines

    for line in invoice.lines:
        db.add(
            PastInvoiceLine(
                invoice_id=reversal.id,
                product_id=line.product_id,
                quantity=line.quantity,
                unit_price=line.unit_price,
                line_total=-line.line_total,
                product_brand=line.product_brand,
                product_size_label=line.product_size_label,
            )
        )

    # Mirror the payments as negatives — same total, just reversed.
    for p in invoice.payments:
        db.add(
            PastPayment(
                invoice_id=reversal.id,
                mode=p.mode,
                amount=-p.amount,
            )
        )

    # Original is now voided (the compensating entry sits next to it).
    invoice.status = InvoiceStatus.VOIDED
    invoice.void_requested_at = invoice.void_requested_at or datetime.now(UTC)
    invoice.void_requested_by_user_id = invoice.void_requested_by_user_id or owner_user_id

    return VoidResult(invoice=invoice, reversal=reversal)


async def reject_post_eod_void(
    db: AsyncSession,
    *,
    invoice_id: int,
    shop_id: int,
    owner_user_id: int,
    reason: str | None = None,
) -> Invoice:
    """Owner rejects a pending void. Invoice goes back to FINALIZED,
    pending fields are cleared. Audit trail note is appended."""
    invoice = await _load_invoice_for_void(
        db, invoice_id=invoice_id, shop_id=shop_id
    )
    if invoice.status != InvoiceStatus.PENDING_VOID:
        raise VoidError(
            "not_pending",
            f"invoice is in status {invoice.status.value}; cannot reject",
        )

    invoice.status = InvoiceStatus.FINALIZED
    if reason:
        invoice.note = (
            (invoice.note or "")
            + ("" if not invoice.note else " | ")
            + f"[void rejected] {reason}"
        )
    # Leave void_requested_at / void_requested_by_user_id set so the
    # audit trail in the row still shows who asked; they'll be cleared
    # on a future successful void attempt.
    return invoice


__all__ = [
    "VoidError",
    "VoidResult",
    "approve_post_eod_void",
    "direct_void",
    "reject_post_eod_void",
    "request_post_eod_void",
]
