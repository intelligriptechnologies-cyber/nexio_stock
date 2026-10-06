"""OSBCL purchase-order import, review, and reconciliation routes."""

from __future__ import annotations

import asyncio
import hashlib
import tempfile
import time
import traceback
import uuid
from pathlib import Path
from typing import Annotated

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    Header,
    HTTPException,
    Query,
    Request,
    Response,
    UploadFile,
    status,
)
from fastapi.responses import FileResponse
from sqlalchemy.exc import IntegrityError

from app.api.deps import (
    DbSession,
    require_no_offline_session_lock,
    require_role,
    resolve_read_shop_id,
    resolve_write_shop_id,
)
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
    PurchaseOrderReceiptApproval,
    PurchaseOrderReceiptApprovalResponse,
)
from app.services.import_audit import append_import_audit
from app.services.osbcl_parser import (
    OsbclParseError,
    inspect_pdf,
    parse_osbcl_pdf,
    validate_osbcl_order,
)
from app.services.purchase_orders import (
    PurchaseOrderError,
    approve_receipt,
    cancel_order,
    confirm_order,
    create_imported_order,
    delete_draft,
    ensure_case_pack_rules,
    finalize_draft,
    find_duplicate,
    get_order,
    list_orders,
    replace_case_pack_rules,
    resolve_source_path,
    update_draft,
)
from app.services.stock_inwards import StockInwardError

router = APIRouter(prefix="/purchase-orders", tags=["purchase-orders"])
_writers = (UserRole.RECEIVER_USER, UserRole.OWNER, UserRole.SUPERADMIN)
_owners = (UserRole.OWNER, UserRole.SUPERADMIN)
IMPORT_VALIDATION_MESSAGE = (
    "Could not retrieve expected information, please verify PDF content or contact System Admin."
)
IMPORT_ATTEMPT_HEADER = "X-Import-Attempt-ID"


def _import_validation_error(attempt_id: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail={"code": "unsupported_po_content", "message": IMPORT_VALIDATION_MESSAGE},
        headers={IMPORT_ATTEMPT_HEADER: attempt_id},
    )


def _error(exc: PurchaseOrderError) -> HTTPException:
    code_status = {
        "not_found": status.HTTP_404_NOT_FOUND,
        "duplicate": status.HTTP_409_CONFLICT,
        "immutable": status.HTTP_409_CONFLICT,
        "not_draft": status.HTTP_409_CONFLICT,
        "referenced": status.HTTP_409_CONFLICT,
        "cancelled": status.HTTP_409_CONFLICT,
        "incomplete": status.HTTP_400_BAD_REQUEST,
        "invalid_product": status.HTTP_400_BAD_REQUEST,
        "delivery_invalid": status.HTTP_400_BAD_REQUEST,
        "delivery_incomplete": status.HTTP_400_BAD_REQUEST,
        "totals_mismatch": status.HTTP_400_BAD_REQUEST,
        "wastage_declaration_required": status.HTTP_400_BAD_REQUEST,
        "invalid_path": status.HTTP_500_INTERNAL_SERVER_ERROR,
        "receipt_unavailable": status.HTTP_409_CONFLICT,
        "receipt_already_approved": status.HTTP_409_CONFLICT,
        "receipt_lines_invalid": status.HTTP_400_BAD_REQUEST,
        "receipt_product_invalid": status.HTTP_400_BAD_REQUEST,
        "purchase_details_required": status.HTTP_400_BAD_REQUEST,
        "unit_cost_required": status.HTTP_400_BAD_REQUEST,
        "invoice_value_mismatch": status.HTTP_400_BAD_REQUEST,
        "breakage_notes_required": status.HTTP_400_BAD_REQUEST,
        "over_receipt_reason_required": status.HTTP_400_BAD_REQUEST,
    }
    return HTTPException(
        status_code=code_status.get(exc.code, 400),
        detail={"code": exc.code, "message": exc.message},
    )


