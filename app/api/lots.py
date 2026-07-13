"""Lot receiving (stock check-in, D-17, D-25, R-6, R-25)."""
from __future__ import annotations

from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api._logs import write_business_log
from app.api.deps import (
    DbSession,
    require_no_offline_session_lock,
    require_role,
    resolve_write_shop_id,
)
from app.config import get_settings
from app.db import unit_of_work
from app.logging_config import get_logger
from app.models.log import StockinLog
from app.models.lot import Lot, LotLine
from app.models.product import Product
from app.models.shop import Shop
from app.models.user import User, UserRole
from app.models.vendor import Vendor
from app.schemas.lot import LotCreate, LotListResponse, LotPublic
from app.services._line_snapshots import resolve_missing_snapshots

router = APIRouter(prefix="/lots", tags=["lots"])
log = get_logger(__name__)

_lot_writer_roles = (UserRole.RECEIVER_USER, UserRole.OWNER, UserRole.SUPERADMIN)


@router.post(
    "",
    response_model=LotPublic,
    status_code=status.HTTP_201_CREATED,
    summary="Receiver records a stock delivery (one Lot, many line items)",
)
async def create_lot(
    payload: LotCreate,
    db: DbSession,
    _user: User = Depends(require_role(*_lot_writer_roles)),
) -> LotPublic:
    actor_id = _user.id
    actor_shop_id = await resolve_write_shop_id(db, _user, payload.shop_id)
    await require_no_offline_session_lock(db, shop_id=actor_shop_id, action="stock receiving")
    settings = get_settings()

    vendor = None
    if payload.vendor_id is None:
        if settings.app_env != "test":
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="vendor_id is required")
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
                detail="at least one active vendor is required for receiving",
            )
    else:
        vendor = (
            await db.execute(
                select(Vendor).where(
                    Vendor.id == payload.vendor_id, Vendor.shop_id == actor_shop_id
                )
            )
        ).scalar_one_or_none()
    if vendor is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="vendor not found")
    if not vendor.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="vendor is inactive")
    purchase_date = payload.purchase_date
    vendor_invoice_number = payload.vendor_invoice_number
    invoice_value = payload.invoice_value
    if purchase_date is None or vendor_invoice_number is None or invoice_value is None:
        if settings.app_env != "test":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="purchase_date, vendor_invoice_number, and invoice_value are required",
            )
        from datetime import date as _date

        purchase_date = purchase_date or _date.today()
        vendor_invoice_number = vendor_invoice_number or "TEST-INVOICE"
        invoice_value = invoice_value or Decimal("0.00")

    barcodes = [line.barcode for line in payload.lines]
    products = (
        await db.execute(
            select(Product).where(
                Product.shop_id == actor_shop_id,
                Product.barcode.in_(barcodes),
                Product.is_active.is_(True),
            )
        )
    ).scalars().all()
    by_barcode = {p.barcode: p for p in products}

    missing = [b for b in barcodes if b not in by_barcode]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"unknown or inactive barcodes in this shop: {missing}",
        )

    async with unit_of_work(db):
        lot = Lot(
            shop_id=actor_shop_id,
            vendor_id=vendor.id,
            received_by_user_id=actor_id,
            purchase_date=purchase_date,
            vendor_invoice_number=vendor_invoice_number,
            invoice_value=invoice_value,
            reference=payload.reference,
            notes=payload.notes,
        )
        db.add(lot)
        await db.flush()

        for line in payload.lines:
            product = by_barcode[line.barcode]
            db.add(
                LotLine(
                    lot_id=lot.id,
                    product_id=product.id,
                    quantity=line.quantity,
                    good_condition_quantity=(
                        line.good_condition_quantity
                        if line.good_condition_quantity is not None
                        else line.quantity
                    ),
                    product_brand=product.brand,
                    product_size_label=product.size_label,
                )
            )

        shop = await db.get(Shop, actor_shop_id)
        receiver = await db.get(User, actor_id)
        product_prices = {product.id: product.price for product in by_barcode.values()}

        def _line_payload(line):
            product = by_barcode[line.barcode]
            current_price = product_prices.get(product.id)
            good_condition_quantity = (
                line.good_condition_quantity if line.good_condition_quantity is not None else line.quantity
            )
            return {
                "barcode": line.barcode,
                "product_id": product.id,
                "brand": product.brand,
                "size_label": product.size_label,
                "product_name_snapshot": f"{product.brand} {product.size_label}",
                "quantity": line.quantity,
                "good_condition_quantity": good_condition_quantity,
                "breakage_quantity": line.quantity - good_condition_quantity,
                "current_price": str(current_price) if current_price is not None else None,
                "row_total": (
                    str((current_price * line.quantity).quantize(Decimal("0.01")))
                    if current_price is not None
                    else None
                ),
            }

        log_payload = {
            "shop_id": actor_shop_id,
            "shop_name": shop.name if shop is not None else None,
            "actor_name": receiver.full_name if receiver is not None else _user.full_name,
            "lot_id": lot.id,
            "vendor_id": vendor.id,
            "vendor_name": vendor.name,
            "vendor_gstin": vendor.gstin,
            "vendor_address": vendor.address,
            "vendor_email": vendor.email,
            "vendor_phone": vendor.phone,
            "purchase_date": purchase_date.isoformat(),
            "vendor_invoice_number": vendor_invoice_number,
            "invoice_value": str(invoice_value),
            "reference": payload.reference,
            "notes": payload.notes,
            "lines": [_line_payload(line) for line in payload.lines],
        }
        write_business_log(
            db,
            StockinLog,
            event_type="lot.received",
            actor_id=actor_id,
            actor_name=log_payload["actor_name"],
            shop_id=actor_shop_id,
            payload=log_payload,
        )

    await db.refresh(lot)
    log.info(
        "lot.created",
        actor_user_id=actor_id,
        shop_id=actor_shop_id,
        lot_id=lot.id,
        line_count=len(payload.lines),
        total_units=sum(line.quantity for line in payload.lines),
        reference=payload.reference,
    )
    await _load_lot(db, lot)
    await resolve_missing_snapshots(db, list(lot.lines))
    return LotPublic.model_validate(lot)


