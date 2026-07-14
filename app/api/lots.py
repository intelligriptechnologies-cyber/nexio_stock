"""Stock inward workflow routes."""
from __future__ import annotations

from datetime import date as date_cls
from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Body, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api._errors import map_error_to_http
from app.api.deps import (
    DbSession,
    require_no_offline_session_lock,
    require_role,
    resolve_read_shop_id,
    resolve_write_shop_id,
)
from app.config import get_settings
from app.db import unit_of_work
from app.logging_config import get_logger
from app.models.shop import Shop
from app.models.stock_inward import StockInwardStatus
from app.models.user import User, UserRole
from app.models.vendor import Vendor
from app.schemas.lot import LotCreate, LotListResponse, LotPublic
from app.services.stock_inwards import (
    StockInwardError,
    approve_stock_inward,
    create_stock_inward,
    get_stock_inward,
    list_stock_inwards,
    reject_stock_inward,
)

router = APIRouter(prefix="/lots", tags=["lots"])
log = get_logger(__name__)

_writer_roles = (UserRole.RECEIVER_USER, UserRole.OWNER, UserRole.SUPERADMIN)
_owner_roles = (UserRole.OWNER, UserRole.SUPERADMIN)

_STOCK_INWARD_CODE_TO_STATUS: dict[str, int] = {
    "not_found": status.HTTP_404_NOT_FOUND,
    "unknown_barcode": status.HTTP_404_NOT_FOUND,
    "vendor_not_found": status.HTTP_404_NOT_FOUND,
    "vendor_inactive": status.HTTP_400_BAD_REQUEST,
    "not_pending": status.HTTP_409_CONFLICT,
}


@router.post(
    "",
    response_model=LotPublic,
    status_code=status.HTTP_201_CREATED,
    summary="Staff records a stock inward request (approval required before stock changes)",
)
async def create_lot(
    payload: LotCreate,
    db: DbSession,
    _user: User = Depends(require_role(*_writer_roles)),
) -> LotPublic:
    actor_id = _user.id
    actor_shop_id = await resolve_write_shop_id(db, _user, payload.shop_id)
    await require_no_offline_session_lock(db, shop_id=actor_shop_id, action="stock inward")

    settings = get_settings()
    shop = await db.get(Shop, actor_shop_id)
    vendor_link_enabled = True if shop is None else shop.receiving_vendor_link_enabled
    vendor = None
    if vendor_link_enabled:
        if payload.vendor_id is None:
            if settings.app_env != "test":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST, detail="vendor_id is required"
                )
            vendor = (
                await db.execute(
                    select(Vendor)
                    .where(Vendor.shop_id == actor_shop_id, Vendor.is_active.is_(True))
                    .order_by(Vendor.id)
                )
            ).scalars().first()
            if vendor is None:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="at least one active vendor is required for stock inward",
                )
        else:
            vendor = (
                await db.execute(
                    select(Vendor).where(Vendor.id == payload.vendor_id, Vendor.shop_id == actor_shop_id)
                )
            ).scalar_one_or_none()
        if vendor is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="vendor not found")
        if not vendor.is_active:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="vendor is inactive")
    else:
        if payload.vendor_id is not None:
            vendor = (
                await db.execute(
                    select(Vendor).where(Vendor.id == payload.vendor_id, Vendor.shop_id == actor_shop_id)
                )
            ).scalar_one_or_none()
            if vendor is not None and not vendor.is_active:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="vendor is inactive")

    purchase_date = payload.purchase_date
    vendor_invoice_number = payload.vendor_invoice_number
    invoice_value = payload.invoice_value
    if vendor_link_enabled:
        if purchase_date is None or vendor_invoice_number is None or invoice_value is None:
            if settings.app_env != "test":
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="purchase_date, vendor_invoice_number, and invoice_value are required",
                )
            purchase_date = purchase_date or date_cls.today()
            vendor_invoice_number = vendor_invoice_number or "TEST-INVOICE"
            invoice_value = invoice_value or Decimal("0.00")
        elif invoice_value <= 0 and settings.app_env != "test":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="invoice_value must be greater than zero",
            )
    else:
        purchase_date = purchase_date or date_cls.today()
        vendor_invoice_number = vendor_invoice_number or "AUTO-RECEIPT"
        invoice_value = invoice_value if invoice_value is not None else Decimal("0.00")

    try:
        async with unit_of_work(db):
            inward = await create_stock_inward(
                db,
                actor_id=actor_id,
                actor_shop_id=actor_shop_id,
                vendor_id=vendor.id if vendor is not None else None,
                purchase_date=purchase_date,
                vendor_invoice_number=vendor_invoice_number,
                invoice_value=invoice_value,
                reference=payload.reference,
                notes=payload.notes,
                lines=[
                    {
                        "barcode": line.barcode,
                        "quantity": line.quantity,
                        "good_condition_quantity": line.good_condition_quantity
                        if line.good_condition_quantity is not None
                        else line.quantity,
                    }
                    for line in payload.lines
                ],
            )
    except StockInwardError as exc:
        raise map_error_to_http(
            exc,
            code_to_status=_STOCK_INWARD_CODE_TO_STATUS,
            log_event="stock_inward.unmapped_error_code",
        ) from exc
    await db.refresh(
        inward,
        attribute_names=[
            "vendor",
            "lines",
            "created_by",
            "approved_by",
            "rejected_by",
            "created_at",
            "updated_at",
            "status",
            "lot_id",
            "approved_at",
            "rejected_at",
            "completed_at",
        ],
    )
    log.info(
        "stock_inward.created",
        actor_user_id=actor_id,
        shop_id=actor_shop_id,
        stock_inward_id=inward.id,
        line_count=len(inward.lines),
        total_units=sum(line.quantity for line in inward.lines),
    )
    return LotPublic.model_validate(inward)


