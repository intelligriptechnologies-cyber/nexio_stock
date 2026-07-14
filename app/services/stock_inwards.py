"""Stock inward workflow service."""
from __future__ import annotations

from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.lot import Lot, LotLine
from app.models.log import StockinLog
from app.models.product import Product
from app.models.shop import Shop
from app.models.stock_inward import StockInward, StockInwardLine, StockInwardStatus
from app.models.user import User
from app.models.vendor import Vendor
from app.api._logs import write_business_log

_AUTO_VENDOR_NAME = "Vendor link disabled"


class StockInwardError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


async def create_stock_inward(
    db: AsyncSession,
    *,
    actor_id: int,
    actor_shop_id: int,
    vendor_id: int | None,
    purchase_date,
    vendor_invoice_number: str,
    invoice_value: Decimal,
    reference: str | None,
    notes: str | None,
    lines: list[dict],
) -> StockInward:
    barcodes = [line["barcode"] for line in lines]
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
        raise StockInwardError(
            "unknown_barcode", f"unknown or inactive barcodes in this shop: {missing}"
        )

    vendor = None
    if vendor_id is not None:
        vendor = (
            await db.execute(
                select(Vendor).where(Vendor.id == vendor_id, Vendor.shop_id == actor_shop_id)
            )
        ).scalar_one_or_none()
        if vendor is None:
            raise StockInwardError("vendor_not_found", "vendor not found")
        if not vendor.is_active:
            raise StockInwardError("vendor_inactive", "vendor is inactive")

    inward = StockInward(
        shop_id=actor_shop_id,
        vendor_id=vendor.id if vendor is not None else None,
        created_by_user_id=actor_id,
        purchase_date=purchase_date,
        vendor_invoice_number=vendor_invoice_number,
        invoice_value=invoice_value,
        reference=reference,
        notes=notes,
        status=StockInwardStatus.PENDING,
    )
    db.add(inward)
    await db.flush()

    for line in lines:
        product = by_barcode[line["barcode"]]
        db.add(
            StockInwardLine(
                stock_inward_id=inward.id,
                product_id=product.id,
                quantity=line["quantity"],
                good_condition_quantity=line["good_condition_quantity"],
                product_brand=product.brand,
                product_size_label=product.size_label,
            )
        )

    return inward


async def approve_stock_inward(
    db: AsyncSession,
    *,
    inward_id: int,
    shop_id: int,
    actor_user_id: int,
) -> StockInward:
    inward = await _load_stock_inward(db, inward_id, shop_id=shop_id)
    if inward.status != StockInwardStatus.PENDING:
        raise StockInwardError("not_pending", "stock inward is not pending")

    await db.refresh(inward, attribute_names=["lines", "vendor", "created_by", "approved_by", "rejected_by"])

    lot = Lot(
        shop_id=shop_id,
        stock_inward_id=inward.id,
        vendor_id=inward.vendor_id,
        received_by_user_id=actor_user_id,
        purchase_date=inward.purchase_date,
        vendor_invoice_number=inward.vendor_invoice_number,
        invoice_value=inward.invoice_value,
        reference=inward.reference,
        notes=inward.notes,
    )
    db.add(lot)
    await db.flush()

    product_ids = [line.product_id for line in inward.lines]
    products = (await db.execute(select(Product).where(Product.id.in_(product_ids)))).scalars().all()
    products_by_id = {product.id: product for product in products}

    for line in inward.lines:
        db.add(
            LotLine(
                lot_id=lot.id,
                product_id=line.product_id,
                quantity=line.quantity,
                good_condition_quantity=line.good_condition_quantity,
                product_brand=line.product_brand,
                product_size_label=line.product_size_label,
            )
        )

    now = datetime.now(UTC)
    inward.status = StockInwardStatus.COMPLETED
    inward.approved_by_user_id = actor_user_id
    inward.approved_at = now
    inward.completed_at = now
    inward.lot_id = lot.id

    shop = await db.get(Shop, shop_id)
    actor = await db.get(User, actor_user_id)
    write_business_log(
        db,
        StockinLog,
        event_type="lot.received",
        actor_id=actor_user_id,
        actor_name=actor.full_name if actor is not None else None,
        shop_id=shop_id,
        payload={
            "shop_id": shop_id,
            "shop_name": shop.name if shop is not None else None,
            "actor_name": actor.full_name if actor is not None else None,
            "lot_id": lot.id,
            "vendor_id": inward.vendor.id if inward.vendor is not None else None,
            "vendor_name": inward.vendor.name if inward.vendor is not None else _AUTO_VENDOR_NAME,
            "vendor_gstin": inward.vendor.gstin if inward.vendor is not None else None,
            "vendor_address": inward.vendor.address if inward.vendor is not None else None,
            "vendor_email": inward.vendor.email if inward.vendor is not None else None,
            "vendor_phone": inward.vendor.phone if inward.vendor is not None else None,
            "purchase_date": inward.purchase_date.isoformat(),
            "vendor_invoice_number": inward.vendor_invoice_number,
            "invoice_value": str(inward.invoice_value),
            "reference": inward.reference,
            "notes": inward.notes,
            "lines": [
                {
                    "barcode": products_by_id[line.product_id].barcode,
                    "product_id": line.product_id,
                    "brand": products_by_id[line.product_id].brand,
                    "size_label": products_by_id[line.product_id].size_label,
                    "product_name_snapshot": f"{products_by_id[line.product_id].brand} {products_by_id[line.product_id].size_label}",
                    "quantity": line.quantity,
                    "good_condition_quantity": line.good_condition_quantity,
                    "breakage_quantity": line.breakage_quantity,
                    "current_price": str(products_by_id[line.product_id].price)
                    if products_by_id[line.product_id].price is not None
                    else None,
                    "row_total": (
                        str((products_by_id[line.product_id].price * line.quantity).quantize(Decimal("0.01")))
                        if products_by_id[line.product_id].price is not None
                        else None
                    ),
                }
                for line in inward.lines
            ],
        },
    )
    return inward


