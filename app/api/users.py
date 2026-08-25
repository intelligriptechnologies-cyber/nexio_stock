"""Current-user routes.

`GET /users/me` returns the authenticated user. Owner/superadmin can also
update their own profile and password from the same identity surface.
"""
from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession, require_role
from app.models.user import User, UserRole
from app.schemas.auth import (
    RotateTwoFactorSecretResponse,
    UserPasswordUpdate,
    UserProfileUpdate,
    UserPublic,
    UserTwoFactorPublic,
    UserTwoFactorUpdate,
)
from app.security.passwords import hash_password, verify_password
from app.services.admin_logs import write_admin_log
from app.services.two_factor import get_active_secret_for_user, rotate_user_secret

router = APIRouter(prefix="/users", tags=["users"])

_profile_roles = (UserRole.OWNER, UserRole.SUPERADMIN)


@router.get("/me", response_model=UserPublic, summary="Current user")
async def me(user: CurrentUser) -> UserPublic:
    return UserPublic.model_validate(user)


@router.patch("/me", response_model=UserPublic, summary="Update the current user's profile")
async def update_me_profile(
    payload: UserProfileUpdate,
    db: DbSession,
    user: User = Depends(require_role(*_profile_roles)),
) -> UserPublic:
    data = payload.model_dump(exclude_unset=True)

    if "phone" in data and data["phone"] is not None:
        existing = (
            await db.execute(
                select(User.id).where(User.phone == data["phone"], User.id != user.id)
            )
        ).scalar_one_or_none()
        if existing is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="phone already in use",
            )

    for field_name, value in data.items():
        setattr(user, field_name, value)

    await db.commit()
    await db.refresh(user)
    return UserPublic.model_validate(user)


@router.patch(
    "/me/password",
    response_model=UserPublic,
    summary="Change the current user's password/PIN",
)
async def change_me_password(
    payload: UserPasswordUpdate,
    db: DbSession,
    user: User = Depends(require_role(*_profile_roles)),
) -> UserPublic:
    if not verify_password(payload.current_password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="current password is incorrect",
        )

    user.password_hash = hash_password(payload.new_password)
    await db.commit()
    await db.refresh(user)
    return UserPublic.model_validate(user)


@router.get(
    "/me/two-factor",
    response_model=UserTwoFactorPublic,
    summary="Current superadmin's personal two-factor status",
)
async def get_me_two_factor(
    db: DbSession,
    user: User = Depends(require_role(UserRole.SUPERADMIN)),
) -> UserTwoFactorPublic:
    active_secret = await get_active_secret_for_user(db, user.id)
    return UserTwoFactorPublic(
        two_factor_enabled=user.two_factor_enabled,
        two_factor_secret_version=user.two_factor_secret_version,
        two_factor_rotated_at=user.two_factor_rotated_at,
        has_active_secret=active_secret is not None,
    )


@router.patch(
    "/me/two-factor",
    response_model=UserTwoFactorPublic,
    summary="Enable or disable the current superadmin's personal two-factor",
)
async def update_me_two_factor(
    payload: UserTwoFactorUpdate,
    db: DbSession,
    user: User = Depends(require_role(UserRole.SUPERADMIN)),
) -> UserTwoFactorPublic:
    active_secret = await get_active_secret_for_user(db, user.id)
    if payload.two_factor_enabled:
        if active_secret is None:
            active_secret = await rotate_user_secret(db, user=user, actor_user_id=user.id)
        user.two_factor_enabled = True
        user.two_factor_disabled_at = None
        await write_admin_log(
            db,
            event_type="auth.2fa.superadmin.enabled",
            actor_user_id=user.id,
            shop_id=None,
            payload={"target_user_id": user.id},
        )
    else:
        if not payload.current_password or not verify_password(payload.current_password, user.password_hash):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="current password is incorrect",
            )
        user.two_factor_enabled = False
        user.two_factor_disabled_at = datetime.now(UTC)
        await write_admin_log(
            db,
            event_type="auth.2fa.superadmin.disabled",
            actor_user_id=user.id,
            shop_id=None,
            payload={"target_user_id": user.id},
        )
    await db.commit()
    await db.refresh(user)
    return UserTwoFactorPublic(
        two_factor_enabled=user.two_factor_enabled,
        two_factor_secret_version=user.two_factor_secret_version,
        two_factor_rotated_at=user.two_factor_rotated_at,
        has_active_secret=active_secret is not None,
    )


@router.post(
    "/me/two-factor/secret/rotate",
    response_model=RotateTwoFactorSecretResponse,
    summary="Rotate the current superadmin's personal two-factor secret",
)
async def rotate_me_two_factor_secret(
    db: DbSession,
    user: User = Depends(require_role(UserRole.SUPERADMIN)),
) -> RotateTwoFactorSecretResponse:
    secret = await rotate_user_secret(db, user=user, actor_user_id=user.id)
    await db.commit()
    await db.refresh(user)
    return RotateTwoFactorSecretResponse(
        secret_version=secret.version,
        rotated_at=user.two_factor_rotated_at or datetime.now(UTC),
    )
