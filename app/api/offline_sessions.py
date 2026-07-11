"""Guarded cashier offline-session API."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.api._errors import map_error_to_http
from app.api.deps import DbSession, require_role, resolve_read_shop_id, resolve_write_shop_id
from app.db import unit_of_work
from app.models.offline_session import OfflineSession
from app.models.user import User, UserRole
from app.schemas.offline_session import (
    OfflineSessionActiveResponse,
    OfflineSessionDiscardRequest,
    OfflineSessionExtendResponse,
    OfflineSessionStartRequest,
    OfflineSessionStartResponse,
    OfflineSessionSyncRequest,
    OfflineSessionSyncResponse,
)
from app.security.jwt import TokenError, decode_access_token
from app.services.checkout import CheckoutError
from app.services.offline_sessions import (
    OfflineSessionError,
    discard_offline_session,
    extend_offline_session,
    get_active_session,
    mark_session_expired,
    mark_sync_failed,
    start_offline_session,
    sync_offline_session,
)

router = APIRouter(prefix="/offline-sessions", tags=["offline-sessions"])

_bearer = HTTPBearer(auto_error=False)
_cashier_roles = (UserRole.CASHIER_USER, UserRole.OWNER, UserRole.SUPERADMIN)
_owner_roles = (UserRole.OWNER, UserRole.SUPERADMIN)
_status_roles = (
    UserRole.CASHIER_USER,
    UserRole.OWNER,
    UserRole.RECEIVER_USER,
    UserRole.SUPERADMIN,
)

_OFFLINE_CODE_TO_STATUS: dict[str, int] = {
    "offline_session_active": status.HTTP_409_CONFLICT,
    "not_found": status.HTTP_404_NOT_FOUND,
    "not_session_cashier": status.HTTP_403_FORBIDDEN,
    "bad_state": status.HTTP_409_CONFLICT,
    "extension_used": status.HTTP_409_CONFLICT,
    "expired": status.HTTP_409_CONFLICT,
    "empty_batch": status.HTTP_400_BAD_REQUEST,
    "duplicate_temp_receipt_id": status.HTTP_400_BAD_REQUEST,
    "duplicate_idempotency_key": status.HTTP_400_BAD_REQUEST,
    "idempotency_key_consumed": status.HTTP_409_CONFLICT,
}

_CHECKOUT_SYNC_CODE_TO_STATUS: dict[str, int] = {
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
    "pending_product_in_cart": status.HTTP_400_BAD_REQUEST,
}


@dataclass
class OfflineActor:
    user: User
    offline_session_id: int | None = None


async def _offline_or_normal_actor(
    db: DbSession,
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> OfflineActor:
    if creds is None or not creds.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="missing bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        claims = decode_access_token(creds.credentials)
    except TokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"invalid token: {exc}",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc
    user = await db.get(User, int(claims["sub"]))
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="user not found or inactive")
    await db.refresh(user)
    if claims.get("token_type") == "offline_session":
        session_id = claims.get("offline_session_id")
        if not isinstance(session_id, int):
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid offline-session token")
        return OfflineActor(user=user, offline_session_id=session_id)
    if user.role not in _status_roles:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="role not permitted")
    return OfflineActor(user=user)


@router.post(
    "/start",
    response_model=OfflineSessionStartResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Start one guarded cashier offline session for a shop",
)
async def start_session(
    payload: OfflineSessionStartRequest,
    db: DbSession,
    user: User = Depends(require_role(*_cashier_roles)),
) -> OfflineSessionStartResponse:
    shop_id = await resolve_write_shop_id(db, user, payload.shop_id)
    try:
        async with unit_of_work(db):
            result = await start_offline_session(
                db, shop_id=shop_id, cashier_user_id=user.id
            )
    except OfflineSessionError as exc:
        raise map_error_to_http(
            exc,
            code_to_status=_OFFLINE_CODE_TO_STATUS,
            log_event="offline_session.start.unmapped_error_code",
        ) from exc
    return OfflineSessionStartResponse(
        session=result.session,
        offline_token=result.offline_token,
        catalog=result.catalog,
    )


@router.get(
    "/active",
    response_model=OfflineSessionActiveResponse,
    summary="Return the current locking offline session for a shop",
)
async def active_session(
    db: DbSession,
    actor: OfflineActor = Depends(_offline_or_normal_actor),
    shop_id: Annotated[int | None, Query()] = None,
) -> OfflineSessionActiveResponse:
    if actor.offline_session_id is not None:
        session = await db.get(OfflineSession, actor.offline_session_id)
        return OfflineSessionActiveResponse(session=session)
    scoped_shop_id = resolve_read_shop_id(actor.user, shop_id)
    if scoped_shop_id is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="shop_id is required")
    session = await get_active_session(db, shop_id=scoped_shop_id)
    await db.commit()
    return OfflineSessionActiveResponse(session=session)


@router.post(
    "/{session_id}/extend",
    response_model=OfflineSessionExtendResponse,
    summary="Cashier extends an active offline session once by two hours",
)
async def extend_session(
    session_id: int,
    db: DbSession,
    user: User = Depends(require_role(UserRole.CASHIER_USER)),
) -> OfflineSessionExtendResponse:
    try:
        async with unit_of_work(db):
            session, token = await extend_offline_session(
                db, session_id=session_id, actor_user_id=user.id
            )
    except OfflineSessionError as exc:
        raise map_error_to_http(
            exc,
            code_to_status=_OFFLINE_CODE_TO_STATUS,
            log_event="offline_session.extend.unmapped_error_code",
        ) from exc
    return OfflineSessionExtendResponse(session=session, offline_token=token)


@router.post(
    "/{session_id}/sync",
    response_model=OfflineSessionSyncResponse,
    summary="Sync the full offline receipt batch and create official invoices",
)
async def sync_session(
    session_id: int,
    payload: OfflineSessionSyncRequest,
    db: DbSession,
    actor: OfflineActor = Depends(_offline_or_normal_actor),
) -> OfflineSessionSyncResponse:
    if actor.offline_session_id is not None and actor.offline_session_id != session_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="offline token is for a different session")
    try:
        async with unit_of_work(db):
            result = await sync_offline_session(
                db,
                session_id=session_id,
                actor_user_id=actor.user.id,
                receipts=payload.receipts,
            )
    except CheckoutError as exc:
        await mark_sync_failed(db, session_id=session_id, code=exc.code, message=exc.message)
        raise map_error_to_http(
            exc,
            code_to_status=_CHECKOUT_SYNC_CODE_TO_STATUS,
            log_event="offline_session.sync.checkout_unmapped_error_code",
        ) from exc
    except OfflineSessionError as exc:
        if exc.code == "expired":
            await mark_session_expired(db, session_id=session_id)
        elif exc.code not in {"not_found", "bad_state", "not_session_cashier"}:
            await mark_sync_failed(db, session_id=session_id, code=exc.code, message=exc.message)
        raise map_error_to_http(
            exc,
            code_to_status=_OFFLINE_CODE_TO_STATUS,
            log_event="offline_session.sync.unmapped_error_code",
        ) from exc
    return OfflineSessionSyncResponse(
        session=result.session,
        mappings=result.mappings,
        is_replay=result.is_replay,
    )


@router.post(
    "/{session_id}/discard",
    response_model=OfflineSessionActiveResponse,
    summary="Owner or superadmin force-discards an unsynced offline session",
)
async def discard_session(
    session_id: int,
    payload: OfflineSessionDiscardRequest,
    db: DbSession,
    user: User = Depends(require_role(*_owner_roles)),
) -> OfflineSessionActiveResponse:
    try:
        async with unit_of_work(db):
            session = await discard_offline_session(
                db,
                session_id=session_id,
                actor_user_id=user.id,
                reason=payload.reason,
            )
    except OfflineSessionError as exc:
        raise map_error_to_http(
            exc,
            code_to_status=_OFFLINE_CODE_TO_STATUS,
            log_event="offline_session.discard.unmapped_error_code",
        ) from exc
    return OfflineSessionActiveResponse(session=session)
