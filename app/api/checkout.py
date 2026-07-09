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

from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Body, Depends, Header, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api._errors import map_error_to_http
from app.api._logs import write_business_log
from app.api.deps import DbSession, require_role, resolve_read_shop_id, resolve_write_shop_id
from app.db import unit_of_work
from app.logging_config import get_logger
from app.models.invoice import Invoice, InvoiceStatus, PastInvoice, PaymentMode
from app.models.log import InvoicingLog
from app.models.user import User, UserRole
from app.schemas.checkout import (
    CartValidationLine,
    CartValidationRequest,
    CartValidationResponse,
    CheckoutFinalizeRequest,
    CheckoutFinalizeResponse,
    InvoiceEditRequest,
    InvoiceListResponse,
    InvoicePublic,
)
from app.services._line_snapshots import resolve_missing_snapshots
from app.services.checkout import (
    CartLine,
    CheckoutError,
    PaymentLine,
    finalize_checkout,
)
from app.services.invoices import (
    edit_current_invoice,
    list_current_invoices,
    list_past_invoices,
    validate_cart_quantities,
)

router = APIRouter(tags=["checkout"])
log = get_logger(__name__)

# Cashier-only for checkout; owner can also do it (D-26 superset);
# superadmin can too, for any shop, via an explicit shop_id (D-64/D-65).
_checkout_roles = (UserRole.CASHIER_USER, UserRole.OWNER, UserRole.SUPERADMIN)


# Maps the CheckoutError `code` to an HTTP status. Lives in module
# scope so map_error_to_http can capture it once.
_CHECKOUT_CODE_TO_STATUS: dict[str, int] = {
    "insufficient_stock": status.HTTP_409_CONFLICT,
    "unknown_barcode": status.HTTP_404_NOT_FOUND,
    "eod_signed_off": status.HTTP_409_CONFLICT,
    "idempotency_key_required": status.HTTP_400_BAD_REQUEST,
    "idempotency_key_too_long": status.HTTP_400_BAD_REQUEST,
    "empty_cart": status.HTTP_400_BAD_REQUEST,
    "bad_quantity": status.HTTP_400_BAD_REQUEST,
    "no_payments": status.HTTP_400_BAD_REQUEST,
    "zero_payment": status.HTTP_400_BAD_REQUEST,
    "payment_mismatch": status.HTTP_400_BAD_REQUEST,
    "not_found": status.HTTP_404_NOT_FOUND,
    "bad_status": status.HTTP_409_CONFLICT,
    # Issue #26: a pending product in the cart is the cashier's
    # "Pending — no price yet, contact admin" case. 400 because the
    # request is malformed from the cart's perspective; the cashier
    # is expected to remove the line and retry.
    "pending_product_in_cart": status.HTTP_400_BAD_REQUEST,
}


@router.post(
    "/checkout/validate",
    response_model=CartValidationResponse,
    summary="Validate cart quantities against fresh derived stock",
)
async def validate_checkout_cart(
    payload: CartValidationRequest,
    db: DbSession,
    _user: User = Depends(require_role(*_checkout_roles)),
) -> CartValidationResponse:
    actor_shop_id = await resolve_write_shop_id(db, _user, payload.shop_id)
    try:
        rows = await validate_cart_quantities(
            db,
            shop_id=actor_shop_id,
            cart=[CartLine(barcode=line.barcode, quantity=line.quantity) for line in payload.lines],
        )
    except CheckoutError as exc:
        raise map_error_to_http(
            exc,
            code_to_status=_CHECKOUT_CODE_TO_STATUS,
            log_event="checkout_validate.unmapped_error_code",
        ) from exc
    return CartValidationResponse(
        lines=[
            CartValidationLine(
                barcode=row.barcode,
                requested_quantity=row.requested_quantity,
                available_quantity=row.available_quantity,
                accepted_quantity=row.accepted_quantity,
                adjusted=row.adjusted,
            )
            for row in rows
        ]
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
    actor_shop_id = await resolve_write_shop_id(db, _user, payload.shop_id)

    cart = [
        CartLine(barcode=line.barcode, quantity=line.quantity)
        for line in payload.lines
    ]
    payments = [PaymentLine(mode=p.mode, amount=p.amount) for p in payload.payments]

    try:
        async with unit_of_work(db):
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
        raise map_error_to_http(
            exc,
            code_to_status=_CHECKOUT_CODE_TO_STATUS,
            log_event="checkout.unmapped_error_code",
        ) from exc

    invoice = result.invoice

    # Eager-load the lines + payments for the response (relationship is
    # lazy="select" by default; touching it sync from async raises).
    await db.refresh(invoice, attribute_names=["lines", "payments"])

    # Issue #38: fill in snapshot columns for any line that pre-dates
    # the snapshot migration (no-op for rows created after it). New
    # rows already carry their snapshot from the write path.
    await resolve_missing_snapshots(db, list(invoice.lines))

    # Write the invoicing_logs row for this finalize (R-37, D-47). One
    # log entry per finalized invoice; the payload is rich enough to
    # rebuild the cart from the log without joining invoice_lines.
    write_business_log(
        db,
        InvoicingLog,
        event_type="invoice.finalized",
        actor_id=actor_id,
        shop_id=actor_shop_id,
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


async def _load_invoice_or_404(db: AsyncSession, invoice_id: int) -> Invoice | PastInvoice:
    invoice = (
        await db.execute(
            select(Invoice)
            .where(Invoice.id == invoice_id)
            .options(selectinload(Invoice.lines), selectinload(Invoice.payments))
        )
    ).scalar_one_or_none()
    if invoice is not None:
        return invoice
    past = (
        await db.execute(
            select(PastInvoice)
            .where(PastInvoice.id == invoice_id)
            .options(selectinload(PastInvoice.lines), selectinload(PastInvoice.payments))
        )
    ).scalar_one_or_none()
    if past is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="invoice not found")
    return past


@router.get(
    "/invoices",
    response_model=InvoiceListResponse,
    summary="List current or past invoices with filters",
)
async def list_invoices(
    db: DbSession,
    _user: User = Depends(require_role(*_checkout_roles, UserRole.RECEIVER_USER)),
    source: Annotated[Literal["current", "past"], Query()] = "current",
    date_from: Annotated[date | None, Query()] = None,
    date_to: Annotated[date | None, Query()] = None,
    cashier_user_id: Annotated[int | None, Query(alias="cashier")] = None,
    payment_mode: Annotated[PaymentMode | None, Query()] = None,
    invoice_status: Annotated[InvoiceStatus | None, Query(alias="status")] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
    shop_id: Annotated[int | None, Query()] = None,
) -> InvoiceListResponse:
    scoped_shop_id = resolve_read_shop_id(_user, shop_id)
    if scoped_shop_id is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="shop_id is required")
    if source == "current":
        rows = await list_current_invoices(
            db,
            shop_id=scoped_shop_id,
            date_from=date_from,
            date_to=date_to,
            cashier_user_id=cashier_user_id,
            payment_mode=payment_mode,
            status=invoice_status,
            limit=limit,
            offset=offset,
        )
    else:
        rows = await list_past_invoices(
            db,
            shop_id=scoped_shop_id,
            date_from=date_from,
            date_to=date_to,
            cashier_user_id=cashier_user_id,
            payment_mode=payment_mode,
            status=invoice_status,
            limit=limit,
            offset=offset,
        )
    await resolve_missing_snapshots(db, [line for row in rows for line in row.lines])
    return InvoiceListResponse(invoices=[InvoicePublic.model_validate(row) for row in rows])