async def reject_stock_inward(
    db: AsyncSession,
    *,
    inward_id: int,
    shop_id: int,
    actor_user_id: int,
) -> StockInward:
    inward = await _load_stock_inward(db, inward_id, shop_id=shop_id)
    if inward.status != StockInwardStatus.PENDING:
        raise StockInwardError("not_pending", "stock inward is not pending")

    now = datetime.now(UTC)
    inward.status = StockInwardStatus.REJECTED
    inward.rejected_by_user_id = actor_user_id
    inward.rejected_at = now

    shop = await db.get(Shop, shop_id)
    actor = await db.get(User, actor_user_id)
    write_business_log(
        db,
        StockinLog,
        event_type="stock_inward.rejected",
        actor_id=actor_user_id,
        actor_name=actor.full_name if actor is not None else None,
        shop_id=shop_id,
        payload={
            "shop_id": shop_id,
            "shop_name": shop.name if shop is not None else None,
            "actor_name": actor.full_name if actor is not None else None,
            "stock_inward_id": inward.id,
        },
    )
    return inward


async def list_stock_inwards(
    db: AsyncSession,
    *,
    shop_id: int | None,
    status: StockInwardStatus | None = None,
) -> list[StockInward]:
    stmt = select(StockInward).options(
        selectinload(StockInward.lines),
        selectinload(StockInward.vendor),
        selectinload(StockInward.created_by),
        selectinload(StockInward.approved_by),
        selectinload(StockInward.rejected_by),
    )
    if shop_id is not None:
        stmt = stmt.where(StockInward.shop_id == shop_id)
    if status is not None:
        stmt = stmt.where(StockInward.status == status)
    stmt = stmt.order_by(StockInward.created_at.desc(), StockInward.id.desc())
    return (await db.execute(stmt)).scalars().all()


async def get_stock_inward(
    db: AsyncSession,
    *,
    inward_id: int,
    shop_id: int | None,
) -> StockInward | None:
    stmt = select(StockInward).where(StockInward.id == inward_id).options(
        selectinload(StockInward.lines),
        selectinload(StockInward.vendor),
        selectinload(StockInward.created_by),
        selectinload(StockInward.approved_by),
        selectinload(StockInward.rejected_by),
    )
    if shop_id is not None:
        stmt = stmt.where(StockInward.shop_id == shop_id)
    return (await db.execute(stmt)).scalar_one_or_none()


async def _load_stock_inward(
    db: AsyncSession,
    inward_id: int,
    *,
    shop_id: int,
) -> StockInward:
    inward = await get_stock_inward(db, inward_id=inward_id, shop_id=shop_id)
    if inward is None:
        raise StockInwardError("not_found", "stock inward not found")
    return inward