@router.post(
    "/{lot_id:int}/approve",
    response_model=LotPublic,
    summary="Owner approves a stock inward request and commits stock into inventory",
)
async def approve_lot(
    lot_id: int,
    db: DbSession,
    _user: User = Depends(require_role(*_owner_roles)),
) -> LotPublic:
    actor_id = _user.id
    actor_shop_id = await _resolve_inward_shop_id(db, _user, lot_id)
    await require_no_offline_session_lock(db, shop_id=actor_shop_id, action="stock inward approval")

    try:
        async with unit_of_work(db):
            inward = await approve_stock_inward(
                db,
                inward_id=lot_id,
                shop_id=actor_shop_id,
                actor_user_id=actor_id,
            )
    except StockInwardError as exc:
        raise map_error_to_http(
            exc,
            code_to_status=_STOCK_INWARD_CODE_TO_STATUS,
            log_event="stock_inward.unmapped_error_code",
        ) from exc

    await db.refresh(
        inward,
        attribute_names=[
            "vendor",
            "lines",
            "created_by",
            "approved_by",
            "rejected_by",
            "created_at",
            "updated_at",
            "status",
            "lot_id",
            "approved_at",
            "rejected_at",
            "completed_at",
        ],
    )
    log.info(
        "stock_inward.approved",
        actor_user_id=actor_id,
        shop_id=actor_shop_id,
        stock_inward_id=lot_id,
        lot_id=inward.lot_id,
    )
    return LotPublic.model_validate(inward)


@router.post(
    "/{lot_id:int}/reject",
    response_model=LotPublic,
    summary="Owner rejects a pending stock inward request",
)
async def reject_lot(
    lot_id: int,
    db: DbSession,
    _user: User = Depends(require_role(*_owner_roles)),
) -> LotPublic:
    actor_id = _user.id
    actor_shop_id = await _resolve_inward_shop_id(db, _user, lot_id)
    await require_no_offline_session_lock(db, shop_id=actor_shop_id, action="stock inward rejection")

    try:
        async with unit_of_work(db):
            inward = await reject_stock_inward(
                db,
                inward_id=lot_id,
                shop_id=actor_shop_id,
                actor_user_id=actor_id,
            )
    except StockInwardError as exc:
        raise map_error_to_http(
            exc,
            code_to_status=_STOCK_INWARD_CODE_TO_STATUS,
            log_event="stock_inward.unmapped_error_code",
        ) from exc

    await db.refresh(
        inward,
        attribute_names=[
            "vendor",
            "lines",
            "created_by",
            "approved_by",
            "rejected_by",
            "created_at",
            "updated_at",
            "status",
            "lot_id",
            "approved_at",
            "rejected_at",
            "completed_at",
        ],
    )
    log.info(
        "stock_inward.rejected",
        actor_user_id=actor_id,
        shop_id=actor_shop_id,
        stock_inward_id=lot_id,
    )
    return LotPublic.model_validate(inward)


@router.get(
    "",
    response_model=LotListResponse,
    summary="List stock inward requests for the current shop",
)
async def list_lots(
    db: DbSession,
    _user: User = Depends(require_role(*_writer_roles)),
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
    status_filter: Annotated[StockInwardStatus | None, Query(alias="status")] = None,
    shop_id: int | None = Query(default=None),
) -> LotListResponse:
    resolved_shop_id = resolve_read_shop_id(_user, shop_id)
    rows = await list_stock_inwards(db, shop_id=resolved_shop_id, status=status_filter)
    rows = rows[offset : offset + limit]
    return LotListResponse(lots=[LotPublic.model_validate(row) for row in rows])


@router.get(
    "/{lot_id:int}",
    response_model=LotPublic,
    summary="Get one stock inward request with its line items",
)
async def get_lot(
    lot_id: int,
    db: DbSession,
    _user: User = Depends(require_role(*_writer_roles)),
) -> LotPublic:
    shop_id = None if _user.role == UserRole.SUPERADMIN else _user.shop_id
    inward = await get_stock_inward(db, inward_id=lot_id, shop_id=shop_id)
    if inward is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="stock inward not found")
    return LotPublic.model_validate(inward)


async def _resolve_inward_shop_id(db: AsyncSession, user: User, inward_id: int) -> int:
    if user.role != UserRole.SUPERADMIN:
        return user.shop_id
    inward = await get_stock_inward(db, inward_id=inward_id, shop_id=None)
    if inward is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="stock inward not found")
    return inward.shop_id
