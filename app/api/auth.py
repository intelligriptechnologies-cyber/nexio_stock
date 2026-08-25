"""Auth routes for superadmin and shop-scoped login.

Shop login stays generic: username + password + role. Device binding and
IP allowlists still exist as data fields for compatibility, but they no
longer affect login behavior.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import JSONResponse
from sqlalchemy import select

from app.api.deps import DbSession
from app.config import get_settings
from app.logging_config import get_logger
from app.models.device import DeviceBinding
from app.models.shop import Shop
from app.models.user import SHOP_SCOPED_ROLES, User, UserRole
from app.schemas.auth import (
    AuthenticatorActivateRequest,
    AuthenticatorActivateResponse,
    ShopLoginByUsername,
    ShopStaffMember,
    SuperAdminLoginRequest,
    TokenResponse,
    TwoFactorChallengeResponse,
    UserPublic,
    VerifyTwoFactorRequest,
)
from app.security.jwt import create_access_token
from app.security.passwords import verify_password
from app.services.two_factor import (
    ActivationTokenAlreadyUsedError,
    ActivationTokenExpiredError,
    ActivationTokenNotFoundError,
    TwoFactorAccessKeyInvalidError,
    TwoFactorChallengeConsumedError,
    TwoFactorChallengeExpiredError,
    TwoFactorChallengeNotFoundError,
    TwoFactorDeviceMismatchError,
    TwoFactorProvisioningRequiredError,
    TwoFactorSubjectType,
    TwoFactorTooManyAttemptsError,
    activate_authenticator,
    create_pending_challenge,
    get_active_secret_for_shop,
    get_active_secret_for_user,
    verify_pending_challenge,
)

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
    response_model=TokenResponse | TwoFactorChallengeResponse,
    summary="Superadmin login (username + password, cross-shop)",
)
async def login_superadmin(
    payload: SuperAdminLoginRequest, db: DbSession
) -> TokenResponse | JSONResponse:
    user = await _authenticate(
        db,
        shop_id=None,
        identifier_field="username",
        identifier_value=payload.username,
        password=payload.password,
        allowed_roles=(UserRole.SUPERADMIN,),
    )
    settings = get_settings()
    if user.two_factor_enabled:
        secret = await get_active_secret_for_user(db, user.id)
        if secret is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="superadmin two-factor secret has not been provisioned",
            )
        _challenge, raw_token = await create_pending_challenge(
            db,
            user=user,
            factor_type=TwoFactorSubjectType.USER,
            secret_version=secret.version,
            factor_user_id=user.id,
        )
        await db.commit()
        response = TwoFactorChallengeResponse(
            challenge_token=raw_token,
            expires_in=settings.two_factor_challenge_ttl_seconds,
            factor_type="superadmin_access_key",
            user={"id": user.id, "role": user.role, "full_name": user.full_name},
        )
        return JSONResponse(
            content=response.model_dump(mode="json"),
            status_code=status.HTTP_202_ACCEPTED,
        )
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
    response_model=TokenResponse | TwoFactorChallengeResponse,
    summary="Shop login (username + password, owner / receiver_user / cashier_user)",
)
async def login_shop(
    db: DbSession, payload: ShopLoginByUsername
) -> TokenResponse | JSONResponse:
    user = await _authenticate(
        db,
        shop_id=None,
        identifier_field="username",
        identifier_value=payload.username,
        password=payload.password,
        allowed_roles=(payload.role,),
    )
    if user.role != payload.role:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid credentials",
        )
    shop = await db.get(Shop, user.shop_id) if user.shop_id is not None else None
    if shop is None and user.role != UserRole.SUPERADMIN:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="shop-scoped user has no shop",
        )
    settings = get_settings()
    if shop is not None and shop.two_factor_enabled:
        binding = (
            await db.execute(
                select(DeviceBinding).where(
                    DeviceBinding.shop_id == shop.id,
                    DeviceBinding.device_key == payload.device_key,
                    DeviceBinding.is_active.is_(True),
                )
            )
        ).scalar_one_or_none()
        if binding is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="this browser/device is not registered for two-factor login",
            )
        secret = await get_active_secret_for_shop(db, shop.id)
        if secret is None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="shop two-factor secret has not been provisioned",
            )
        _challenge, raw_token = await create_pending_challenge(
            db,
            user=user,
            factor_type=TwoFactorSubjectType.SHOP,
            secret_version=secret.version,
            factor_shop_id=shop.id,
            device_key=payload.device_key,
        )
        await db.commit()
        response = TwoFactorChallengeResponse(
            challenge_token=raw_token,
            expires_in=settings.two_factor_challenge_ttl_seconds,
            factor_type="shop_access_key",
            user={"id": user.id, "role": user.role, "full_name": user.full_name},
            shop={"id": shop.id, "name": shop.name, "code": shop.code},
        )
        return JSONResponse(
            content=response.model_dump(mode="json"),
            status_code=status.HTTP_202_ACCEPTED,
        )
    token = create_access_token(sub=str(user.id), shop_id=user.shop_id, role=user.role.value)
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


@router.post(
    "/verify-2fa",
    response_model=TokenResponse,
    summary="Verify a pending two-factor auth challenge and issue the final JWT",
)
async def verify_two_factor(payload: VerifyTwoFactorRequest, db: DbSession) -> TokenResponse:
    try:
        verified = await verify_pending_challenge(
            db,
            challenge_token=payload.challenge_token,
            access_key=payload.access_key,
            device_key=payload.device_key,
        )
    except TwoFactorChallengeNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="two-factor challenge not found",
        ) from exc
    except TwoFactorChallengeExpiredError as exc:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="two-factor challenge expired",
        ) from exc
    except TwoFactorChallengeConsumedError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="two-factor challenge already used",
        ) from exc
    except TwoFactorAccessKeyInvalidError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid access key",
        ) from exc
    except TwoFactorTooManyAttemptsError as exc:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="too many invalid access key attempts",
        ) from exc
    except TwoFactorDeviceMismatchError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="this browser/device does not match the pending login challenge",
        ) from exc
    except TwoFactorProvisioningRequiredError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="two-factor secret provisioning is incomplete",
        ) from exc
    settings = get_settings()
    token = create_access_token(
        sub=str(verified.user.id),
        shop_id=verified.user.shop_id,
        role=verified.user.role.value,
    )
    await db.commit()
    return TokenResponse(
        access_token=token,
        expires_in=settings.jwt_access_ttl_min * 60,
        user=UserPublic.model_validate(verified.user),
    )


@router.post(
    "/authenticator/activate",
    response_model=AuthenticatorActivateResponse,
    summary="Activate a customer Windows authenticator using a one-time token",
)
async def activate_customer_authenticator(
    payload: AuthenticatorActivateRequest, db: DbSession
) -> AuthenticatorActivateResponse:
    try:
        _activation, shop, secret_base32, secret_version = await activate_authenticator(
            db,
            activation_token=payload.activation_token,
            machine_label=payload.machine_label,
            machine_fingerprint=payload.machine_fingerprint,
        )
    except ActivationTokenNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="activation token not found",
        ) from exc
    except ActivationTokenAlreadyUsedError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="activation token has already been used",
        ) from exc
    except ActivationTokenExpiredError as exc:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="activation token has expired",
        ) from exc
    except TwoFactorProvisioningRequiredError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="shop two-factor secret is missing or out of date",
        ) from exc
    await db.commit()
    return AuthenticatorActivateResponse(
        shop_name=shop.name,
        shop_code=shop.code,
        secret_base32=secret_base32,
        secret_version=secret_version,
        step_seconds=get_settings().two_factor_step_seconds,
    )
