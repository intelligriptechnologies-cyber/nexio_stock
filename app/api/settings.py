"""Per-shop app settings routes."""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import DbSession, require_role
from app.logging_config import get_logger
from app.models.shop import Shop
from app.models.user import User, UserRole
from app.schemas.settings import SettingsPublic, SettingsUpdate

router = APIRouter(prefix="/settings", tags=["settings"])
log = get_logger(__name__)

_settings_roles = (UserRole.OWNER, UserRole.SUPERADMIN)


async def _resolve_settings_shop_id(
    db: AsyncSession, user: User, requested_shop_id: int | None
) -> int:
    if user.role == UserRole.SUPERADMIN:
        if requested_shop_id is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="superadmin must specify shop_id for this action",
            )
        shop = await db.get(Shop, requested_shop_id)
        if shop is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"shop {requested_shop_id} not found",
            )
        return requested_shop_id

    if requested_shop_id is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="owner must not specify shop_id",
        )
    assert user.shop_id is not None
    return user.shop_id


@router.get(
    "/me",
    response_model=SettingsPublic,
    summary="Get the current shop's owner-editable settings",
)
async def get_my_settings(
    db: DbSession,
    user: User = Depends(require_role(*_settings_roles)),
    shop_id: Annotated[int | None, Query(description="Superadmin-only target shop")] = None,
) -> SettingsPublic:
    shop_id = await _resolve_settings_shop_id(db, user, shop_id)
    shop = (await db.execute(select(Shop).where(Shop.id == shop_id))).scalar_one()
    return SettingsPublic.model_validate(shop)


@router.patch(
    "/me",
    response_model=SettingsPublic,
    summary="Update the current shop's owner-editable settings",
)
async def update_my_settings(
    payload: SettingsUpdate,
    db: DbSession,
    user: User = Depends(require_role(*_settings_roles)),
) -> SettingsPublic:
    actor_id = user.id
    shop_id = await _resolve_settings_shop_id(db, user, payload.shop_id)
    shop = (await db.execute(select(Shop).where(Shop.id == shop_id))).scalar_one()

    data = payload.model_dump(exclude_unset=True, exclude={"shop_id"})
    password = data.pop("smtp_password", None)
    if isinstance(password, str) and password.strip():
        shop.smtp_password = password

    for field_name, value in data.items():
        setattr(shop, field_name, value)

    await db.commit()
    await db.refresh(shop)

    changed_fields = sorted([*data.keys(), *(["smtp_password"] if password else [])])
    log.info(
        "settings.updated",
        actor_user_id=actor_id,
        shop_id=shop_id,
        changed_fields=changed_fields,
    )
    return SettingsPublic.model_validate(shop)