@router.post("/import", response_model=PurchaseOrderPublic, status_code=status.HTTP_201_CREATED)
async def import_order(
    db: DbSession,
    file: Annotated[UploadFile, File(description="Image-only OSBCL purchase-order PDF")],
    request: Request,
    response: Response,
    shop_id: Annotated[int | None, Form()] = None,
    import_attempt_id: Annotated[str | None, Header(alias=IMPORT_ATTEMPT_HEADER)] = None,
    user: User = Depends(require_role(*_writers)),
) -> PurchaseOrderPublic:
    # A client ID allows browser, Caddy, and application events to be joined.
    attempt_id = (
        import_attempt_id
        if import_attempt_id and len(import_attempt_id) <= 128
        else uuid.uuid4().hex
    )
    response.headers[IMPORT_ATTEMPT_HEADER] = attempt_id
    started = time.perf_counter()
    stage_durations: dict[str, int] = {}
    file_size: int | None = None
    page_count: int | None = None
    resolved_shop = await resolve_write_shop_id(db, user, shop_id)
    settings = get_settings()
    append_import_audit(
        attempt_id=attempt_id, event="start", stage="read", user_id=user.id, shop_id=resolved_shop
    )
    read_started = time.perf_counter()
    data = await file.read(settings.po_max_upload_mb * 1024 * 1024 + 1)
    stage_durations["read"] = round((time.perf_counter() - read_started) * 1000)
    file_size = len(data)

    def audit(event: str, stage: str, http_status: int, **extra: object) -> None:
        append_import_audit(
            attempt_id=attempt_id,
            event=event,
            stage=stage,
            http_status=http_status,
            user_id=user.id,
            shop_id=resolved_shop,
            file_size_bytes=file_size,
            page_count=page_count,
            elapsed_ms=round((time.perf_counter() - started) * 1000),
            stage_durations_ms=stage_durations,
            **extra,
        )

    if await request.is_disconnected():
        audit("client_disconnected", "read", 499)
        raise HTTPException(
            status_code=499,
            detail="Upload was cancelled",
            headers={IMPORT_ATTEMPT_HEADER: attempt_id},
        )
    if len(data) > settings.po_max_upload_mb * 1024 * 1024:
        audit("validation_rejection", "read", 413)
        raise HTTPException(
            status_code=413,
            detail=f"PDF exceeds {settings.po_max_upload_mb} MB",
            headers={IMPORT_ATTEMPT_HEADER: attempt_id},
        )
    if not data.startswith(b"%PDF-"):
        audit("validation_rejection", "validate", 422)
        raise _import_validation_error(attempt_id)
    digest = hashlib.sha256(data).hexdigest()
    duplicate = await find_duplicate(db, shop_id=resolved_shop, source_sha256=digest)
    if duplicate:
        audit("duplicate", "duplicate_check", 409)
        error = _error(
            PurchaseOrderError("duplicate", f"This file was already imported as PO #{duplicate.id}")
        )
        error.headers = {IMPORT_ATTEMPT_HEADER: attempt_id}
        raise error

    destination: Path | None = None
    try:
        # OCR and validation operate on a disposable copy.  An invalid upload
        # must leave neither an original PDF nor a draft PO behind.
        with tempfile.TemporaryDirectory(prefix="osbcl-import-") as temporary_directory:
            temporary_pdf = Path(temporary_directory) / "upload.pdf"
            temporary_pdf.write_bytes(data)
            inspect_started = time.perf_counter()
            page_count = await asyncio.to_thread(
                inspect_pdf, temporary_pdf, max_pages=settings.po_max_pages
            )
            stage_durations["inspect"] = round((time.perf_counter() - inspect_started) * 1000)
            parse_started = time.perf_counter()
            parsed = await asyncio.to_thread(parse_osbcl_pdf, temporary_pdf)
            stage_durations["ocr_parse"] = round((time.perf_counter() - parse_started) * 1000)
            validate_osbcl_order(parsed)

        if await request.is_disconnected():
            audit("client_disconnected", "ocr_parse", 499)
            raise HTTPException(
                status_code=499,
                detail="Upload was cancelled",
                headers={IMPORT_ATTEMPT_HEADER: attempt_id},
            )

        storage_started = time.perf_counter()
        relative = Path(f"shop-{resolved_shop}") / f"{uuid.uuid4().hex}.pdf"
        destination = resolve_source_path(settings.po_storage_root, str(relative))
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)
        stage_durations["storage"] = round((time.perf_counter() - storage_started) * 1000)
        database_started = time.perf_counter()
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
        stage_durations["database"] = round((time.perf_counter() - database_started) * 1000)
    except asyncio.CancelledError:
        if destination is not None:
            destination.unlink(missing_ok=True)
        audit("client_disconnected", "cancelled", 499)
        raise
    except (OsbclParseError, PurchaseOrderError, IntegrityError) as exc:
        if destination is not None:
            destination.unlink(missing_ok=True)
        if isinstance(exc, PurchaseOrderError):
            http_error = _error(exc)
            audit(
                "duplicate" if exc.code == "duplicate" else "parse_rejection",
                "database",
                http_error.status_code,
            )
            http_error.headers = {IMPORT_ATTEMPT_HEADER: attempt_id}
            raise http_error from exc
        if isinstance(exc, IntegrityError):
            audit("duplicate", "database", 409)
            raise HTTPException(
                status_code=409,
                detail="This OSBCL token or PDF was imported concurrently",
                headers={IMPORT_ATTEMPT_HEADER: attempt_id},
            ) from exc
        audit(
            "ocr_parse_rejection", "ocr_parse" if "ocr_parse" in stage_durations else "inspect", 422
        )
        raise _import_validation_error(attempt_id) from exc
    except Exception as exc:
        if destination is not None:
            destination.unlink(missing_ok=True)
        audit(
            "unexpected_exception",
            "import",
            500,
            error_type=type(exc).__name__,
            traceback="".join(traceback.format_exception(type(exc), exc, exc.__traceback__)),
        )
        raise
    audit("success", "complete", 201)
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
    return PurchaseOrderListResponse(
        purchase_orders=[PurchaseOrderPublic.model_validate(row) for row in rows]
    )


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
        rows = await replace_case_pack_rules(
            db, resolved_shop, [rule.model_dump() for rule in payload.rules]
        )
    return [CasePackRulePublic.model_validate(row) for row in rows]


