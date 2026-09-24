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
from app.models.stock_inward import StockInward, StockInwardLine, StockInwardStatus
from app.services.osbcl_parser import ParsedOrder

DEFAULT_CASE_PACKS = {90: 96, 180: 48, 375: 24, 500: 12, 650: 6, 750: 8}


class PurchaseOrderError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


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


async def update_draft(db: AsyncSession, order: PurchaseOrder, payload: dict) -> PurchaseOrder:
    if order.status != PurchaseOrderStatus.DRAFT:
        raise PurchaseOrderError("immutable", "Only draft purchase orders can be changed")
    lines = payload.pop("lines")
    for key, value in payload.items():
        setattr(order, key, value)
    rules = {row.size_ml: row.bottles_per_case for row in await ensure_case_pack_rules(db, order.shop_id)}
    products = {p.id: p for p in (await db.execute(select(Product).where(Product.shop_id == order.shop_id, Product.is_active.is_(True), Product.status == ProductStatus.ACTIVE))).scalars().all()}
    order.lines.clear()
    await db.flush()
    flags: list[str] = []
    for line in lines:
        product_id = line.get("product_id")
        if product_id is not None and product_id not in products:
            raise PurchaseOrderError("invalid_product", f"Product {product_id} is not active in this shop")
        pack = rules.get(line.get("size_ml"))
        if pack is None:
            flags.append(f"No case-pack rule for {line.get('size_ml') or 'unknown'} ml")
        line.pop("id", None)
        order.lines.append(PurchaseOrderLine(
            **line,
            pack_size_snapshot=pack,
            ordered_bottles=line["cases"] * pack + line["loose_bottles"] if pack else None,
            match_candidates=[],
            field_confidence={},
        ))
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
        delivered, accepted = totals.get(line.id, (0, 0))
        ordered = line.ordered_bottles or 0
        line.delivered_bottles = delivered
        line.accepted_bottles = accepted
        line.broken_bottles = delivered - accepted
        line.remaining_bottles = max(ordered - delivered, 0)
        line.excess_bottles = max(delivered - ordered, 0)


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
