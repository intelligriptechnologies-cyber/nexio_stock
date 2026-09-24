"""OSBCL purchase-order import, review, and reconciliation routes."""
from __future__ import annotations

import asyncio
import hashlib
import uuid
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.exc import IntegrityError

from app.api.deps import DbSession, require_role, resolve_read_shop_id, resolve_write_shop_id
from app.config import get_settings
from app.db import unit_of_work
from app.models.purchase_order import PurchaseOrderStatus
from app.models.user import User, UserRole
from app.schemas.purchase_order import (
    CasePackRulePublic,
    CasePackRulesUpdate,
    PurchaseOrderCancel,
    PurchaseOrderDraftUpdate,
    PurchaseOrderListResponse,
    PurchaseOrderPublic,
)
from app.services.osbcl_parser import OsbclParseError, ParsedOrder, inspect_pdf, parse_osbcl_pdf
from app.services.purchase_orders import (
    PurchaseOrderError,
    cancel_order,
    confirm_order,
    create_imported_order,
    ensure_case_pack_rules,
    find_duplicate,
    get_order,
    list_orders,
    replace_case_pack_rules,
    resolve_source_path,
    update_draft,
)

router = APIRouter(prefix="/purchase-orders", tags=["purchase-orders"])
_writers = (UserRole.RECEIVER_USER, UserRole.OWNER, UserRole.SUPERADMIN)
_owners = (UserRole.OWNER, UserRole.SUPERADMIN)


def _error(exc: PurchaseOrderError) -> HTTPException:
    code_status = {
        "not_found": status.HTTP_404_NOT_FOUND,
        "duplicate": status.HTTP_409_CONFLICT,
        "immutable": status.HTTP_409_CONFLICT,
        "not_draft": status.HTTP_409_CONFLICT,
        "cancelled": status.HTTP_409_CONFLICT,
        "incomplete": status.HTTP_400_BAD_REQUEST,
        "invalid_product": status.HTTP_400_BAD_REQUEST,
        "invalid_path": status.HTTP_500_INTERNAL_SERVER_ERROR,
    }
    return HTTPException(status_code=code_status.get(exc.code, 400), detail={"code": exc.code, "message": exc.message})


@router.post("/import", response_model=PurchaseOrderPublic, status_code=status.HTTP_201_CREATED)
async def import_order(
    db: DbSession,
    file: Annotated[UploadFile, File(description="Image-only OSBCL purchase-order PDF")],
    shop_id: Annotated[int | None, Form()] = None,
    user: User = Depends(require_role(*_writers)),
) -> PurchaseOrderPublic:
    resolved_shop = await resolve_write_shop_id(db, user, shop_id)
    settings = get_settings()
    data = await file.read(settings.po_max_upload_mb * 1024 * 1024 + 1)
    if len(data) > settings.po_max_upload_mb * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"PDF exceeds {settings.po_max_upload_mb} MB")
    if not data.startswith(b"%PDF-"):
        raise HTTPException(status_code=400, detail="File does not have a valid PDF signature")
    digest = hashlib.sha256(data).hexdigest()
    duplicate = await find_duplicate(db, shop_id=resolved_shop, source_sha256=digest)
    if duplicate:
        raise _error(PurchaseOrderError("duplicate", f"This file was already imported as PO #{duplicate.id}"))

    relative = Path(f"shop-{resolved_shop}") / f"{uuid.uuid4().hex}.pdf"
    destination = resolve_source_path(settings.po_storage_root, str(relative))
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(data)
    try:
        page_count = await asyncio.to_thread(inspect_pdf, destination, max_pages=settings.po_max_pages)
        try:
            parsed = await asyncio.to_thread(parse_osbcl_pdf, destination)
        except OsbclParseError as exc:
            parsed = ParsedOrder(review_flags=[str(exc)], raw_ocr={"error": str(exc)})
        async with unit_of_work(db):
            order = await create_imported_order(
                db,
                shop_id=resolved_shop,
                actor_user_id=user.id,
                filename=file.filename or "osbcl-order.pdf",
                sha256=digest,
                relative_path=str(relative).replace("\\", "/"),
                page_count=page_count,
                parsed=parsed,
            )
    except (OsbclParseError, PurchaseOrderError, IntegrityError) as exc:
        destination.unlink(missing_ok=True)
        if isinstance(exc, PurchaseOrderError):
            raise _error(exc) from exc
        if isinstance(exc, IntegrityError):
            raise HTTPException(status_code=409, detail="This OSBCL token or PDF was imported concurrently") from exc
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return PurchaseOrderPublic.model_validate(order)


