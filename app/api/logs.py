"""Business log browsing and export endpoints."""
from __future__ import annotations

import csv
import io
import json
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.deps import DbSession, require_role, resolve_read_shop_id
from app.models.log import AdminLog, InvoicingLog, StockinLog
from app.models.user import User, UserRole

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