@router.patch(
    "/invoices/{invoice_id}",
    response_model=InvoicePublic,
    summary="Edit a current invoice before EOD with audit log",
)
async def edit_invoice(
    invoice_id: int,
    db: DbSession,
    _user: User = Depends(require_role(UserRole.CASHIER_USER, UserRole.OWNER, UserRole.SUPERADMIN)),
    payload: Annotated[InvoiceEditRequest | None, Body()] = None,
) -> InvoicePublic:
    if payload is None:
        raise HTTPException(status_code=status.HTTP_405_METHOD_NOT_ALLOWED, detail="request body required")
    existing = await _load_invoice_or_404(db, invoice_id)
    if isinstance(existing, PastInvoice) or existing.eod_signed_off:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="past invoices are view-only")
    if _user.role == UserRole.CASHIER_USER and existing.cashier_user_id != _user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="cashier can edit only their own current invoices")
    if _user.role != UserRole.SUPERADMIN and existing.shop_id != _user.shop_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="invoice not found")

    try:
        async with unit_of_work(db):
            result = await edit_current_invoice(
                db,
                invoice_id=invoice_id,
                shop_id=existing.shop_id,
                cart=[CartLine(barcode=line.barcode, quantity=line.quantity) for line in payload.lines],
                payments=[PaymentLine(mode=p.mode, amount=p.amount) for p in payload.payments],
                note=payload.note,
            )
            write_business_log(
                db,
                InvoicingLog,
                event_type="invoice.edited",
                actor_id=_user.id,
                shop_id=existing.shop_id,
                payload={"before": result.before, "after": result.after},
            )
    except CheckoutError as exc:
        raise map_error_to_http(
            exc,
            code_to_status=_CHECKOUT_CODE_TO_STATUS,
            log_event="invoice_edit.unmapped_error_code",
        ) from exc

    return InvoicePublic.model_validate(result.invoice)


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
    # Issue #38: backfill snapshot for any pre-migration line.
    await resolve_missing_snapshots(db, list(invoice.lines))
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

    # Issue #38: same backfill as the JSON read path — the PDF renders
    # straight off the ORM rows, so the snapshot must be present.
    await resolve_missing_snapshots(db, list(invoice.lines))

    # Render the PDF, passing shop-level config (#8) so the
    # GSTIN and configurable excise-duty placeholder line are
    # surfaced. No CGST/SGST percentage is hardcoded — the duty
    # rate is whatever the owner has set on the Shop row.
    from app.models.shop import Shop
    from app.services.invoice_pdf import render_invoice_pdf

    shop = await db.get(Shop, invoice.shop_id)
    pdf_bytes = render_invoice_pdf(
        invoice,
        shop_name=shop.name if shop is not None else "(unknown)",
        shop_gstin=shop.gstin if shop is not None else None,
        shop_excise_duty_rate=shop.excise_duty_rate if shop is not None else None,
    )
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": (
                f'inline; filename="invoice-{invoice.invoice_number:06d}.pdf"'
            )
        },
    )