@router.get("/{order_id:int}", response_model=PurchaseOrderPublic)
async def get_order_detail(
    order_id: int, db: DbSession, user: User = Depends(require_role(*_writers))
) -> PurchaseOrderPublic:
    try:
        order = await get_order(
            db, order_id, shop_id=None if user.role == UserRole.SUPERADMIN else user.shop_id
        )
    except (PurchaseOrderError, StockInwardError) as exc:
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
        order = await get_order(
            db,
            order_id,
            shop_id=None if user.role == UserRole.SUPERADMIN else user.shop_id,
            lock=True,
        )
        async with unit_of_work(db):
            order = await update_draft(db, order, payload.model_dump(), actor_user_id=user.id)
        order = await get_order(db, order_id, shop_id=order.shop_id)
    except PurchaseOrderError as exc:
        raise _error(exc) from exc
    return PurchaseOrderPublic.model_validate(order)


@router.delete("/{order_id:int}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_order(
    order_id: int, db: DbSession, user: User = Depends(require_role(*_owners))
) -> None:
    """Permanently remove an unreferenced draft and its original PDF."""
    try:
        async with unit_of_work(db):
            order = await get_order(
                db,
                order_id,
                shop_id=None if user.role == UserRole.SUPERADMIN else user.shop_id,
                lock=True,
            )
            source_path = resolve_source_path(get_settings().po_storage_root, order.source_path)
            await delete_draft(db, order)
    except PurchaseOrderError as exc:
        raise _error(exc) from exc

    # A missing file is already clean; filesystem errors are surfaced rather
    # than silently reporting a successful complete deletion.
    source_path.unlink(missing_ok=True)


