"""Void & reversal routes (D-18, D-37, R-8, R-41).

Endpoints (all require a bearer token):
  POST /invoices/{id}/void            cashier requests approval;
                                       owner/superadmin fully voids
  POST /invoices/{id}/void/approve    owner approves a pending void,
                                       creates the REVERSAL invoice
  POST /invoices/{id}/void/reject     owner rejects a pending void

Authorization:
  - request void: cashier + owner (+ superadmin, any shop, D-64)
  - approve / reject: owner (+ superadmin, any shop, D-64); not
    cashier (D-25)

Every state change writes one `invoicing_logs` row with the before /
after state and the acting user.
"""
from __future__ import annotations

from fastapi import APIRouter, Body, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api._errors import map_error_to_http
from app.api._logs import write_business_log
from app.api.deps import DbSession, require_no_offline_session_lock, require_role
from app.db import unit_of_work
from app.logging_config import get_logger
from app.models.invoice import Invoice, InvoiceStatus, PastInvoice
from app.models.log import InvoicingLog
from app.models.user import User, UserRole
from app.schemas.checkout import InvoicePublic
from app.services.voids import (
    VoidError,
    approve_post_eod_void,
    direct_void_or_reversal,
    reject_post_eod_void,
    request_void_approval,
)

router = APIRouter(prefix="/invoices", tags=["invoices"])
log = get_logger(__name__)

_request_void_roles = (UserRole.CASHIER_USER, UserRole.OWNER, UserRole.SUPERADMIN)
_owner_only = (UserRole.OWNER, UserRole.SUPERADMIN)


async def _resolve_void_shop_id(db: AsyncSession, user: User, invoice_id: int) -> int:
    """Shop for a void action on an existing invoice (D-64).

    Owner/cashier are scoped to their own shop as before — cross-shop
    invoice_ids simply don't resolve (tenant isolation is preserved via
    the shop_id filter downstream). Superadmin has no shop_id of its own,
    but the invoice itself unambiguously names its shop, so there's
    nothing to ask superadmin to supply — we just look it up.
    """
    if user.role != UserRole.SUPERADMIN:
        return user.shop_id

    from sqlalchemy import select

    shop_id = (
        await db.execute(select(Invoice.shop_id).where(Invoice.id == invoice_id))
    ).scalar_one_or_none()
    if shop_id is None:
        shop_id = (
            await db.execute(select(PastInvoice.shop_id).where(PastInvoice.id == invoice_id))
        ).scalar_one_or_none()
    if shop_id is None:
        _not_found()
    return shop_id


_VOID_CODE_TO_STATUS: dict[str, int] = {
    "not_found": status.HTTP_404_NOT_FOUND,
    "already_voided": status.HTTP_409_CONFLICT,
    "is_reversal": status.HTTP_409_CONFLICT,
    "already_pending": status.HTTP_409_CONFLICT,
    "not_pending": status.HTTP_409_CONFLICT,
    "use_direct_void": status.HTTP_409_CONFLICT,
    "post_eod_requires_approval": status.HTTP_409_CONFLICT,
    "not_signed_off": status.HTTP_409_CONFLICT,
    "bad_status": status.HTTP_409_CONFLICT,
    "cashier_not_invoice_owner": status.HTTP_403_FORBIDDEN,
}


@router.post(
    "/{invoice_id}/void",
    response_model=InvoicePublic,
    summary="Request or perform a void based on actor role",
)
async def request_void(
    invoice_id: int,
    db: DbSession,
    _user: User = Depends(require_role(*_request_void_roles)),
    reason: str | None = Body(default=None, embed=True),
) -> InvoicePublic:
    actor_id = _user.id
    actor_shop_id = await _resolve_void_shop_id(db, _user, invoice_id)
    await require_no_offline_session_lock(
        db, shop_id=actor_shop_id, action="invoice void"
    )

    invoice = await _load_invoice(db, invoice_id, actor_shop_id)
    was_eod_signed_off = invoice.eod_signed_off
    original_status = invoice.status
    if _user.role == UserRole.CASHIER_USER and invoice.cashier_user_id != actor_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "cashier_not_invoice_owner",
                "message": "cashier can request void only for their own invoice",
            },
        )

    try:
        async with unit_of_work(db):
            if _user.role == UserRole.CASHIER_USER:
                updated = await request_void_approval(
                    db,
                    invoice_id=invoice_id,
                    shop_id=actor_shop_id,
                    actor_user_id=actor_id,
                    reason=reason,
                )
                event_type = "invoice.void_requested"
            else:
                result = await direct_void_or_reversal(
                    db,
                    invoice_id=invoice_id,
                    shop_id=actor_shop_id,
                    actor_user_id=actor_id,
                    reason=reason,
                )
                updated = result.invoice
                event_type = "invoice.voided"
    except VoidError as exc:
        raise map_error_to_http(
            exc,
            code_to_status=_VOID_CODE_TO_STATUS,
            log_event="void.unmapped_error_code",
        ) from exc

    await _write_void_log(
        db,
        actor_id=actor_id,
        shop_id=actor_shop_id,
        invoice=updated,
        event_type=event_type,
        from_status=original_status,
        to_status=updated.status,
        reason=reason,
    )
    await db.commit()

    log.info(
        "void.requested",
        actor_user_id=actor_id,
        shop_id=actor_shop_id,
        invoice_id=invoice_id,
        from_status=original_status.value,
        to_status=updated.status.value,
        eod_signed_off=was_eod_signed_off,
    )
    await db.refresh(updated, attribute_names=["lines", "payments"])
    return InvoicePublic.model_validate(updated)


