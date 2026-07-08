"""Auth routes: login for the four roles.

Login differs by role:
  - superadmin : username + password (no shop; cross-shop)
  - owner / receiver / cashier : phone + password (shop-scoped)

Returns a JWT access token + the public user record. The token carries
{ sub, shop_id, role, exp } and is verified by `app.api.deps.get_current_user`.

The staff-picker endpoint (``GET /auth/shop-staff``, issue #24, D-v2-16)
sits in this router because it's a public, pre-auth read endpoint. It
returns the one existing shop's active shop-scoped users as
``{id, full_name, role}`` only — no phone, no password hash. The
``LoginPage`` uses it to render a tap-list before the PIN pad. The
underlying ``/auth/login`` endpoint stays unchanged; the frontend
passes the picked staff member's phone through to it exactly as before.
"""
from __future__ import annotations

from fastapi import APIRouter, Body, HTTPException, status
from fastapi.exceptions import RequestValidationError
from pydantic import ValidationError
from sqlalchemy import select

from app.api.deps import DbSession
from app.config import get_settings
from app.logging_config import get_logger
from app.models.shop import Shop
from app.models.user import SHOP_SCOPED_ROLES, User, UserRole
from app.schemas.auth import (
    ShopLoginByPhone,
    ShopLoginByStaffId,
    ShopStaffMember,
    SuperAdminLoginRequest,
    TokenResponse,
    UserPublic,
)
from app.security.jwt import create_access_token
from app.security.passwords import verify_password

router = APIRouter(prefix="/auth", tags=["auth"])
log = get_logger(__name__)


async def _authenticate(
    db: DbSession,
    *,
    shop_id: int | None,
    identifier_field: str,
    identifier_value: str | int,
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
async def login_superadmin(payload: SuperAdminLoginRequest, db: DbSession) -> TokenResponse:
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
    summary="Shop login (phone + password OR staff_id + password, owner / receiver_user / cashier_user)",
)
async def login_shop(db: DbSession, raw: dict = Body(...)) -> TokenResponse:
    # Issue #24 — support both the legacy phone-path and the new
    # picker-path (staff_id). The picker doesn't return phone by design
    # (D-v2-16), so the LoginPage's second stage sends staff_id instead
    # of phone to authenticate.
    #
    # Issue #36 — which of the two shapes (ShopLoginByPhone /
    # ShopLoginByStaffId) applies is resolved here, from the raw body,
    # since that's what picks a member out of the union of untyped
    # JSON — it isn't itself the "juggle two optional siblings"
    # imperative logic this issue removes. Once resolved, the shape
    # guarantees its one identifier field non-None by construction, so
    # nothing downstream re-checks for it, and both paths route through
    # the same _authenticate helper below.
    has_phone = raw.get("phone") is not None
    has_staff_id = raw.get("staff_id") is not None
    if has_phone and has_staff_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="shop login accepts phone OR staff_id, not both",
        )
    if not has_phone and not has_staff_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="shop login requires (phone or staff_id) + password",
        )
    try:
        if has_phone:
            shape: ShopLoginByPhone | ShopLoginByStaffId = ShopLoginByPhone.model_validate(raw)
            identifier_field, identifier_value = "phone", shape.phone
        else:
            shape = ShopLoginByStaffId.model_validate(raw)
            identifier_field, identifier_value = "id", shape.staff_id
    except ValidationError as exc:
        # Field-level errors (e.g. missing password, malformed phone)
        # surface exactly as they would have for a FastAPI-bound Body
        # model — a 422 with the usual error-list shape — rather than
        # collapsing into the 400s above, which are reserved for the
        # "which shape" ambiguity that can't be expressed as a single
        # Pydantic model.
        raise RequestValidationError(exc.errors()) from exc

    user = await _authenticate(
        db,
        shop_id=None,  # phone is globally unique across all shops (UNIQUE(phone));
        # staff_id is globally unique by primary key — both lookups are
        # unambiguous without scoping to a shop. The role gate below
        # enforces that the user is a shop-scoped role (not superadmin).
        identifier_field=identifier_field,
        identifier_value=identifier_value,
        password=shape.password,
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


@router.get(
    "/shop-staff",
    response_model=list[ShopStaffMember],
    summary="Public pre-auth staff picker (issue #24, D-v2-16)",
)
async def list_shop_staff(db: DbSession) -> list[ShopStaffMember]:
    """Return the one existing shop's active shop-scoped users as
    ``{id, full_name, role}`` so the ``LoginPage`` can render a tap-list
    before any credential is entered.

    No phone, no password hash — staff-name secrecy is not the security
    boundary; PIN secrecy is (D-v2-16). Scoped to today's single shop;
    a multi-shop picker is explicitly out of scope until shop #2 is
    provisioned (D-v2-17).

    If zero shops exist, returns an empty list (the picker renders an
    empty-state rather than crashing on a fresh deployment). If multiple
    shops exist (a future ticket's setup), this endpoint picks the first
    shop by primary key — the multi-shop picker is the explicit out-of-
    scope item, so the path forward is to add a shop-selection step
    rather than overload this endpoint.
    """
    # Pick the one shop. Today there is exactly one shop (D-3); the
    # ordering by id keeps the choice stable across deployments.
    shop = (
        await db.execute(select(Shop).order_by(Shop.id.asc()).limit(1))
    ).scalar_one_or_none()
    if shop is None:
        return []
    stmt = (
        select(User)
        .where(
            User.shop_id == shop.id,
            User.role.in_(tuple(SHOP_SCOPED_ROLES)),
            User.is_active.is_(True),
        )
        .order_by(User.full_name.asc())
    )
    users = (await db.execute(stmt)).scalars().all()
    return [
        ShopStaffMember(id=u.id, full_name=u.full_name, role=u.role)
        for u in users
    ]
