"""Business log browsing and export endpoints."""
from __future__ import annotations

import csv
import io
import json
from datetime import date, datetime
from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.deps import DbSession, require_role, resolve_read_shop_id
from app.models.log import AdminLog, InvoicingLog, StockinLog
from app.models.user import User, UserRole
from app.services.log_files import (
    LogFileType,
    cleanup_all_expired_files,
    cleanup_expired_files,
    get_retention_days,
    list_log_files,
    resolve_download_path,
    set_retention_days,
)

router = APIRouter(prefix="/logs", tags=["logs"])

_owner_only = (UserRole.OWNER, UserRole.SUPERADMIN)
_LOG_TYPES = {
    "invoicing": InvoicingLog,
    "stockin": StockinLog,
    "admin": AdminLog,
}


class BusinessLogRow(BaseModel):
    id: int
    created_at: datetime
    shop_id: int | None
    shop_name: str | None
    actor_user_id: int | None
    actor_name: str | None
    event_type: str
    payload: dict


class BusinessLogResponse(BaseModel):
    logs: list[BusinessLogRow]


class LogFileRow(BaseModel):
    filename: str
    relative_path: str
    size_bytes: int
    modified_at: datetime
    file_date: date
    age_days: int
    expires_in_days: int


class LogFileListResponse(BaseModel):
    log_type: LogFileType
    retention_days: int
    files: list[LogFileRow]


class RetentionUpdateRequest(BaseModel):
    retention_days: int


class RetentionResponse(BaseModel):
    log_type: LogFileType
    retention_days: int


def _row_to_public(row) -> BusinessLogRow:
    return BusinessLogRow(
        id=row.id,
        created_at=row.created_at,
        shop_id=row.shop_id,
        shop_name=row.shop.name if row.shop is not None else None,
        actor_user_id=row.actor_user_id,
        actor_name=row.actor_user.full_name if row.actor_user is not None else None,
        event_type=row.event_type,
        payload=row.payload,
    )


def _ensure_file_log_access(log_type: LogFileType, user: User) -> None:
    if log_type == "exceptions" and user.role != UserRole.SUPERADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="exception logs are superadmin-only",
        )


def _file_row_to_public(row) -> LogFileRow:
    return LogFileRow(
        filename=row.filename,
        relative_path=row.relative_path,
        size_bytes=row.size_bytes,
        modified_at=row.modified_at,
        file_date=row.file_date,
        age_days=row.age_days,
        expires_in_days=row.expires_in_days,
    )


async def _resolve_file_scope(
    *,
    db,
    user: User,
    log_type: LogFileType,
    shop_id: int | None,
    require_shop_for_non_exception: bool = False,
) -> int | None:
    if user.role == UserRole.SUPERADMIN and shop_id is not None:
        from app.models.shop import Shop

        shop = await db.get(Shop, shop_id)
        if shop is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="shop not found")
    scoped_shop_id = resolve_read_shop_id(user, shop_id)
    if require_shop_for_non_exception and log_type != "exceptions" and scoped_shop_id is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="shop_id is required")
    return scoped_shop_id


@router.get("/files/{log_type}", response_model=LogFileListResponse)
async def list_log_files_endpoint(
    log_type: LogFileType,
    db: DbSession,
    _user: User = Depends(require_role(*_owner_only)),
    shop_id: Annotated[int | None, Query(description="Superadmin only")] = None,
) -> LogFileListResponse:
    _ensure_file_log_access(log_type, _user)
    scoped_shop_id = await _resolve_file_scope(
        db=db,
        user=_user,
        log_type=log_type,
        shop_id=shop_id,
    )
    include_all = _user.role == UserRole.SUPERADMIN and scoped_shop_id is None
    retention_scope = scoped_shop_id
    retention_days = await get_retention_days(db, log_type=log_type, shop_id=retention_scope)
    if include_all:
        cleanup_all_expired_files(log_type, retention_days=retention_days)
    else:
        cleanup_expired_files(log_type, shop_id=scoped_shop_id, retention_days=retention_days)
    return LogFileListResponse(
        log_type=log_type,
        retention_days=retention_days,
        files=[
            _file_row_to_public(row)
            for row in list_log_files(
                log_type,
                shop_id=scoped_shop_id,
                retention_days=retention_days,
                include_all_scopes=include_all,
            )
        ],
    )


@router.get("/files/{log_type}/{filename}/download")
async def download_log_file_endpoint(
    log_type: LogFileType,
    filename: str,
    db: DbSession,
    _user: User = Depends(require_role(*_owner_only)),
    shop_id: Annotated[int | None, Query(description="Superadmin only")] = None,
) -> FileResponse:
    _ensure_file_log_access(log_type, _user)
    scoped_shop_id = await _resolve_file_scope(
        db=db,
        user=_user,
        log_type=log_type,
        shop_id=shop_id,
    )
    include_all = _user.role == UserRole.SUPERADMIN and scoped_shop_id is None
    retention_days = await get_retention_days(db, log_type=log_type, shop_id=scoped_shop_id)
    if include_all:
        cleanup_all_expired_files(log_type, retention_days=retention_days)
    else:
        cleanup_expired_files(log_type, shop_id=scoped_shop_id, retention_days=retention_days)
    path = resolve_download_path(
        log_type,
        filename=filename,
        shop_id=scoped_shop_id,
        include_all_scopes=include_all,
    )
    if path is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="log file not found")
    media_type = "text/csv" if Path(filename).suffix == ".csv" else "text/plain"
    return FileResponse(path, media_type=media_type, filename=filename)


