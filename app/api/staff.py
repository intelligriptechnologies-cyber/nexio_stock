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

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.dialects.postgresql.asyncpg import AsyncAdapt_asyncpg_dbapi
from sqlalchemy.exc import IntegrityError

from app.api._errors import is_unique_violation
from app.api.deps import DbSession, require_role, resolve_write_shop_id
from app.logging_config import get_logger
from app.models.user import User, UserRole
from app.schemas.auth import StaffCreate, UserPublic
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
) -> list[UserPublic]:
    if user.role == UserRole.OWNER:
        stmt = select(User).where(User.shop_id == user.shop_id)
    else:
        # superadmin sees everything (R-5).
        stmt = select(User)
    rows = (await db.execute(stmt.order_by(User.id))).scalars().all()
    return [UserPublic.model_validate(r) for r in rows]
