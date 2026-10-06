"""Purchase-order lifecycle, matching, and reconciliation."""
from __future__ import annotations

import re
from datetime import UTC, date, datetime
from decimal import Decimal
from difflib import SequenceMatcher
from pathlib import Path

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.product import Product, ProductStatus
from app.models.purchase_order import (
    ExtractionStatus,
    PurchaseOrder,
    PurchaseOrderLine,
    PurchaseOrderStatus,
    ShopCasePackRule,
)
from app.models.shop import Shop
from app.models.stock_inward import StockInward, StockInwardLine, StockInwardStatus
from app.services.osbcl_parser import ParsedOrder
from app.services.stock_inwards import approve_stock_inward, create_stock_inward

DEFAULT_CASE_PACKS = {90: 96, 180: 48, 375: 24, 500: 12, 650: 6, 750: 8}


class PurchaseOrderError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


async def approve_receipt(
    db: AsyncSession,
    *,
    order: PurchaseOrder,
    actor_user_id: int,
    payload: dict,
) -> tuple[PurchaseOrder, StockInward]:
    """Commit the sole receipt for a confirmed PO in the caller's transaction.

    PO receipts intentionally bypass the generic pending-inward queue: the owner
    reviews and approves this immutable delivery in one operation.
    """
    if order.status != PurchaseOrderStatus.OPEN:
        raise PurchaseOrderError("receipt_unavailable", "only a confirmed, open purchase order can be received")

    already_completed = (
        await db.execute(
            select(StockInward.id)
            .where(
                StockInward.purchase_order_id == order.id,
                StockInward.status == StockInwardStatus.COMPLETED,
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    if already_completed is not None:
        raise PurchaseOrderError("receipt_already_approved", "this purchase order already has an approved receipt")

    submitted = {line["purchase_order_line_id"]: line for line in payload["lines"]}
    expected = {line.id: line for line in order.lines}
    if set(submitted) != set(expected):
        raise PurchaseOrderError("receipt_lines_invalid", "the receipt must include every and only this purchase order's lines")

    receipt_lines: list[dict] = []
    receipt_product_ids: set[int] = set()
    over_lines: list[int] = []
    for line_id, po_line in expected.items():
        submitted_line = submitted[line_id]
        if po_line.product_id is None or submitted_line["product_id"] != po_line.product_id:
            raise PurchaseOrderError("receipt_product_invalid", f"receipt product does not match purchase-order line {line_id}")
        if submitted_line["quantity"] > 0 and po_line.product_id in receipt_product_ids:
            raise PurchaseOrderError("receipt_product_invalid", "a receipt cannot contain the same product on multiple PO lines")
        receipt_product_ids.add(po_line.product_id)
        if submitted_line["quantity"] > (po_line.ordered_bottles or 0):
            over_lines.append(line_id)
        if submitted_line["quantity"] > 0:
            product = po_line.product
            if product is None:
                raise PurchaseOrderError("receipt_product_invalid", f"purchase-order line {line_id} has no product")
            receipt_lines.append(
                {
                    "barcode": product.barcode,
                    "quantity": submitted_line["quantity"],
                    "good_condition_quantity": submitted_line["good_condition_quantity"],
                    "unit_cost": submitted_line.get("unit_cost"),
                    "purchase_order_line_id": line_id,
                }
            )

    if over_lines and not (payload.get("over_receipt_reason") or "").strip():
        raise PurchaseOrderError("over_receipt_reason_required", f"Over-receipt on purchase-order lines {over_lines} requires an audit reason")
    if any(line["good_condition_quantity"] < line["quantity"] for line in submitted.values()) and not (payload.get("notes") or "").strip():
        raise PurchaseOrderError("breakage_notes_required", "notes are required when breakage exists")

    shop = await db.get(Shop, order.shop_id)
    purchase_details_captured = True if shop is None else shop.receiving_vendor_link_enabled
    if purchase_details_captured:
        required = ("vendor_id", "purchase_date", "vendor_invoice_number", "invoice_value")
        if any(payload.get(field) is None for field in required):
            raise PurchaseOrderError("purchase_details_required", "vendor, purchase date, invoice number, and invoice value are required")
        if payload["invoice_value"] < 0:
            raise PurchaseOrderError("purchase_details_required", "invoice_value cannot be negative")
        for line in receipt_lines:
            if line["unit_cost"] is None or line["unit_cost"] <= 0:
                raise PurchaseOrderError("unit_cost_required", "each received line requires a positive unit_cost")
        merchandise_total = sum((line["unit_cost"] * line["quantity"] for line in receipt_lines), Decimal("0.00"))
        if merchandise_total.quantize(Decimal("0.01")) != payload["invoice_value"].quantize(Decimal("0.01")):
            raise PurchaseOrderError("invoice_value_mismatch", f"invoice_value must match merchandise total exactly ({merchandise_total:.2f})")
    else:
        from datetime import date as date_cls
        payload = {**payload, "vendor_id": None, "purchase_date": date_cls.today(), "vendor_invoice_number": "AUTO-RECEIPT", "invoice_value": Decimal("0.00")}

    inward = await create_stock_inward(
        db,
        actor_id=actor_user_id,
        actor_shop_id=order.shop_id,
        vendor_id=payload.get("vendor_id"),
        purchase_date=payload["purchase_date"],
        vendor_invoice_number=payload["vendor_invoice_number"],
        invoice_value=payload["invoice_value"],
        reference=payload.get("reference"),
        notes=payload.get("notes"),
        lines=receipt_lines,
        purchase_details_captured=purchase_details_captured,
        purchase_order_id=order.id,
        over_receipt_reason=payload.get("over_receipt_reason"),
        purchase_order_line_ids=[line["purchase_order_line_id"] for line in receipt_lines],
    )
    inward = await approve_stock_inward(db, inward_id=inward.id, shop_id=order.shop_id, actor_user_id=actor_user_id)
    order.status = (
        PurchaseOrderStatus.FULFILLED
        if all(submitted[line.id]["quantity"] >= (line.ordered_bottles or 0) for line in order.lines)
        else PurchaseOrderStatus.CLOSED_SHORT
    )
    await db.flush()
    return order, inward


async def ensure_case_pack_rules(db: AsyncSession, shop_id: int) -> list[ShopCasePackRule]:
    rows = (await db.execute(select(ShopCasePackRule).where(ShopCasePackRule.shop_id == shop_id).order_by(ShopCasePackRule.size_ml))).scalars().all()
    existing = {row.size_ml for row in rows}
    for size, count in DEFAULT_CASE_PACKS.items():
        if size not in existing:
            db.add(ShopCasePackRule(shop_id=shop_id, size_ml=size, bottles_per_case=count))
    if len(existing) != len(DEFAULT_CASE_PACKS) or not rows:
        await db.flush()
        rows = (await db.execute(select(ShopCasePackRule).where(ShopCasePackRule.shop_id == shop_id).order_by(ShopCasePackRule.size_ml))).scalars().all()
    return rows


async def replace_case_pack_rules(db: AsyncSession, shop_id: int, rules: list[dict]) -> list[ShopCasePackRule]:
    await db.execute(delete(ShopCasePackRule).where(ShopCasePackRule.shop_id == shop_id))
    db.add_all(ShopCasePackRule(shop_id=shop_id, **rule) for rule in rules)
    await db.flush()
    return (await db.execute(select(ShopCasePackRule).where(ShopCasePackRule.shop_id == shop_id).order_by(ShopCasePackRule.size_ml))).scalars().all()


async def find_duplicate(db: AsyncSession, *, shop_id: int, source_sha256: str, token: str | None = None) -> PurchaseOrder | None:
    conditions = [PurchaseOrder.source_sha256 == source_sha256]
    if token:
        conditions.append(PurchaseOrder.osbcl_token == token)
    from sqlalchemy import or_
    return (await db.execute(select(PurchaseOrder).where(PurchaseOrder.shop_id == shop_id, or_(*conditions)))).scalar_one_or_none()


async def create_imported_order(
    db: AsyncSession,
    *,
    shop_id: int,
    actor_user_id: int,
    filename: str,
    sha256: str,
    relative_path: str,
    page_count: int,
    parsed: ParsedOrder,
) -> PurchaseOrder:
    duplicate = await find_duplicate(db, shop_id=shop_id, source_sha256=sha256, token=parsed.osbcl_token)
    if duplicate:
        raise PurchaseOrderError("duplicate", f"This order was already imported as PO #{duplicate.id}")
    rules = {row.size_ml: row.bottles_per_case for row in await ensure_case_pack_rules(db, shop_id)}
    products = (await db.execute(select(Product).where(Product.shop_id == shop_id, Product.is_active.is_(True), Product.status == ProductStatus.ACTIVE))).scalars().all()
    po = PurchaseOrder(
        shop_id=shop_id,
        osbcl_token=parsed.osbcl_token,
        order_date=date.fromisoformat(parsed.order_date) if parsed.order_date else None,
        order_type=parsed.order_type,
        retailer_name=parsed.retailer_name,
        retailer_code=parsed.retailer_code,
        vehicle_number=parsed.vehicle_number,
        total_cases=parsed.total_cases,
        total_loose_bottles=parsed.total_loose_bottles,
        mger_total=parsed.mger_total,
        order_total=parsed.order_total,
        source_filename=filename[:255],
        source_sha256=sha256,
        source_path=relative_path,
        page_count=page_count,
        extraction_status=(
            ExtractionStatus.FAILED
            if "error" in parsed.raw_ocr
            else ExtractionStatus.REVIEW_REQUIRED
            if parsed.review_flags
            else ExtractionStatus.READY
        ),
        extraction_confidence=parsed.confidence,
        review_flags=parsed.review_flags,
        raw_ocr=parsed.raw_ocr,
        status=PurchaseOrderStatus.DRAFT,
        created_by_user_id=actor_user_id,
    )
    db.add(po)
    await db.flush()
    for parsed_line in parsed.lines:
        candidates = _rank_products(parsed_line.source_item_name, parsed_line.size_ml, products)
        product_id = None
        if candidates and candidates[0]["score"] >= 0.82 and (len(candidates) == 1 or candidates[0]["score"] - candidates[1]["score"] >= 0.12):
            product_id = candidates[0]["product_id"]
        pack = rules.get(parsed_line.size_ml) if parsed_line.size_ml else None
        db.add(PurchaseOrderLine(
            purchase_order_id=po.id,
            source_item_name=parsed_line.source_item_name,
            size_ml=parsed_line.size_ml,
            product_id=product_id,
            cases=parsed_line.cases,
            loose_bottles=parsed_line.loose_bottles,
            pack_size_snapshot=pack,
            ordered_bottles=parsed_line.cases * pack + parsed_line.loose_bottles if pack else None,
            case_rate=parsed_line.case_rate,
            mger=parsed_line.mger,
            amount=parsed_line.amount,
            sequence=parsed_line.sequence,
            ocr_confidence=parsed_line.confidence,
            field_confidence=parsed_line.field_confidence,
            match_candidates=candidates[:5],
        ))
    await db.flush()
    return await get_order(db, po.id, shop_id=shop_id, lock=False)


async def list_orders(db: AsyncSession, *, shop_id: int | None, status: PurchaseOrderStatus | None = None) -> list[PurchaseOrder]:
    stmt = select(PurchaseOrder).options(selectinload(PurchaseOrder.lines).selectinload(PurchaseOrderLine.product)).order_by(PurchaseOrder.created_at.desc(), PurchaseOrder.id.desc())
    if shop_id is not None:
        stmt = stmt.where(PurchaseOrder.shop_id == shop_id)
    if status is not None:
        stmt = stmt.where(PurchaseOrder.status == status)
    rows = (await db.execute(stmt)).scalars().all()
    for row in rows:
        await attach_reconciliation(db, row)
    return rows


async def get_order(db: AsyncSession, order_id: int, *, shop_id: int | None, lock: bool = False) -> PurchaseOrder:
    stmt = select(PurchaseOrder).where(PurchaseOrder.id == order_id).options(selectinload(PurchaseOrder.lines).selectinload(PurchaseOrderLine.product))
    if shop_id is not None:
        stmt = stmt.where(PurchaseOrder.shop_id == shop_id)
    if lock:
        stmt = stmt.with_for_update()
    order = (await db.execute(stmt)).scalar_one_or_none()
    if order is None:
        raise PurchaseOrderError("not_found", "purchase order not found")
    await attach_reconciliation(db, order)
    return order


async def update_draft(db: AsyncSession, order: PurchaseOrder, payload: dict, *, actor_user_id: int) -> PurchaseOrder:
    if order.status != PurchaseOrderStatus.DRAFT:
        raise PurchaseOrderError("immutable", "Only draft purchase orders can be changed")
    lines = payload.pop("lines")
    if payload.get("wastage_attested"):
        payload["wastage_attested_by_user_id"] = actor_user_id
        payload["wastage_attested_at"] = datetime.now(UTC)
    else:
        payload["wastage_attested_by_user_id"] = None
        payload["wastage_attested_at"] = None
    for key, value in payload.items():
        setattr(order, key, value)
    rules = {row.size_ml: row.bottles_per_case for row in await ensure_case_pack_rules(db, order.shop_id)}
    products = {p.id: p for p in (await db.execute(select(Product).where(Product.shop_id == order.shop_id, Product.is_active.is_(True), Product.status == ProductStatus.ACTIVE))).scalars().all()}
    existing = {line.id: line for line in order.lines}
    flags: list[str] = []
    for line in lines:
        product_id = line.get("product_id")
        if product_id is not None and product_id not in products:
            raise PurchaseOrderError("invalid_product", f"Product {product_id} is not active in this shop")
        pack = rules.get(line.get("size_ml"))
        if pack is None:
            flags.append(f"No case-pack rule for {line.get('size_ml') or 'unknown'} ml")
        line_id = line.pop("id", None)
        if line.get("delivered_bottles") is not None and line.get("accepted_bottles") is not None and line["accepted_bottles"] > line["delivered_bottles"]:
            raise PurchaseOrderError("delivery_invalid", "accepted bottles cannot exceed delivered bottles")
        values = {
            **line,
            "pack_size_snapshot": pack,
            "ordered_bottles": line["cases"] * pack + line["loose_bottles"] if pack else None,
        }
        current = existing.pop(line_id, None) if line_id is not None else None
        if current is None:
            order.lines.append(PurchaseOrderLine(**values, match_candidates=[], field_confidence={}))
        else:
            for key, value in values.items():
                setattr(current, key, value)
    for removed in existing.values():
        order.lines.remove(removed)
    order.review_flags = flags
    order.extraction_status = ExtractionStatus.REVIEW_REQUIRED if flags else ExtractionStatus.READY
    await db.flush()
    return await get_order(db, order.id, shop_id=order.shop_id)


async def confirm_order(db: AsyncSession, order: PurchaseOrder, actor_user_id: int) -> PurchaseOrder:
    if order.status != PurchaseOrderStatus.DRAFT:
        raise PurchaseOrderError("not_draft", "purchase order is not a draft")
    if not order.osbcl_token or not order.order_date:
        raise PurchaseOrderError("incomplete", "Token number and order date are required")
    if not order.lines:
        raise PurchaseOrderError("incomplete", "At least one purchase-order line is required")
    incomplete = [line.sequence for line in order.lines if line.product_id is None or line.pack_size_snapshot is None or line.ordered_bottles is None]
    if incomplete:
        raise PurchaseOrderError("incomplete", f"Lines {incomplete} need an active product and case-pack rule")
    if order.order_total is not None:
        amount_total = sum((line.amount or Decimal(0)) for line in order.lines)
        if abs(amount_total - order.order_total) > Decimal("0.05"):
            raise PurchaseOrderError("incomplete", f"Line amounts total {amount_total:.2f}, expected {order.order_total:.2f}")
    if order.mger_total is not None:
        mger_total = sum((line.mger or Decimal(0)) for line in order.lines)
        if abs(mger_total - order.mger_total) > Decimal("0.05"):
            raise PurchaseOrderError("incomplete", f"Line MGER totals {mger_total:.2f}, expected {order.mger_total:.2f}")
    order.status = PurchaseOrderStatus.OPEN
    order.confirmed_by_user_id = actor_user_id
    order.confirmed_at = datetime.now(UTC)
    return order


async def delete_draft(db: AsyncSession, order: PurchaseOrder) -> str:
    """Delete an unreferenced draft and return its stored-PDF relative path."""
    if order.status != PurchaseOrderStatus.DRAFT:
        raise PurchaseOrderError("not_draft", "only draft purchase orders can be deleted")

    referenced = (
        await db.execute(
            select(StockInward.id)
            .where(StockInward.purchase_order_id == order.id)
            .limit(1)
        )
    ).scalar_one_or_none()
    if referenced is not None:
        raise PurchaseOrderError(
            "referenced",
            "purchase order cannot be deleted because it is referenced by a stock inward record",
        )

    source_path = order.source_path
    await db.delete(order)
    await db.flush()
    return source_path


async def finalize_draft(db: AsyncSession, *, order: PurchaseOrder, actor_user_id: int) -> tuple[PurchaseOrder, StockInward]:
    """Atomically turn one fully-reviewed draft into its completed inward/lot."""
    if order.status != PurchaseOrderStatus.DRAFT:
        raise PurchaseOrderError("not_draft", "purchase order is not a draft")
    if not order.osbcl_token or not order.order_date or not order.retailer_code:
        raise PurchaseOrderError("incomplete", "token number, order date, and retailer code are required")
    if order.total_cases is None or order.total_loose_bottles is None or order.order_total is None or order.mger_total is None:
        raise PurchaseOrderError("incomplete", "PDF quantity and monetary totals are required")
    if not order.lines:
        raise PurchaseOrderError("incomplete", "at least one purchase-order line is required")
    incomplete = [line.sequence for line in order.lines if line.product_id is None or line.product is None or not line.product.is_active or line.product.status != ProductStatus.ACTIVE or line.pack_size_snapshot is None or line.ordered_bottles is None or line.size_ml is None or line.case_rate is None or line.mger is None or line.amount is None]
    if incomplete:
        raise PurchaseOrderError("incomplete", f"lines {incomplete} need an active product, case-pack rule, and all PDF values")
    if sum(line.cases for line in order.lines) != order.total_cases or sum(line.loose_bottles for line in order.lines) != order.total_loose_bottles:
        raise PurchaseOrderError("totals_mismatch", "header case and loose-bottle totals must match corrected lines")
    amount_total = sum((line.amount or Decimal("0")) for line in order.lines)
    mger_total = sum((line.mger or Decimal("0")) for line in order.lines)
    if abs(amount_total - order.order_total) > Decimal("0.05") or abs(mger_total - order.mger_total) > Decimal("0.05"):
        raise PurchaseOrderError("totals_mismatch", "PDF monetary totals must match corrected lines")
    delivery_missing = [line.sequence for line in order.lines if line.delivered_bottles is None or line.accepted_bottles is None]
    if delivery_missing:
        raise PurchaseOrderError("delivery_incomplete", f"lines {delivery_missing} need delivered and accepted bottles")
    invalid = [line.sequence for line in order.lines if (line.accepted_bottles or 0) > (line.delivered_bottles or 0)]
    if invalid:
        raise PurchaseOrderError("delivery_invalid", f"accepted bottles cannot exceed delivered bottles (lines {invalid})")
    broken = any((line.delivered_bottles or 0) > (line.accepted_bottles or 0) for line in order.lines)
    if broken and (not (order.wastage_reason or "").strip() or not order.wastage_attested):
        raise PurchaseOrderError("wastage_declaration_required", "a wastage reason and attestation are required for breakage")

    shop = await db.get(Shop, order.shop_id)
    purchase_details_captured = True if shop is None else shop.receiving_vendor_link_enabled
    if purchase_details_captured:
        if not all((order.vendor_id, order.purchase_date, order.vendor_invoice_number, order.invoice_value is not None)):
            raise PurchaseOrderError("purchase_details_required", "vendor, purchase date, invoice number, and invoice value are required")
        received = [line for line in order.lines if (line.delivered_bottles or 0) > 0]
        if any(line.unit_cost is None or line.unit_cost <= 0 for line in received):
            raise PurchaseOrderError("unit_cost_required", "each delivered line requires a positive unit cost")
        merchandise_total = sum(((line.unit_cost or Decimal("0")) * (line.delivered_bottles or 0) for line in received), Decimal("0"))
        if merchandise_total.quantize(Decimal("0.01")) != order.invoice_value.quantize(Decimal("0.01")):
            raise PurchaseOrderError("invoice_value_mismatch", f"invoice_value must match merchandise total exactly ({merchandise_total:.2f})")
    else:
        from datetime import date as date_cls
        order.purchase_date = date_cls.today()
        order.vendor_invoice_number = "AUTO-RECEIPT"
        order.invoice_value = Decimal("0.00")

    # Inward quantity retains delivered bottles for financial/audit reconciliation;
    # approval uses good-condition bottles when creating usable lot stock.
    receipt_lines = [{"barcode": line.product.barcode, "quantity": line.delivered_bottles, "good_condition_quantity": line.accepted_bottles, "unit_cost": line.unit_cost, "purchase_order_line_id": line.id} for line in order.lines]
    # create_stock_inward is shared with the historical open-PO workflow. Make
    # this draft eligible only inside the finalisation transaction.
    order.status = PurchaseOrderStatus.OPEN
    inward = await create_stock_inward(db, actor_id=actor_user_id, actor_shop_id=order.shop_id, vendor_id=order.vendor_id, purchase_date=order.purchase_date, vendor_invoice_number=order.vendor_invoice_number, invoice_value=order.invoice_value, reference=f"OSBCL PO {order.osbcl_token}", notes=order.wastage_reason, lines=receipt_lines, purchase_details_captured=purchase_details_captured, purchase_order_id=order.id, purchase_order_line_ids=[line["purchase_order_line_id"] for line in receipt_lines])
    inward.wastage_reason = order.wastage_reason if broken else None
    inward.wastage_attested = order.wastage_attested if broken else False
    inward.wastage_attested_by_user_id = order.wastage_attested_by_user_id if broken else None
    inward.wastage_attested_at = order.wastage_attested_at if broken else None
    inward = await approve_stock_inward(db, inward_id=inward.id, shop_id=order.shop_id, actor_user_id=actor_user_id)
    order.status = PurchaseOrderStatus.FULFILLED if all((line.delivered_bottles or 0) >= (line.ordered_bottles or 0) for line in order.lines) else PurchaseOrderStatus.CLOSED_SHORT
    order.confirmed_by_user_id = actor_user_id
    order.confirmed_at = datetime.now(UTC)
    await db.flush()
    return order, inward


async def cancel_order(db: AsyncSession, order: PurchaseOrder, actor_user_id: int, reason: str) -> PurchaseOrder:
    if order.status == PurchaseOrderStatus.CANCELLED:
        raise PurchaseOrderError("cancelled", "purchase order is already cancelled")
    order.status = PurchaseOrderStatus.CANCELLED
    order.cancelled_by_user_id = actor_user_id
    order.cancelled_at = datetime.now(UTC)
    order.cancellation_reason = reason
    return order


async def attach_reconciliation(db: AsyncSession, order: PurchaseOrder) -> None:
    line_ids = [line.id for line in order.lines]
    totals: dict[int, tuple[int, int]] = {}
    if line_ids:
        rows = await db.execute(
            select(
                StockInwardLine.purchase_order_line_id,
                func.coalesce(func.sum(StockInwardLine.quantity), 0),
                func.coalesce(func.sum(StockInwardLine.good_condition_quantity), 0),
            )
            .join(StockInward, StockInward.id == StockInwardLine.stock_inward_id)
            .where(
                StockInwardLine.purchase_order_line_id.in_(line_ids),
                StockInward.status.in_([StockInwardStatus.APPROVED, StockInwardStatus.COMPLETED]),
            )
            .group_by(StockInwardLine.purchase_order_line_id)
        )
        totals = {line_id: (int(delivered), int(accepted)) for line_id, delivered, accepted in rows}
    for line in order.lines:
        if line.delivered_bottles is not None or line.accepted_bottles is not None:
            delivered, accepted = line.delivered_bottles, line.accepted_bottles
        else:
            delivered, accepted = totals.get(line.id, (0, 0))
        ordered = line.ordered_bottles or 0
        line.delivered_bottles = delivered
        line.accepted_bottles = accepted
        line.broken_bottles = delivered - accepted if delivered is not None and accepted is not None else None
        line.remaining_bottles = max(ordered - delivered, 0) if delivered is not None else ordered
        line.excess_bottles = max(delivered - ordered, 0) if delivered is not None else 0
    completed_receipt = (
        await db.execute(
            select(StockInward.id, StockInward.lot_id)
            .where(
                StockInward.purchase_order_id == order.id,
                StockInward.status == StockInwardStatus.COMPLETED,
            )
            .order_by(StockInward.completed_at.desc(), StockInward.id.desc())
            .limit(1)
        )
    ).first()
    order.receipt_stock_inward_id = completed_receipt[0] if completed_receipt else None
    order.receipt_lot_id = completed_receipt[1] if completed_receipt else None


async def refresh_order_status(db: AsyncSession, order_id: int) -> None:
    order = await get_order(db, order_id, shop_id=None, lock=True)
    if order.status in (PurchaseOrderStatus.DRAFT, PurchaseOrderStatus.CANCELLED):
        return
    delivered = sum(getattr(line, "delivered_bottles", 0) for line in order.lines)
    remaining = sum(getattr(line, "remaining_bottles", 0) for line in order.lines)
    if delivered == 0:
        order.status = PurchaseOrderStatus.OPEN
    elif remaining == 0:
        order.status = PurchaseOrderStatus.FULFILLED
    else:
        order.status = PurchaseOrderStatus.PARTIALLY_RECEIVED


def resolve_source_path(storage_root: Path, relative_path: str) -> Path:
    root = storage_root.resolve()
    candidate = (root / relative_path).resolve()
    if root != candidate and root not in candidate.parents:
        raise PurchaseOrderError("invalid_path", "Stored purchase-order path is invalid")
    return candidate


def _rank_products(item_name: str, size_ml: int | None, products: list[Product]) -> list[dict]:
    needle = _normalise(item_name)
    candidates = []
    for product in products:
        product_size = _size_ml(product.size_label)
        if size_ml is not None and product_size != size_ml:
            continue
        score = SequenceMatcher(None, needle, _normalise(product.brand)).ratio()
        candidates.append({"product_id": product.id, "brand": product.brand, "size_label": product.size_label, "score": round(score, 4)})
    return sorted(candidates, key=lambda row: (-row["score"], row["product_id"]))


def _normalise(value: str) -> str:
    return " ".join(re.sub(r"[^a-z0-9]+", " ", re.sub(r"\(\s*\d+\s*\)\s*$", "", value.casefold())).split())


def _size_ml(value: str) -> int | None:
    match = re.search(r"(\d{2,4})\s*ml", value, re.I) or re.search(r"\b(\d{2,4})\b", value)
    return int(match.group(1)) if match else None
