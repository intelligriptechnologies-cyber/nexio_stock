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

from datetime import date as date_cls
from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api._errors import map_error_to_http
from app.api._logs import write_business_log
from app.api.deps import DbSession, require_role, resolve_write_shop_id
from app.db import unit_of_work
from app.logging_config import get_logger
from app.models.invoice import Invoice
from app.models.log import InvoicingLog
from app.models.user import User, UserRole
from app.schemas.checkout import (
    CheckoutFinalizeRequest,
    CheckoutFinalizeResponse,
    InvoiceListResponse,
    InvoiceListRow,
    InvoicePublic,
)
from app.services._line_snapshots import resolve_missing_snapshots
from app.services.checkout import (
    CartLine,
    CheckoutError,
    PaymentLine,
    finalize_checkout,
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
    # Issue #26: a pending product in the cart is the cashier's
    # "Pending — no price yet, contact admin" case. 400 because the
    # request is malformed from the cart's perspective; the cashier
    # is expected to remove the line and retry.
    "pending_product_in_cart": status.HTTP_400_BAD_REQUEST,
}


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


# Issue #44 — invoices list is open to all four roles with the same
# role-scoping matrix as the single-invoice read. Cashier/receiver
# see only their own invoices (R-v3-15); owner/superadmin see all
# within their shop scope.
_invoice_reader_roles = (
    UserRole.CASHIER_USER,
    UserRole.RECEIVER_USER,
    UserRole.OWNER,
    UserRole.SUPERADMIN,
)


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
    "/invoices",
    response_model=InvoiceListResponse,
    summary=(
        "Paginated, filterable invoices list (issue #44, R-v3-9). "
        "Filters: date range, shop, payment mode, signed-off status, "
        "cashier/creator. Role-scoping (R-v3-15): owner/superadmin see "
        "every invoice in scope; cashier/receiver see only invoices they "
        "personally created."
    ),
)
async def list_invoices(
    db: DbSession,
    _user: User = Depends(require_role(*_invoice_reader_roles)),
    page: Annotated[int, Query(ge=1)] = 1,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    from_date: Annotated[
        date_cls | None,
        Query(description="Filter by finalized_at >= from_date (YYYY-MM-DD, local)"),
    ] = None,
    to_date: Annotated[
        date_cls | None,
        Query(description="Filter by finalized_at <= to_date (YYYY-MM-DD, local)"),
    ] = None,
    shop_id: Annotated[
        int | None,
        Query(description="Superadmin-only (D-65): target shop"),
    ] = None,
    payment_mode: Annotated[
        str | None,
        Query(description="Filter by payment mode (cash|upi|card)"),
    ] = None,
    signed_off: Annotated[
        bool | None,
        Query(description="Filter by eod_signed_off flag"),
    ] = None,
    cashier_user_id: Annotated[
        int | None,
        Query(description="Filter by cashier (creator) user id"),
    ] = None,
) -> InvoiceListResponse:
    from app.models.user import User as UserModel

    # Role-scoping (R-v3-15): cashier/receiver always pinned to their own
    # user_id; owner/superadmin may filter via cashier_user_id. resolve_write_shop_id
    # gives superadmin a 400 if they haven't picked a shop.
    actor_shop_id = await resolve_write_shop_id(db, _user, shop_id)

    # Build the base query.
    stmt = select(Invoice).where(Invoice.shop_id == actor_shop_id)

    # R-v3-15 narrowest default for cashier/receiver.
    if _user.role in (UserRole.CASHIER_USER, UserRole.RECEIVER_USER):
        stmt = stmt.where(Invoice.cashier_user_id == _user.id)
    elif cashier_user_id is not None:
        stmt = stmt.where(Invoice.cashier_user_id == cashier_user_id)

    if from_date is not None:
        # Day bounds: from_date 00:00 to to_date 23:59:59.999 (inclusive).
        # Use server-local midnight for consistency with _day_bounds in
        # app/services/eod.py — same convention the rest of the codebase
        # uses for business-date filtering.
        from datetime import datetime as _dt
        from app.services.eod import _day_bounds as _bounds  # type: ignore
        start_dt, _ = _bounds(from_date)
        stmt = stmt.where(Invoice.finalized_at >= start_dt)
    if to_date is not None:
        from app.services.eod import _day_bounds as _bounds  # type: ignore
        _, end_dt = _bounds(to_date)
        # _day_bounds returns the start of the NEXT day as end_exclusive;
        # for a "to_date inclusive" filter we want <= end of to_date.
        from datetime import timedelta
        end_of_day = end_dt - timedelta(microseconds=1)
        stmt = stmt.where(Invoice.finalized_at <= end_of_day)

    if signed_off is not None:
        stmt = stmt.where(Invoice.eod_signed_off == signed_off)

    # Total count BEFORE pagination (so the UI can render page controls).
    count_stmt = select(func.count()).select_from(stmt.subquery())
    total = (await db.execute(count_stmt)).scalar_one()

    # Page slice + ordering (most recent first — invoice numbers are
    # monotonic per shop, so this is also stable).
    rows = (
        await db.execute(
            stmt.order_by(Invoice.finalized_at.desc(), Invoice.id.desc())
            .limit(limit)
            .offset((page - 1) * limit)
        )
    ).scalars().all()

    # Pre-fetch cashier names in one query (avoid N+1 on the row builder).
    cashier_ids = {row.cashier_user_id for row in rows}
    cashier_names: dict[int, str] = {}
    if cashier_ids:
        names = (
            await db.execute(
                select(UserModel.id, UserModel.full_name).where(
                    UserModel.id.in_(cashier_ids)
                )
            )
        ).all()
        cashier_names = {r.id: r.full_name for r in names}

    # Filter by payment_mode is a payment-side join — apply it AFTER the
    # main fetch so the simple filters above stay index-friendly. If the
    # filter narrows the result below `limit`, the page is short and the
    # caller can paginate further. For 2000-invoice/day scale this stays
    # fine because payment count per invoice is small (1-3 rows).
    filtered = rows
    if payment_mode is not None:
        from app.models.invoice import Payment as PaymentModel

        invoice_ids = [r.id for r in rows]
        if invoice_ids:
            paid_rows = (
                await db.execute(
                    select(PaymentModel.invoice_id).where(
                        PaymentModel.invoice_id.in_(invoice_ids),
                        PaymentModel.mode == payment_mode,
                    )
                )
            ).all()
            paid_ids = {r.invoice_id for r in paid_rows}
            filtered = [r for r in rows if r.id in paid_ids]

    return InvoiceListResponse(
        invoices=[
            InvoiceListRow(
                id=row.id,
                invoice_number=row.invoice_number,
                shop_id=row.shop_id,
                cashier_user_id=row.cashier_user_id,
                cashier_name=cashier_names.get(row.cashier_user_id, ""),
                status=row.status,
                total_amount=row.total_amount,
                finalized_at=row.finalized_at,
                eod_signed_off=row.eod_signed_off,
            )
            for row in filtered
        ],
        total=total,
        page=page,
        limit=limit,
    )


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