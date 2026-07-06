"""Current-user route — `GET /users/me` returns the authenticated user.

Used by the frontend on app boot to figure out which screen to show
(owner / receiver / cashier / superadmin). Also useful in tests.
"""
from __future__ import annotations

from fastapi import APIRouter

from app.api.deps import CurrentUser
from app.schemas.auth import UserPublic

router = APIRouter(prefix="/users", tags=["users"])


@router.get("/me", response_model=UserPublic, summary="Current user")
async def me(user: CurrentUser) -> UserPublic:
    return UserPublic.model_validate(user)
