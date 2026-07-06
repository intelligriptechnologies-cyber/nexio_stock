"""Auth routes: login for the four roles.

Login differs by role:
  - superadmin : username + password (no shop; cross-shop)
  - owner / receiver / cashier : phone + password (shop-scoped)

Returns a JWT access token + the public user record. The token carries
{ sub, shop_id, role, exp } and is verified by `app.api.deps.get_current_user`.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.api.deps import DbSession
from app.config import get_settings
from app.logging_config import get_logger
from app.models.user import User, UserRole
from app.schemas.auth import LoginRequest, TokenResponse, UserPublic
from app.security.jwt import create_access_token
from app.security.passwords import verify_password

router = APIRouter(prefix="/auth", tags=["auth"])
log = get_logger(__name__)


async def _authenticate(
    db: DbSession,
    *,
    shop_id: int | None,
    identifier_field: str,
    identifier_value: str,
    password: str,
    allowed_roles: tuple[UserRole, ...],
) -> User:
    """Look up the user by (shop_id, identifier_field) and verify password.

    We always check the password against the stored hash using a constant
    time-consuming `verify_password` to avoid timing oracles that would leak
    whether the username/phone exists.
    """
    stmt = select(User).where(
        User.is_active.is_(True),
        getattr(User, identifier_field) == identifier_value,
    )
    if shop_id is not None:
        stmt = stmt.where(User.shop_id == shop_id)

    user = (await db.execute(stmt)).scalar_one_or_none()

    # Always call verify_password to keep the response-time constant.
    # Well-formed bcrypt hash with cost 4 (cheap) and a 22-char salt.
    dummy_hash = (
        "$2b$04$" + "x" * 22 + "x" * 31
    )  # 22-char salt + 31-char hash = well-formed 60-char bcrypt hash
    if user is None:
        verify_password(password, dummy_hash)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid credentials"
        )

    if not verify_password(password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid credentials"
        )

    if user.role not in allowed_roles:
        log.info(
            "login.role_mismatch",
            user_id=user.id,
            actual_role=user.role.value,
            expected=[r.value for r in allowed_roles],
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid credentials"
        )

    return user


@router.post(
    "/login/superadmin",
    response_model=TokenResponse,
    summary="Superadmin login (username + password, cross-shop)",
)
async def login_superadmin(payload: LoginRequest, db: DbSession) -> TokenResponse:
    if not payload.username or not payload.password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="superadmin login requires username + password",
        )
    user = await _authenticate(
        db,
        shop_id=None,
        identifier_field="username",
        identifier_value=payload.username,
        password=payload.password,
        allowed_roles=(UserRole.SUPERADMIN,),
    )
    settings = get_settings()
    token = create_access_token(
        sub=str(user.id), shop_id=user.shop_id, role=user.role.value
    )
    log.info("login.superadmin", user_id=user.id)
    return TokenResponse(
        access_token=token,
        expires_in=settings.jwt_access_ttl_min * 60,
        user=UserPublic.model_validate(user),
    )


@router.post(
    "/login",
    response_model=TokenResponse,
    summary="Shop login (phone + password, owner / receiver_user / cashier_user)",
)
async def login_shop(payload: LoginRequest, db: DbSession) -> TokenResponse:
    if not payload.phone or not payload.password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="shop login requires phone + password",
        )
    user = await _authenticate(
        db,
        shop_id=None,  # phone is globally unique with a UNIQUE(shop_id, phone) constraint
        identifier_field="phone",
        identifier_value=payload.phone,
        password=payload.password,
        allowed_roles=(UserRole.OWNER, UserRole.RECEIVER_USER, UserRole.CASHIER_USER),
    )
    settings = get_settings()
    token = create_access_token(
        sub=str(user.id), shop_id=user.shop_id, role=user.role.value
    )
    log.info("login.shop", user_id=user.id, role=user.role.value)
    return TokenResponse(
        access_token=token,
        expires_in=settings.jwt_access_ttl_min * 60,
        user=UserPublic.model_validate(user),
    )