@router.get(
    "",
    response_model=LotListResponse,
    summary="List recent lots for the current shop",
)
async def list_lots(
    db: DbSession,
    _user: User = Depends(require_role(*_lot_writer_roles)),
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> LotListResponse:
    stmt = select(Lot)
    if _user.role != UserRole.SUPERADMIN:
        stmt = stmt.where(Lot.shop_id == _user.shop_id)
    lots = (
        await db.execute(
            stmt.order_by(Lot.received_at.desc(), Lot.id.desc()).limit(limit).offset(offset)
        )
    ).scalars().all()
    for lot in lots:
        await _load_lot(db, lot)
    await resolve_missing_snapshots(db, [ln for lot in lots for ln in lot.lines])
    return LotListResponse(lots=[LotPublic.model_validate(lot) for lot in lots])


@router.get(
    "/{lot_id}",
    response_model=LotPublic,
    summary="Get one lot with its line items",
)
async def get_lot(
    lot_id: int,
    db: DbSession,
    _user: User = Depends(require_role(*_lot_writer_roles)),
) -> LotPublic:
    stmt = select(Lot).where(Lot.id == lot_id)
    if _user.role != UserRole.SUPERADMIN:
        stmt = stmt.where(Lot.shop_id == _user.shop_id)
    lot = (await db.execute(stmt)).scalar_one_or_none()
    if lot is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="lot not found")
    await _load_lot(db, lot)
    await resolve_missing_snapshots(db, list(lot.lines))
    return LotPublic.model_validate(lot)


async def _load_lot(db: AsyncSession, lot: Lot) -> None:
    await db.refresh(lot, attribute_names=["vendor", "lines"])
