"""FastAPI dependencies: db session, current user, role guards.

Role enforcement is server-side, not hidden in the UI (R-21, D-25). The
`require_role(*allowed)` dependency returns the authenticated user, or
raises 401 (missing/invalid token) / 403 (role not allowed) — never silently
admits a wrong-role request.
"""
from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models.shop import Shop
from app.models.user import SHOP_SCOPED_ROLES, User, UserRole
from app.security.jwt import TokenError, decode_access_token

# auto_error=False so we can return our own 401 with a consistent body.
_bearer = HTTPBearer(auto_error=False)


async def db_session() -> AsyncIterator[AsyncSession]:
    async for s in get_db():
        yield s


DbSession = Annotated[AsyncSession, Depends(db_session)]


async def get_current_user(
    db: DbSession,
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> User:
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

    user_id = int(claims["sub"])
    user = await db.get(User, user_id)
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="user not found or inactive",
        )
    # Make sure all attributes are loaded before the session closes —
    # otherwise accessing a relationship or expired column on the returned
    # User object triggers a lazy load on a closed session.
    await db.refresh(user)
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_role(*allowed: UserRole):
    """Dependency factory. Returns 403 if the current user's role isn't in
    `allowed`. The 401 path is handled by `get_current_user` first."""

    async def _guard(user: CurrentUser) -> User:
        if user.role not in allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    f"role '{user.role.value}' is not permitted on this endpoint; "
                    f"requires one of: {sorted(r.value for r in allowed)}"
                ),
            )
        return user

    return _guard


async def resolve_write_shop_id(
    db: AsyncSession, user: User, requested_shop_id: int | None
) -> int:
    """Resolve which shop a write action targets (D-64/D-65).

    Owner/receiver/cashier always write to their own shop — a
    `requested_shop_id` from them is rejected rather than silently
    ignored, since silently accepting-but-ignoring it would mask a client
    bug. Superadmin has no shop_id of its own (D-3), so it must name the
    target shop explicitly; the shop must exist.
    """
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

    if requested_shop_id is not None and requested_shop_id != user.shop_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="only superadmin may specify shop_id",
        )
    assert user.shop_id is not None
    return user.shop_id


def resolve_read_shop_id(user: User, requested_shop_id: int | None) -> int | None:
    """Resolve the shop scope for a read action (D-66).

    Non-superadmin is pinned to its own shop — a `requested_shop_id`
    that doesn't match is rejected (400) rather than silently ignored,
    same as `resolve_write_shop_id`. Superadmin may optionally narrow
    to one shop via the acting-shop picker; unlike the write-side rule,
    omitting it is valid and means "no scope filter" (browse every
    shop), since a read has no shop-less state to reject.

    Returns `None` only for the superadmin-unscoped case; every other
    caller gets a concrete shop_id back.
    """
    if user.role != UserRole.SUPERADMIN:
        if requested_shop_id is not None and requested_shop_id != user.shop_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="only superadmin may specify shop_id",
            )
        assert user.shop_id is not None
        return user.shop_id
    return requested_shop_id


def require_shop_scope(user: User) -> None:
    """Defensive check for non-superadmin endpoints — the user must have a
    shop_id. (Superadmin is allowed to be shop-less.)"""
    if user.role in SHOP_SCOPED_ROLES and user.shop_id is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="shop-scoped user has no shop_id — data integrity violation",
        )