@router.post("/{order_id:int}/confirm", response_model=PurchaseOrderPublic)
async def confirm(
    order_id: int, db: DbSession, user: User = Depends(require_role(*_owners))
) -> PurchaseOrderPublic:
    try:
        async with unit_of_work(db):
            order = await get_order(
                db,
                order_id,
                shop_id=None if user.role == UserRole.SUPERADMIN else user.shop_id,
                lock=True,
            )
            await confirm_order(db, order, user.id)
        order = await get_order(db, order_id, shop_id=order.shop_id)
    except PurchaseOrderError as exc:
        raise _error(exc) from exc
    return PurchaseOrderPublic.model_validate(order)


@router.post("/{order_id:int}/finalize", response_model=PurchaseOrderReceiptApprovalResponse)
async def finalize_order(
    order_id: int, db: DbSession, user: User = Depends(require_role(*_owners))
) -> PurchaseOrderReceiptApprovalResponse:
    """Finalise a saved draft directly; legacy open-PO receipt routes remain intact."""
    try:
        async with unit_of_work(db):
            order = await get_order(
                db,
                order_id,
                shop_id=None if user.role == UserRole.SUPERADMIN else user.shop_id,
                lock=True,
            )
            await require_no_offline_session_lock(
                db, shop_id=order.shop_id, action="purchase-order finalization"
            )
            order, inward = await finalize_draft(db, order=order, actor_user_id=user.id)
        order = await get_order(db, order_id, shop_id=order.shop_id)
    except (PurchaseOrderError, StockInwardError) as exc:
        raise _error(exc) from exc
    return PurchaseOrderReceiptApprovalResponse(
        purchase_order=PurchaseOrderPublic.model_validate(order),
        stock_inward_id=inward.id,
        lot_id=inward.lot_id,
    )


@router.post("/{order_id:int}/approve-receipt", response_model=PurchaseOrderReceiptApprovalResponse)
async def approve_order_receipt(
    order_id: int,
    payload: PurchaseOrderReceiptApproval,
    db: DbSession,
    user: User = Depends(require_role(*_owners)),
) -> PurchaseOrderReceiptApprovalResponse:
    """Owner's one-shot delivery review and inventory approval for a PO."""
    try:
        async with unit_of_work(db):
            order = await get_order(
                db,
                order_id,
                shop_id=None if user.role == UserRole.SUPERADMIN else user.shop_id,
                lock=True,
            )
            await require_no_offline_session_lock(
                db, shop_id=order.shop_id, action="purchase-order receipt approval"
            )
            order, inward = await approve_receipt(
                db, order=order, actor_user_id=user.id, payload=payload.model_dump()
            )
        order = await get_order(db, order_id, shop_id=order.shop_id)
    except PurchaseOrderError as exc:
        raise _error(exc) from exc
    return PurchaseOrderReceiptApprovalResponse(
        purchase_order=PurchaseOrderPublic.model_validate(order),
        stock_inward_id=inward.id,
        lot_id=inward.lot_id,
    )


@router.post("/{order_id:int}/cancel", response_model=PurchaseOrderPublic)
async def cancel(
    order_id: int,
    payload: PurchaseOrderCancel,
    db: DbSession,
    user: User = Depends(require_role(*_owners)),
) -> PurchaseOrderPublic:
    try:
        async with unit_of_work(db):
            order = await get_order(
                db,
                order_id,
                shop_id=None if user.role == UserRole.SUPERADMIN else user.shop_id,
                lock=True,
            )
            await cancel_order(db, order, user.id, payload.reason)
        order = await get_order(db, order_id, shop_id=order.shop_id)
    except PurchaseOrderError as exc:
        raise _error(exc) from exc
    return PurchaseOrderPublic.model_validate(order)


@router.get("/{order_id:int}/original")
async def download_original(
    order_id: int, db: DbSession, user: User = Depends(require_role(*_writers))
) -> FileResponse:
    try:
        order = await get_order(
            db, order_id, shop_id=None if user.role == UserRole.SUPERADMIN else user.shop_id
        )
        path = resolve_source_path(get_settings().po_storage_root, order.source_path)
    except PurchaseOrderError as exc:
        raise _error(exc) from exc
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Original PDF is missing from storage")
    return FileResponse(path, media_type="application/pdf", filename=order.source_filename)
