"""Checkout (invoice finalize) — R-8, R-12, R-13, R-14, R-24, R-43, D-30.

POST /checkout/finalize is the only mutating endpoint for the cashier
flow. It:
  - takes a cart (barcodes + quantities) and a list of payments,
  - requires an `Idempotency-Key` header,
  - runs the atomic finalize in `app.services.checkout` (row-locks
    on each affected Product, allocates the next invoice number,
    decrements stock under the lock, writes lines + payments +
    idempotency record),
  - returns the finalized Invoice.

GET /invoices/{id} returns the on-screen preview of a finalized
invoice. GET /invoices/{id}/pdf streams the printable PDF (R-43, D-62).

Invoicing-log writes happen in the route layer so the service stays
free of log-table coupling (D-47 / R-37).
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api.deps import DbSession, require_role
from app.logging_config import get_logger
from app.models.invoice import (
    Invoice,
)
from app.models.log import InvoicingLog
from app.models.user import User, UserRole
from app.schemas.checkout import (
    CheckoutFinalizeRequest,
    CheckoutFinalizeResponse,
    InvoicePublic,
)
from app.services.checkout import (
    CartLine,
    CheckoutError,
    PaymentLine,
    finalize_checkout,
)

router = APIRouter(tags=["checkout"])
log = get_logger(__name__)

# Cashier-only for checkout; owner can also do it (D-26 superset).
_checkout_roles = (UserRole.CASHIER_USER, UserRole.OWNER)


def _error_to_http(exc: CheckoutError) -> HTTPException:
    code = exc.code
    if code in ("insufficient_stock",):
        return HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": code, "message": exc.message},
        )
    if code in ("unknown_barcode",):
        return HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": code, "message": exc.message},
        )
    if code in (
        "idempotency_key_required",
        "idempotency_key_too_long",
        "empty_cart",
        "bad_quantity",
        "no_payments",
        "zero_payment",
        "payment_mismatch",
    ):
        return HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": code, "message": exc.message},
        )
    # Fallback — surface as 500, but log the unmapped code so we can
    # tighten the mapping later.
    log.error("checkout.unmapped_error_code", code=code, message=exc.message)
    return HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail={"code": code, "message": exc.message},
    )


@router.post(
    "/checkout/finalize",
    response_model=CheckoutFinalizeResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Cashier finalizes a cart into a paid invoice (atomic, idempotent)",
)
async def finalize(
    payload: CheckoutFinalizeRequest,
    db: DbSession,
    _user: User = Depends(require_role(*_checkout_roles)),
    idempotency_key: Annotated[
        str | None,
        Header(
            alias="Idempotency-Key",
            description="Required. Stable per-attempt key for retry dedup.",
        ),
    ] = None,
) -> CheckoutFinalizeResponse:
    # Eagerly capture so subsequent log writes / idempotency-key writes
    # don't trigger lazy loads on a detached User.
    actor_id = _user.id
    actor_shop_id = _user.shop_id

    cart = [
        CartLine(barcode=line.barcode, quantity=line.quantity)
        for line in payload.lines
    ]
    payments = [PaymentLine(mode=p.mode, amount=p.amount) for p in payload.payments]

    try:
        result = await finalize_checkout(
            db,
            shop_id=actor_shop_id,
            cashier_user_id=actor_id,
            cart=cart,
            payments=payments,
            idempotency_key=idempotency_key,
            note=payload.note,
        )
    except CheckoutError as exc:
        # Roll back any session state the partial run may have produced.
        await db.rollback()
        raise _error_to_http(exc) from exc

    # The service made the changes via the outer transaction; commit here.
    invoice = result.invoice
    await db.commit()

    # Eager-load the lines + payments for the response (relationship is
    # lazy="select" by default; touching it sync from async raises).
    await db.refresh(invoice, attribute_names=["lines", "payments"])

    # Write the invoicing_logs row for this finalize (R-37, D-47). One
    # log entry per finalized invoice; the payload is rich enough to
    # rebuild the cart from the log without joining invoice_lines.
    db.add(
        InvoicingLog(
            shop_id=actor_shop_id,
            actor_user_id=actor_id,
            event_type="invoice.finalized",
            payload={
                "invoice_id": invoice.id,
                "invoice_number": invoice.invoice_number,
                "total_amount": str(invoice.total_amount),
                "payments": [{"mode": p.mode.value, "amount": str(p.amount)} for p in invoice.payments],
                "lines": [
                    {
                        "product_id": line.product_id,
                        "quantity": line.quantity,
                        "unit_price": str(line.unit_price),
                        "line_total": str(line.line_total),
                    }
                    for line in invoice.lines
                ],
            },
        )
    )
    await db.commit()

    log.info(
        "checkout.finalized",
        actor_user_id=actor_id,
        shop_id=actor_shop_id,
        invoice_id=invoice.id,
        invoice_number=invoice.invoice_number,
        total=str(invoice.total_amount),
        line_count=len(invoice.lines),
        replay=result.is_replay,
    )

    body = InvoicePublic.model_validate(invoice)
    return CheckoutFinalizeResponse(invoice=body, is_replay=result.is_replay)


# --- invoice read + PDF ---


async def _load_invoice_or_404(db: AsyncSession, invoice_id: int) -> Invoice:
    invoice = (
        await db.execute(
            select(Invoice)
            .where(Invoice.id == invoice_id)
            .options(selectinload(Invoice.lines), selectinload(Invoice.payments))
        )
    ).scalar_one_or_none()
    if invoice is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="invoice not found")
    return invoice


@router.get(
    "/invoices/{invoice_id}",
    response_model=InvoicePublic,
    summary="Get a finalized invoice (on-screen preview)",
)
async def get_invoice(
    invoice_id: int,
    db: DbSession,
    _user: User = Depends(require_role(*_checkout_roles, UserRole.RECEIVER_USER, UserRole.SUPERADMIN)),
) -> InvoicePublic:
    actor_role = _user.role
    actor_shop_id = _user.shop_id

    invoice = await _load_invoice_or_404(db, invoice_id)
    if actor_role != UserRole.SUPERADMIN and invoice.shop_id != actor_shop_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="invoice not found")
    return InvoicePublic.model_validate(invoice)


@router.get(
    "/invoices/{invoice_id}/pdf",
    summary="Download the invoice as a PDF (R-43, D-62)",
    response_class=Response,
)
async def get_invoice_pdf(
    invoice_id: int,
    db: DbSession,
    _user: User = Depends(require_role(*_checkout_roles, UserRole.SUPERADMIN)),
) -> Response:
    actor_role = _user.role
    actor_shop_id = _user.shop_id

    invoice = await _load_invoice_or_404(db, invoice_id)
    if actor_role != UserRole.SUPERADMIN and invoice.shop_id != actor_shop_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="invoice not found")

    # Render the PDF.
    from app.services.invoice_pdf import render_invoice_pdf

    pdf_bytes = render_invoice_pdf(invoice)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": (
                f'inline; filename="invoice-{invoice.invoice_number:06d}.pdf"'
            )
        },
    )