@router.patch("/files/{log_type}/retention", response_model=RetentionResponse)
async def update_log_file_retention_endpoint(
    log_type: LogFileType,
    payload: RetentionUpdateRequest,
    db: DbSession,
    _user: User = Depends(require_role(*_owner_only)),
    shop_id: Annotated[int | None, Query(description="Superadmin only")] = None,
) -> RetentionResponse:
    _ensure_file_log_access(log_type, _user)
    if payload.retention_days < 1 or payload.retention_days > 3650:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="retention_days must be between 1 and 3650",
        )
    scoped_shop_id = await _resolve_file_scope(
        db=db,
        user=_user,
        log_type=log_type,
        shop_id=shop_id,
        require_shop_for_non_exception=True,
    )
    retention_days = await set_retention_days(
        db,
        log_type=log_type,
        shop_id=scoped_shop_id,
        retention_days=payload.retention_days,
    )
    cleanup_expired_files(log_type, shop_id=scoped_shop_id, retention_days=retention_days)
    return RetentionResponse(log_type=log_type, retention_days=retention_days)


async def _query_logs(
    db,
    *,
    log_type: str,
    actor: User,
    shop_id: int | None,
    user_id: int | None,
    event_type: str | None,
    date_from: datetime | None,
    date_to: datetime | None,
    limit: int,
    offset: int,
) -> list[BusinessLogRow]:
    log_cls = _LOG_TYPES[log_type]
    scoped_shop_id = resolve_read_shop_id(actor, shop_id)
    stmt = select(log_cls).options(selectinload(log_cls.shop), selectinload(log_cls.actor_user))
    if scoped_shop_id is not None:
        stmt = stmt.where(log_cls.shop_id == scoped_shop_id)
    if user_id is not None:
        stmt = stmt.where(log_cls.actor_user_id == user_id)
    if event_type:
        stmt = stmt.where(log_cls.event_type == event_type)
    if date_from is not None:
        stmt = stmt.where(log_cls.created_at >= date_from)
    if date_to is not None:
        stmt = stmt.where(log_cls.created_at <= date_to)
    stmt = stmt.order_by(log_cls.created_at.desc()).limit(limit).offset(offset)
    return [_row_to_public(row) for row in (await db.execute(stmt)).scalars().all()]


async def _list_logs_handler(
    log_type: str,
    db: DbSession,
    user: User,
    shop_id: int | None,
    user_id: int | None,
    event_type: str | None,
    date_from: datetime | None,
    date_to: datetime | None,
    limit: int,
    offset: int,
) -> BusinessLogResponse:
    return BusinessLogResponse(
        logs=await _query_logs(
            db,
            log_type=log_type,
            actor=user,
            shop_id=shop_id,
            user_id=user_id,
            event_type=event_type,
            date_from=date_from,
            date_to=date_to,
            limit=limit,
            offset=offset,
        )
    )


@router.get("/{log_type}", response_model=BusinessLogResponse)
async def list_logs(
    log_type: Literal["invoicing", "stockin", "admin"],
    db: DbSession,
    _user: User = Depends(require_role(*_owner_only)),
    shop_id: Annotated[int | None, Query(description="Superadmin only")] = None,
    user_id: Annotated[int | None, Query()] = None,
    event_type: Annotated[str | None, Query()] = None,
    date_from: Annotated[datetime | None, Query()] = None,
    date_to: Annotated[datetime | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=1000)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> BusinessLogResponse:
    return await _list_logs_handler(
        log_type,
        db,
        _user,
        shop_id,
        user_id,
        event_type,
        date_from,
        date_to,
        limit,
        offset,
    )


@router.get("/{log_type}/export")
async def export_logs(
    log_type: Literal["invoicing", "stockin", "admin"],
    db: DbSession,
    _user: User = Depends(require_role(*_owner_only)),
    format: Annotated[Literal["json", "csv", "txt"], Query()] = "json",
    shop_id: Annotated[int | None, Query(description="Superadmin only")] = None,
    user_id: Annotated[int | None, Query()] = None,
    event_type: Annotated[str | None, Query()] = None,
    date_from: Annotated[datetime | None, Query()] = None,
    date_to: Annotated[datetime | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=1000)] = 1000,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> Response:
    rows = await _query_logs(
        db,
        log_type=log_type,
        actor=_user,
        shop_id=shop_id,
        user_id=user_id,
        event_type=event_type,
        date_from=date_from,
        date_to=date_to,
        limit=limit,
        offset=offset,
    )
    data = [row.model_dump(mode="json") for row in rows]
    if format == "json":
        return Response(
            content=json.dumps(data, indent=2),
            media_type="application/json",
        )
    if format == "csv":
        out = io.StringIO()
        writer = csv.DictWriter(
            out,
            fieldnames=[
                "id",
                "created_at",
                "shop_id",
                "shop_name",
                "actor_user_id",
                "actor_name",
                "event_type",
                "payload",
            ],
        )
        writer.writeheader()
        for row in data:
            row = dict(row)
            row["payload"] = json.dumps(row["payload"], sort_keys=True)
            writer.writerow(row)
        return Response(content=out.getvalue(), media_type="text/csv")

    lines = []
    for row in data:
        lines.append(
            f"[{row['created_at']}] {row['event_type']} "
            f"shop={row['shop_name'] or row['shop_id']} "
            f"actor={row['actor_name'] or row['actor_user_id']}\n"
            f"{json.dumps(row['payload'], sort_keys=True)}"
        )
    return Response(content="\n\n".join(lines), media_type="text/plain")
