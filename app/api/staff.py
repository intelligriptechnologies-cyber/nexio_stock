"""Staff management — owner-only routes for receiver_user / cashier_user
accounts (D-27, R-4, R-21).

Strictly:
  - Only owners (and superadmins) can hit these endpoints.
  - The owner can only create receiver_user or cashier_user accounts for
    their own shop. Username is unique per shop (UNIQUE(shop_id, username));
    phone is unique across *all* shops (UNIQUE(phone)) since shop login
    looks a user up by phone alone (see app.api.auth._authenticate).
  - The owner cannot create another owner — owner accounts are provisioned
    by superadmin (D-58).
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.dialects.postgresql.asyncpg import AsyncAdapt_asyncpg_dbapi
from sqlalchemy.exc import IntegrityError

from app.api._errors import is_unique_violation
from app.api.deps import DbSession, require_role, resolve_write_shop_id
from app.logging_config import get_logger
from app.models.user import User, UserRole
from app.schemas.auth import StaffCreate, StaffPasswordReset, StaffUpdate, UserPublic
from app.security.passwords import hash_password

router = APIRouter(prefix="/staff", tags=["staff"])
log = get_logger(__name__)





@router.post(
    "",
    response_model=UserPublic,
    status_code=status.HTTP_201_CREATED,
    summary="Owner creates a receiver_user or cashier_user in their own shop",
)
async def create_staff(
    payload: StaffCreate,
    db: DbSession,
    user: User = Depends(require_role(UserRole.OWNER, UserRole.SUPERADMIN)),
) -> UserPublic:
    if user.role == UserRole.OWNER and user.shop_id is None:
        # Should be impossible per deps.require_shop_scope, but defensive.
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="owner has no shop_id",
        )
    if user.role == UserRole.OWNER and payload.shop_id is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="only superadmin may specify shop_id",
        )

    actor_shop_id = await resolve_write_shop_id(db, user, payload.shop_id)
    actor_id = user.id

    new_user = User(
        shop_id=actor_shop_id,
        role=payload.role,
        username=payload.username,
        full_name=payload.full_name,
        phone=payload.phone,
        password_hash=hash_password(payload.password),
        is_active=True,
    )
    db.add(new_user)
    try:
        await db.commit()
    except (IntegrityError, AsyncAdapt_asyncpg_dbapi.IntegrityError) as exc:
        # asyncpg's UniqueViolationError surfaces as either class depending
        # on the SQLAlchemy version and code path. Map both to 409.
        if is_unique_violation(exc):
            log.info(
                "staff.created.duplicate",
                shop_id=actor_shop_id,
                username=payload.username,
                phone=payload.phone,
            )
            await db.rollback()
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "username already exists in this shop, or phone is "
                    "already registered (phone must be unique across all shops)"
                ),
            ) from exc
        raise
    await db.refresh(new_user)

    log.info(
        "staff.created",
        actor_user_id=actor_id,
        new_user_id=new_user.id,
        shop_id=actor_shop_id,
        role=new_user.role.value,
    )
    return UserPublic.model_validate(new_user)


@router.get(
    "",
    response_model=list[UserPublic],
    summary="Owner lists the staff accounts in their shop",
)
async def list_staff(
    db: DbSession,
    user: User = Depends(require_role(UserRole.OWNER, UserRole.SUPERADMIN)),
    shop_id: Annotated[
        int | None,
        Query(description="Superadmin-only: selected shop to list staff for"),
    ] = None,
) -> list[UserPublic]:
    if user.role == UserRole.OWNER:
        if shop_id is not None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="only superadmin may specify shop_id",
            )
        scoped_shop_id = user.shop_id
    else:
        if shop_id is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="superadmin must specify shop_id for this action",
            )
        scoped_shop_id = shop_id
    stmt = select(User).where(
        User.shop_id == scoped_shop_id,
        User.role.in_((UserRole.RECEIVER_USER, UserRole.CASHIER_USER)),
    )
    rows = (await db.execute(stmt.order_by(User.id))).scalars().all()
    return [UserPublic.model_validate(r) for r in rows]


async def _get_bounded_staff_user(
    db: DbSession,
    *,
    user_id: int,
    actor: User,
    shop_id: int | None = None,
) -> User:
    if actor.role == UserRole.OWNER:
        if shop_id is not None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="only superadmin may specify shop_id",
            )
        scoped_shop_id = actor.shop_id
    else:
        scoped_shop_id = shop_id

    stmt = select(User).where(
        User.id == user_id,
        User.role.in_((UserRole.RECEIVER_USER, UserRole.CASHIER_USER)),
    )
    if scoped_shop_id is not None:
        stmt = stmt.where(User.shop_id == scoped_shop_id)
    target = (await db.execute(stmt)).scalar_one_or_none()
    if target is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="staff account not found",
        )
    return target


@router.patch(
    "/{user_id}",
    response_model=UserPublic,
    summary="Owner/superadmin activates or deactivates a receiver/cashier account",
)
async def update_staff(
    user_id: int,
    payload: StaffUpdate,
    db: DbSession,
    user: User = Depends(require_role(UserRole.OWNER, UserRole.SUPERADMIN)),
    shop_id: Annotated[
        int | None,
        Query(description="Superadmin-only: selected shop to bound this update"),
    ] = None,
) -> UserPublic:
    target = await _get_bounded_staff_user(db, user_id=user_id, actor=user, shop_id=shop_id)
    target.is_active = payload.is_active
    await db.commit()
    await db.refresh(target)
    log.info(
        "staff.updated",
        actor_user_id=user.id,
        target_user_id=target.id,
        shop_id=target.shop_id,
        is_active=target.is_active,
    )
    return UserPublic.model_validate(target)


@router.patch(
    "/{user_id}/password",
    response_model=UserPublic,
    summary="Owner resets a receiver_user or cashier_user's password/PIN (issue #17)",
)
async def reset_staff_password(
    user_id: int,
    payload: StaffPasswordReset,
    db: DbSession,
    user: User = Depends(require_role(UserRole.OWNER, UserRole.SUPERADMIN)),
    shop_id: Annotated[
        int | None,
        Query(description="Superadmin-only: selected shop to bound this reset"),
    ] = None,
) -> UserPublic:
    target = await _get_bounded_staff_user(db, user_id=user_id, actor=user, shop_id=shop_id)

    target.password_hash = hash_password(payload.password)
    await db.commit()
    await db.refresh(target)

    log.info(
        "staff.password_reset",
        actor_user_id=user.id,
        target_user_id=target.id,
        shop_id=target.shop_id,
    )
    return UserPublic.model_validate(target)
