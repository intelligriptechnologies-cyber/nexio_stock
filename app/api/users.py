"""Current-user routes.

`GET /users/me` returns the authenticated user. Owner/superadmin can also
update their own profile and password from the same identity surface.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession, require_role
from app.models.user import User, UserRole
from app.schemas.auth import UserPasswordUpdate, UserProfileUpdate, UserPublic
from app.security.passwords import hash_password, verify_password

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