@router.get("", response_model=PurchaseOrderListResponse)
async def get_orders(
    db: DbSession,
    user: User = Depends(require_role(*_writers)),
    shop_id: int | None = Query(default=None),
    status_filter: Annotated[PurchaseOrderStatus | None, Query(alias="status")] = None,
) -> PurchaseOrderListResponse:
    resolved_shop = resolve_read_shop_id(user, shop_id)
    rows = await list_orders(db, shop_id=resolved_shop, status=status_filter)
    return PurchaseOrderListResponse(purchase_orders=[PurchaseOrderPublic.model_validate(row) for row in rows])


@router.get("/case-pack-rules", response_model=list[CasePackRulePublic])
async def get_case_packs(
    db: DbSession,
    user: User = Depends(require_role(*_writers)),
    shop_id: int | None = Query(default=None),
) -> list[CasePackRulePublic]:
    resolved_shop = resolve_read_shop_id(user, shop_id)
    if resolved_shop is None:
        raise HTTPException(status_code=400, detail="Pick a shop first")
    async with unit_of_work(db):
        rows = await ensure_case_pack_rules(db, resolved_shop)
    return [CasePackRulePublic.model_validate(row) for row in rows]


@router.put("/case-pack-rules", response_model=list[CasePackRulePublic])
async def put_case_packs(
    payload: CasePackRulesUpdate,
    db: DbSession,
    user: User = Depends(require_role(*_owners)),
) -> list[CasePackRulePublic]:
    resolved_shop = await resolve_write_shop_id(db, user, payload.shop_id)
    async with unit_of_work(db):
        rows = await replace_case_pack_rules(db, resolved_shop, [rule.model_dump() for rule in payload.rules])
    return [CasePackRulePublic.model_validate(row) for row in rows]


@router.get("/{order_id:int}", response_model=PurchaseOrderPublic)
async def get_order_detail(order_id: int, db: DbSession, user: User = Depends(require_role(*_writers))) -> PurchaseOrderPublic:
    try:
        order = await get_order(db, order_id, shop_id=None if user.role == UserRole.SUPERADMIN else user.shop_id)
    except PurchaseOrderError as exc:
        raise _error(exc) from exc
    return PurchaseOrderPublic.model_validate(order)


@router.put("/{order_id:int}", response_model=PurchaseOrderPublic)
async def put_order_detail(
    order_id: int,
    payload: PurchaseOrderDraftUpdate,
    db: DbSession,
    user: User = Depends(require_role(*_writers)),
) -> PurchaseOrderPublic:
    try:
        order = await get_order(db, order_id, shop_id=None if user.role == UserRole.SUPERADMIN else user.shop_id, lock=True)
        async with unit_of_work(db):
            order = await update_draft(db, order, payload.model_dump())
        order = await get_order(db, order_id, shop_id=order.shop_id)
    except PurchaseOrderError as exc:
        raise _error(exc) from exc
    return PurchaseOrderPublic.model_validate(order)


@router.post("/{order_id:int}/confirm", response_model=PurchaseOrderPublic)
async def confirm(order_id: int, db: DbSession, user: User = Depends(require_role(*_owners))) -> PurchaseOrderPublic:
    try:
        async with unit_of_work(db):
            order = await get_order(db, order_id, shop_id=None if user.role == UserRole.SUPERADMIN else user.shop_id, lock=True)
            await confirm_order(db, order, user.id)
        order = await get_order(db, order_id, shop_id=order.shop_id)
    except PurchaseOrderError as exc:
        raise _error(exc) from exc
    return PurchaseOrderPublic.model_validate(order)


@router.post("/{order_id:int}/cancel", response_model=PurchaseOrderPublic)
async def cancel(order_id: int, payload: PurchaseOrderCancel, db: DbSession, user: User = Depends(require_role(*_owners))) -> PurchaseOrderPublic:
    try:
        async with unit_of_work(db):
            order = await get_order(db, order_id, shop_id=None if user.role == UserRole.SUPERADMIN else user.shop_id, lock=True)
            await cancel_order(db, order, user.id, payload.reason)
        order = await get_order(db, order_id, shop_id=order.shop_id)
    except PurchaseOrderError as exc:
        raise _error(exc) from exc
    return PurchaseOrderPublic.model_validate(order)


@router.get("/{order_id:int}/original")
async def download_original(order_id: int, db: DbSession, user: User = Depends(require_role(*_writers))) -> FileResponse:
    try:
        order = await get_order(db, order_id, shop_id=None if user.role == UserRole.SUPERADMIN else user.shop_id)
        path = resolve_source_path(get_settings().po_storage_root, order.source_path)
    except PurchaseOrderError as exc:
        raise _error(exc) from exc
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Original PDF is missing from storage")
    return FileResponse(path, media_type="application/pdf", filename=order.source_filename)