@router.post(
    "/{invoice_id}/void/approve",
    response_model=InvoicePublic,
    summary="Owner approves a pending void — creates the REVERSAL invoice",
)
async def approve_void(
    invoice_id: int,
    db: DbSession,
    _user: User = Depends(require_role(*_owner_only)),
    reason: str | None = Body(default=None, embed=True),
) -> InvoicePublic:
    actor_id = _user.id
    actor_shop_id = await _resolve_void_shop_id(db, _user, invoice_id)
    await require_no_offline_session_lock(
        db, shop_id=actor_shop_id, action="void approval"
    )

    try:
        async with unit_of_work(db):
            result = await approve_post_eod_void(
                db,
                invoice_id=invoice_id,
                shop_id=actor_shop_id,
                owner_user_id=actor_id,
                reason=reason,
            )
    except VoidError as exc:
        raise map_error_to_http(
            exc,
            code_to_status=_VOID_CODE_TO_STATUS,
            log_event="void.unmapped_error_code",
        ) from exc

    await _write_void_log(
        db,
        actor_id=actor_id,
        shop_id=actor_shop_id,
        invoice=result.invoice,
        event_type="invoice.void_approved",
        from_status=InvoiceStatus.PENDING_VOID,
        to_status=InvoiceStatus.VOIDED,
        reason=reason,
        extra={"reversal_invoice_id": result.reversal.id if result.reversal else None},
    )
    await db.commit()

    log.info(
        "void.approved",
        actor_user_id=actor_id,
        shop_id=actor_shop_id,
        invoice_id=invoice_id,
        reversal_invoice_id=result.reversal.id if result.reversal else None,
    )
    await db.refresh(result.invoice, attribute_names=["lines", "payments"])
    return InvoicePublic.model_validate(result.invoice)


@router.post(
    "/{invoice_id}/void/reject",
    response_model=InvoicePublic,
    summary="Owner rejects a pending void — invoice reverts to FINALIZED",
)
async def reject_void(
    invoice_id: int,
    db: DbSession,
    _user: User = Depends(require_role(*_owner_only)),
    reason: str | None = Body(default=None, embed=True),
) -> InvoicePublic:
    actor_id = _user.id
    actor_shop_id = await _resolve_void_shop_id(db, _user, invoice_id)
    await require_no_offline_session_lock(
        db, shop_id=actor_shop_id, action="void rejection"
    )

    try:
        async with unit_of_work(db):
            updated = await reject_post_eod_void(
                db,
                invoice_id=invoice_id,
                shop_id=actor_shop_id,
                owner_user_id=actor_id,
                reason=reason,
            )
    except VoidError as exc:
        raise map_error_to_http(
            exc,
            code_to_status=_VOID_CODE_TO_STATUS,
            log_event="void.unmapped_error_code",
        ) from exc

    await _write_void_log(
        db,
        actor_id=actor_id,
        shop_id=actor_shop_id,
        invoice=updated,
        event_type="invoice.void_rejected",
        from_status=InvoiceStatus.PENDING_VOID,
        to_status=InvoiceStatus.FINALIZED,
        reason=reason,
    )
    await db.commit()

    log.info(
        "void.rejected",
        actor_user_id=actor_id,
        shop_id=actor_shop_id,
        invoice_id=invoice_id,
    )
    await db.refresh(updated, attribute_names=["lines", "payments"])
    return InvoicePublic.model_validate(updated)


# --- helpers ---


async def _load_invoice(
    db: AsyncSession, invoice_id: int, shop_id: int
) -> Invoice | PastInvoice:
    from sqlalchemy import select

    current = (
        await db.execute(
            select(Invoice).where(
                Invoice.id == invoice_id, Invoice.shop_id == shop_id
            )
        )
    ).scalar_one_or_none()
    if current is not None:
        return current
    return (
        await db.execute(
            select(PastInvoice).where(
                PastInvoice.id == invoice_id, PastInvoice.shop_id == shop_id
            )
        )
    ).scalar_one_or_none() or _not_found()


def _not_found() -> Invoice:
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND, detail="invoice not found"
    )


async def _write_void_log(
    db: AsyncSession,
    *,
    actor_id: int,
    shop_id: int,
    invoice: Invoice | PastInvoice,
    event_type: str,
    from_status: InvoiceStatus,
    to_status: InvoiceStatus,
    reason: str | None,
    extra: dict | None = None,
) -> None:
    payload = {
        "invoice_id": invoice.id,
        "invoice_number": invoice.invoice_number,
        "from_status": from_status.value,
        "to_status": to_status.value,
        "reason": reason,
    }
    if extra:
        payload.update(extra)
    write_business_log(
        db,
        InvoicingLog,
        event_type=event_type,
        actor_id=actor_id,
        shop_id=shop_id,
        payload=payload,
    )
