"""Stock inward workflow service."""

from __future__ import annotations

from datetime import UTC, date, datetime
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.api._logs import write_business_log
from app.models.log import StockinLog
from app.models.lot import Lot, LotLine
from app.models.product import Product
from app.models.purchase_order import PurchaseOrder, PurchaseOrderLine, PurchaseOrderStatus
from app.models.shop import Shop
from app.models.stock_inward import (
    StockInward,
    StockInwardLine,
    StockInwardStatus,
    StockMovementType,
)
from app.models.user import User
from app.models.vendor import Vendor
from app.services.stock import compute_derived_stock

_MONEY_QUANTUM = Decimal("0.01")


class StockInwardError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


async def create_inventory_adjustment(
    db: AsyncSession,
    *,
    actor_id: int,
    shop_id: int,
    product_id: int,
    quantity_delta: int,
    reason: str,
) -> StockInward:
    """Create one pending signed movement while serializing by product."""
    product = (
        await db.execute(
            select(Product)
            .where(Product.id == product_id, Product.shop_id == shop_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if product is None or not product.is_active:
        raise StockInwardError("not_found", "product not found in the selected shop")

    pending = (
        await db.execute(
            select(StockInwardLine.id)
            .join(StockInward, StockInward.id == StockInwardLine.stock_inward_id)
            .where(
                StockInwardLine.product_id == product_id,
                StockInward.status == StockInwardStatus.PENDING,
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    if pending is not None:
        raise StockInwardError(
            "pending_inventory_request",
            "this product already has a pending stock inward request",
        )

    inward = StockInward(
        shop_id=shop_id,
        vendor_id=None,
        created_by_user_id=actor_id,
        purchase_date=date.today(),
        vendor_invoice_number="INVENTORY-ADJUSTMENT",
        invoice_value=Decimal("0.00"),
        notes=reason,
        status=StockInwardStatus.PENDING,
        movement_type=StockMovementType.ADJUSTMENT,
    )
    db.add(inward)
    await db.flush()
    db.add(
        StockInwardLine(
            stock_inward_id=inward.id,
            product_id=product.id,
            quantity=quantity_delta,
            good_condition_quantity=quantity_delta,
            unit_cost=None,
            product_brand=product.brand,
            product_size_label=product.size_label,
        )
    )
    await db.flush()
    return inward


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
    purchase_details_captured: bool,
    purchase_order_id: int | None = None,
    over_receipt_reason: str | None = None,
    purchase_order_line_ids: list[int | None] | None = None,
) -> StockInward:
    invoice_value = invoice_value.quantize(_MONEY_QUANTUM)
    barcodes = [line["barcode"] for line in lines]
    products = (
        (
            await db.execute(
                select(Product).where(
                    Product.shop_id == actor_shop_id,
                    Product.barcode.in_(barcodes),
                    Product.is_active.is_(True),
                )
            )
        )
        .scalars()
        .all()
    )
    by_barcode = {p.barcode: p for p in products}
    missing = [b for b in barcodes if b not in by_barcode]
    if missing:
        raise StockInwardError(
            "unknown_barcode", f"unknown or inactive barcodes in this shop: {missing}"
        )

    po_lines_by_id: dict[int, PurchaseOrderLine] = {}
    if purchase_order_id is not None:
        purchase_order = (
            await db.execute(
                select(PurchaseOrder).where(
                    PurchaseOrder.id == purchase_order_id, PurchaseOrder.shop_id == actor_shop_id
                )
            )
        ).scalar_one_or_none()
        if purchase_order is None:
            raise StockInwardError("purchase_order_not_found", "purchase order not found")
        if purchase_order.status not in (
            PurchaseOrderStatus.OPEN,
            PurchaseOrderStatus.PARTIALLY_RECEIVED,
            PurchaseOrderStatus.FULFILLED,
        ):
            raise StockInwardError(
                "purchase_order_unavailable", "purchase order is not available for receiving"
            )
        requested_ids = [value for value in (purchase_order_line_ids or []) if value is not None]
        po_lines = (
            (
                await db.execute(
                    select(PurchaseOrderLine).where(
                        PurchaseOrderLine.purchase_order_id == purchase_order_id,
                        PurchaseOrderLine.id.in_(requested_ids),
                    )
                )
            )
            .scalars()
            .all()
        )
        po_lines_by_id = {line.id: line for line in po_lines}
        if len(requested_ids) != len(lines) or len(po_lines_by_id) != len(requested_ids):
            raise StockInwardError(
                "purchase_order_line_invalid",
                "Every received line must reference a line on the selected purchase order",
            )
        for payload_line, po_line_id in zip(lines, purchase_order_line_ids or [], strict=True):
            po_line = po_lines_by_id.get(po_line_id)
            if po_line is None or po_line.product_id != by_barcode[payload_line["barcode"]].id:
                raise StockInwardError(
                    "purchase_order_line_invalid",
                    "Purchase-order line does not match the received product",
                )
    elif any(value is not None for value in (purchase_order_line_ids or [])):
        raise StockInwardError(
            "purchase_order_line_invalid",
            "purchase_order_id is required when a line references a purchase order",
        )

    vendor = None
    if purchase_details_captured and vendor_id is None:
        raise StockInwardError("vendor_required", "vendor_id is required")
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

    if (
        any(line["good_condition_quantity"] < line["quantity"] for line in lines)
        and not (notes or "").strip()
    ):
        raise StockInwardError("breakage_notes_required", "notes are required when breakage exists")

    if purchase_details_captured:
        merchandise_total = Decimal("0.00")
        for line in lines:
            unit_cost = line.get("unit_cost")
            if unit_cost is None or unit_cost <= 0:
                raise StockInwardError(
                    "unit_cost_required", "each line requires a positive unit_cost"
                )
            line_total = (unit_cost * line["quantity"]).quantize(_MONEY_QUANTUM)
            merchandise_total += line_total
        merchandise_total = merchandise_total.quantize(_MONEY_QUANTUM)
        if merchandise_total != invoice_value:
            raise StockInwardError(
                "invoice_value_mismatch",
                f"invoice_value must match merchandise total exactly ({merchandise_total})",
            )

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
        purchase_order_id=purchase_order_id,
        over_receipt_reason=(over_receipt_reason or "").strip() or None,
    )
    db.add(inward)
    await db.flush()

    for index, line in enumerate(lines):
        product = by_barcode[line["barcode"]]
        db.add(
            StockInwardLine(
                stock_inward_id=inward.id,
                product_id=product.id,
                quantity=line["quantity"],
                good_condition_quantity=line["good_condition_quantity"],
                unit_cost=line.get("unit_cost") if purchase_details_captured else None,
                product_brand=product.brand,
                product_size_label=product.size_label,
                purchase_order_line_id=(purchase_order_line_ids or [None] * len(lines))[index],
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
    inward = await _load_stock_inward(db, inward_id, shop_id=shop_id, for_update=True)
    if inward.status != StockInwardStatus.PENDING:
        raise StockInwardError("not_pending", "stock inward is not pending")

    await db.refresh(
        inward, attribute_names=["lines", "vendor", "created_by", "approved_by", "rejected_by"]
    )

    product_ids = sorted({line.product_id for line in inward.lines})
    products = (
        (
            await db.execute(
                select(Product)
                .where(Product.id.in_(product_ids))
                .order_by(Product.id)
                .with_for_update()
            )
        )
        .scalars()
        .all()
    )
    products_by_id = {product.id: product for product in products}
    previous_stock = await compute_derived_stock(db, product_ids=product_ids)
    resulting_stock = {
        line.product_id: previous_stock.get(line.product_id, 0) + line.quantity
        for line in inward.lines
    }
    if inward.movement_type == StockMovementType.ADJUSTMENT:
        below_zero = [pid for pid, quantity in resulting_stock.items() if quantity < 0]
        if below_zero:
            raise StockInwardError(
                "insufficient_stock_for_adjustment",
                "inventory adjustment would make available stock negative",
            )

    if inward.purchase_order_id is not None:
        po_line_ids = [
            line.purchase_order_line_id for line in inward.lines if line.purchase_order_line_id
        ]
        # Serialize approvals against the PO lines so two approvals cannot both
        # observe the same remaining quantity.
        locked_lines = (
            (
                await db.execute(
                    select(PurchaseOrderLine)
                    .where(PurchaseOrderLine.id.in_(po_line_ids))
                    .order_by(PurchaseOrderLine.id)
                    .with_for_update()
                )
            )
            .scalars()
            .all()
        )
        ordered = {line.id: line.ordered_bottles or 0 for line in locked_lines}
        already_rows = await db.execute(
            select(
                StockInwardLine.purchase_order_line_id,
                func.coalesce(func.sum(StockInwardLine.quantity), 0),
            )
            .join(StockInward, StockInward.id == StockInwardLine.stock_inward_id)
            .where(
                StockInwardLine.purchase_order_line_id.in_(po_line_ids),
                StockInward.status.in_([StockInwardStatus.APPROVED, StockInwardStatus.COMPLETED]),
            )
            .group_by(StockInwardLine.purchase_order_line_id)
        )
        already = {line_id: int(quantity) for line_id, quantity in already_rows}
        over = [
            line.purchase_order_line_id
            for line in inward.lines
            if line.purchase_order_line_id is not None
            and already.get(line.purchase_order_line_id, 0) + line.quantity
            > ordered.get(line.purchase_order_line_id, 0)
        ]
        if over and not (inward.over_receipt_reason or "").strip():
            raise StockInwardError(
                "over_receipt_reason_required",
                f"Over-receipt on purchase-order lines {over} requires an audit reason",
            )

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

    if inward.purchase_order_id is not None:
        from app.services.purchase_orders import refresh_order_status

        # Flush makes this approval visible to the aggregate query in the same transaction.
        await db.flush()
        await refresh_order_status(db, inward.purchase_order_id)

    shop = await db.get(Shop, shop_id)
    actor = await db.get(User, actor_user_id)
    write_business_log(
        db,
        StockinLog,
        event_type=(
            "stock_inward.adjustment_approved"
            if inward.movement_type == StockMovementType.ADJUSTMENT
            else "lot.received"
        ),
        actor_id=actor_user_id,
        actor_name=actor.full_name if actor is not None else None,
        shop_id=shop_id,
        shop_log_scope_key=shop.log_scope_key if shop is not None else None,
        shop_created_at=shop.created_at if shop is not None else None,
        payload={
            "shop_id": shop_id,
            "shop_name": shop.name if shop is not None else None,
            "actor_name": actor.full_name if actor is not None else None,
            "lot_id": lot.id,
            "movement_type": inward.movement_type.value,
            "reason": inward.notes
            if inward.movement_type == StockMovementType.ADJUSTMENT
            else None,
            "vendor_id": inward.vendor.id if inward.vendor is not None else None,
            "purchase_details_captured": inward.purchase_details_captured,
            "vendor_name": inward.vendor.name
            if inward.purchase_details_captured and inward.vendor is not None
            else None,
            "vendor_gstin": inward.vendor.gstin if inward.vendor is not None else None,
            "vendor_address": inward.vendor.address if inward.vendor is not None else None,
            "vendor_email": inward.vendor.email if inward.vendor is not None else None,
            "vendor_phone": inward.vendor.phone if inward.vendor is not None else None,
            "purchase_date": inward.purchase_date.isoformat()
            if inward.purchase_details_captured
            else None,
            "vendor_invoice_number": inward.vendor_invoice_number
            if inward.purchase_details_captured
            else None,
            "invoice_value": str(inward.invoice_value)
            if inward.purchase_details_captured
            else None,
            "merchandise_total": str(inward.merchandise_total)
            if inward.merchandise_total is not None
            else None,
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
                    "unit_cost": str(line.unit_cost) if line.unit_cost is not None else None,
                    "row_total": str(line.line_total) if line.line_total is not None else None,
                    "previous_stock": previous_stock.get(line.product_id, 0),
                    "resulting_stock": resulting_stock[line.product_id],
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
        shop_log_scope_key=shop.log_scope_key if shop is not None else None,
        shop_created_at=shop.created_at if shop is not None else None,
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
    limit: int | None = None,
    offset: int = 0,
) -> list[StockInward]:
    stmt = select(StockInward).options(
        selectinload(StockInward.lines).selectinload(StockInwardLine.purchase_order_line),
        selectinload(StockInward.purchase_order),
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
    if limit is not None:
        stmt = stmt.limit(limit).offset(offset)
    return (await db.execute(stmt)).scalars().all()


async def count_stock_inwards(
    db: AsyncSession, *, shop_id: int | None, status: StockInwardStatus | None = None
) -> int:
    stmt = select(func.count(StockInward.id))
    if shop_id is not None:
        stmt = stmt.where(StockInward.shop_id == shop_id)
    if status is not None:
        stmt = stmt.where(StockInward.status == status)
    return int((await db.execute(stmt)).scalar_one())


async def get_stock_inward(
    db: AsyncSession,
    *,
    inward_id: int,
    shop_id: int | None,
    for_update: bool = False,
) -> StockInward | None:
    stmt = (
        select(StockInward)
        .where(StockInward.id == inward_id)
        .options(
            selectinload(StockInward.lines).selectinload(StockInwardLine.purchase_order_line),
            selectinload(StockInward.purchase_order),
            selectinload(StockInward.vendor),
            selectinload(StockInward.created_by),
            selectinload(StockInward.approved_by),
            selectinload(StockInward.rejected_by),
        )
    )
    if shop_id is not None:
        stmt = stmt.where(StockInward.shop_id == shop_id)
    if for_update:
        stmt = stmt.with_for_update()
    return (await db.execute(stmt)).scalar_one_or_none()


async def _load_stock_inward(
    db: AsyncSession,
    inward_id: int,
    *,
    shop_id: int,
    for_update: bool = False,
) -> StockInward:
    inward = await get_stock_inward(db, inward_id=inward_id, shop_id=shop_id, for_update=for_update)
    if inward is None:
        raise StockInwardError("not_found", "stock inward not found")
    return inward
