"""Helpers for append-only admin log events."""
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.log import AdminLog


async def write_admin_log(
    db: AsyncSession,
    *,
    event_type: str,
    actor_user_id: int | None,
    shop_id: int | None,
    payload: dict,
) -> None:
    db.add(
        AdminLog(
            event_type=event_type,
            actor_user_id=actor_user_id,
            shop_id=shop_id,
            payload=payload,
        )
    )
