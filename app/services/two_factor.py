"""Two-factor auth services: secret handling, access keys, and challenges."""
from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from cryptography.fernet import Fernet
from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.shop import Shop
from app.models.two_factor import (
    AuthenticatorActivation,
    AuthenticatorActivationToken,
    PendingAuthChallenge,
    TwoFactorSecret,
    TwoFactorSubjectType,
)
from app.models.user import User
from app.services.admin_logs import write_admin_log

SHOP_2FA_REQUIRED_ROLES = ["owner", "cashier_user", "receiver_user"]


class TwoFactorError(Exception):
    pass


class TwoFactorChallengeNotFoundError(TwoFactorError):
    pass


class TwoFactorChallengeExpiredError(TwoFactorError):
    pass


class TwoFactorChallengeConsumedError(TwoFactorError):
    pass


class TwoFactorAccessKeyInvalidError(TwoFactorError):
    pass


class TwoFactorTooManyAttemptsError(TwoFactorError):
    pass


class TwoFactorDeviceMismatchError(TwoFactorError):
    pass


class TwoFactorProvisioningRequiredError(TwoFactorError):
    pass


class ActivationTokenNotFoundError(TwoFactorError):
    pass


class ActivationTokenExpiredError(TwoFactorError):
    pass


class ActivationTokenAlreadyUsedError(TwoFactorError):
    pass


@dataclass
class VerifiedTwoFactorChallenge:
    challenge: PendingAuthChallenge
    user: User


def _now() -> datetime:
    return datetime.now(UTC)


def _sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _fernet() -> Fernet:
    settings = get_settings()
    source = settings.two_factor_secret_encryption_key or settings.secret_key
    key = base64.urlsafe_b64encode(hashlib.sha256(source.encode("utf-8")).digest())
    return Fernet(key)


def encrypt_secret(secret_bytes: bytes) -> str:
    return _fernet().encrypt(secret_bytes).decode("utf-8")


def decrypt_secret(ciphertext: str) -> bytes:
    return _fernet().decrypt(ciphertext.encode("utf-8"))


def generate_random_secret() -> bytes:
    return secrets.token_bytes(32)


def generate_access_key(secret_bytes: bytes, *, at: datetime | None = None) -> str:
    now = at or _now()
    step_seconds = get_settings().two_factor_step_seconds
    counter = int(now.timestamp()) // step_seconds
    counter_bytes = counter.to_bytes(8, "big", signed=False)
    digest = hmac.new(secret_bytes, counter_bytes, hashlib.sha256).digest()
    offset = digest[-1] & 0x0F
    binary = int.from_bytes(digest[offset : offset + 4], "big") & 0x7FFFFFFF
    return f"{binary % 1_000_000:06d}"


def verify_access_key(secret_bytes: bytes, submitted_code: str, *, at: datetime | None = None) -> bool:
    if len(submitted_code) != 6 or not submitted_code.isdigit():
        return False
    now = at or _now()
    settings = get_settings()
    step_seconds = settings.two_factor_step_seconds
    grace_seconds = settings.two_factor_grace_seconds
    current_counter = int(now.timestamp()) // step_seconds
    counters = [current_counter]
    if int(now.timestamp()) % step_seconds < grace_seconds:
        counters.append(current_counter - 1)
    for counter in counters:
        candidate_at = datetime.fromtimestamp(counter * step_seconds, tz=UTC)
        candidate = generate_access_key(secret_bytes, at=candidate_at)
        if secrets.compare_digest(candidate, submitted_code):
            return True
    return False


async def get_active_secret_for_shop(db: AsyncSession, shop_id: int) -> TwoFactorSecret | None:
    return (
        await db.execute(
            select(TwoFactorSecret).where(
                TwoFactorSecret.subject_type == TwoFactorSubjectType.SHOP,
                TwoFactorSecret.shop_id == shop_id,
                TwoFactorSecret.is_active.is_(True),
            )
        )
    ).scalar_one_or_none()


async def get_active_secret_for_user(db: AsyncSession, user_id: int) -> TwoFactorSecret | None:
    return (
        await db.execute(
            select(TwoFactorSecret).where(
                TwoFactorSecret.subject_type == TwoFactorSubjectType.USER,
                TwoFactorSecret.user_id == user_id,
                TwoFactorSecret.is_active.is_(True),
            )
        )
    ).scalar_one_or_none()


async def _next_secret_version(
    db: AsyncSession, *, subject_type: TwoFactorSubjectType, shop_id: int | None, user_id: int | None
) -> int:
    stmt: Select[tuple[TwoFactorSecret]] = select(TwoFactorSecret).where(
        TwoFactorSecret.subject_type == subject_type
    )
    if shop_id is not None:
        stmt = stmt.where(TwoFactorSecret.shop_id == shop_id)
    if user_id is not None:
        stmt = stmt.where(TwoFactorSecret.user_id == user_id)
    rows = (await db.execute(stmt)).scalars().all()
    return (max((row.version for row in rows), default=0) + 1)


async def rotate_shop_secret(db: AsyncSession, *, shop: Shop, actor_user_id: int) -> TwoFactorSecret:
    current = await get_active_secret_for_shop(db, shop.id)
    if current is not None:
        current.is_active = False
        current.retired_at = _now()
    version = await _next_secret_version(
        db, subject_type=TwoFactorSubjectType.SHOP, shop_id=shop.id, user_id=None
    )
    secret = TwoFactorSecret(
        subject_type=TwoFactorSubjectType.SHOP,
        shop_id=shop.id,
        version=version,
        secret_ciphertext=encrypt_secret(generate_random_secret()),
        is_active=True,
        created_by_user_id=actor_user_id,
    )
    db.add(secret)
    shop.two_factor_secret_version = version
    shop.two_factor_rotated_at = _now()
    await expire_pending_challenges(
        db,
        subject_type=TwoFactorSubjectType.SHOP,
        shop_id=shop.id,
        user_id=None,
    )
    await write_admin_log(
        db,
        event_type="auth.2fa.shop.secret_rotated" if current is not None else "auth.2fa.shop.secret_generated",
        actor_user_id=actor_user_id,
        shop_id=shop.id,
        payload={"shop_id": shop.id, "secret_version": version},
    )
    return secret


async def rotate_user_secret(db: AsyncSession, *, user: User, actor_user_id: int) -> TwoFactorSecret:
    current = await get_active_secret_for_user(db, user.id)
    if current is not None:
        current.is_active = False
        current.retired_at = _now()
    version = await _next_secret_version(
        db, subject_type=TwoFactorSubjectType.USER, shop_id=None, user_id=user.id
    )
    secret = TwoFactorSecret(
        subject_type=TwoFactorSubjectType.USER,
        user_id=user.id,
        version=version,
        secret_ciphertext=encrypt_secret(generate_random_secret()),
        is_active=True,
        created_by_user_id=actor_user_id,
    )
    db.add(secret)
    user.two_factor_secret_version = version
    user.two_factor_rotated_at = _now()
    await expire_pending_challenges(
        db,
        subject_type=TwoFactorSubjectType.USER,
        shop_id=None,
        user_id=user.id,
    )
    await write_admin_log(
        db,
        event_type="auth.2fa.superadmin.secret_rotated",
        actor_user_id=actor_user_id,
        shop_id=None,
        payload={"target_user_id": user.id, "secret_version": version},
    )
    return secret


async def expire_pending_challenges(
    db: AsyncSession,
    *,
    subject_type: TwoFactorSubjectType,
    shop_id: int | None,
    user_id: int | None,
) -> None:
    stmt = select(PendingAuthChallenge).where(
        PendingAuthChallenge.factor_subject_type == subject_type,
        PendingAuthChallenge.consumed_at.is_(None),
        PendingAuthChallenge.expires_at > _now(),
    )
    if shop_id is not None:
        stmt = stmt.where(PendingAuthChallenge.factor_shop_id == shop_id)
    if user_id is not None:
        stmt = stmt.where(PendingAuthChallenge.factor_user_id == user_id)
    rows = (await db.execute(stmt)).scalars().all()
    for row in rows:
        row.expires_at = _now()


async def create_pending_challenge(
    db: AsyncSession,
    *,
    user: User,
    factor_type: TwoFactorSubjectType,
    secret_version: int,
    factor_shop_id: int | None = None,
    factor_user_id: int | None = None,
    device_key: str | None = None,
) -> tuple[PendingAuthChallenge, str]:
    raw_token = secrets.token_urlsafe(32)
    challenge = PendingAuthChallenge(
        challenge_token_hash=_sha256_hex(raw_token),
        user_id=user.id,
        shop_id=user.shop_id,
        factor_subject_type=factor_type,
        factor_shop_id=factor_shop_id,
        factor_user_id=factor_user_id,
        factor_secret_version=secret_version,
        device_key_hash=_sha256_hex(device_key) if device_key is not None else None,
        expires_at=_now() + timedelta(seconds=get_settings().two_factor_challenge_ttl_seconds),
    )
    db.add(challenge)
    await db.flush()
    await write_admin_log(
        db,
        event_type="auth.2fa.challenge_created",
        actor_user_id=user.id,
        shop_id=user.shop_id,
        payload={
            "user_id": user.id,
            "challenge_id": str(challenge.id),
            "factor_type": factor_type.value,
            "factor_secret_version": secret_version,
        },
    )
    return challenge, raw_token


async def verify_pending_challenge(
    db: AsyncSession,
    *,
    challenge_token: str,
    access_key: str,
    device_key: str | None,
) -> VerifiedTwoFactorChallenge:
    challenge = (
        await db.execute(
            select(PendingAuthChallenge).where(
                PendingAuthChallenge.challenge_token_hash == _sha256_hex(challenge_token)
            )
        )
    ).scalar_one_or_none()
    if challenge is None:
        raise TwoFactorChallengeNotFoundError()
    if challenge.consumed_at is not None:
        raise TwoFactorChallengeConsumedError()
    if challenge.expires_at <= _now():
        await write_admin_log(
            db,
            event_type="auth.2fa.challenge_expired",
            actor_user_id=challenge.user_id,
            shop_id=challenge.shop_id,
            payload={"challenge_id": str(challenge.id)},
        )
        raise TwoFactorChallengeExpiredError()
    if challenge.failed_attempts >= get_settings().two_factor_max_attempts:
        raise TwoFactorTooManyAttemptsError()
    if challenge.device_key_hash is not None and (
        device_key is None or _sha256_hex(device_key) != challenge.device_key_hash
    ):
        await write_admin_log(
            db,
            event_type="auth.2fa.challenge_blocked_device",
            actor_user_id=challenge.user_id,
            shop_id=challenge.shop_id,
            payload={"challenge_id": str(challenge.id)},
        )
        raise TwoFactorDeviceMismatchError()

    if challenge.factor_subject_type == TwoFactorSubjectType.SHOP:
        secret_row = await get_active_secret_for_shop(db, challenge.factor_shop_id or 0)
    else:
        secret_row = await get_active_secret_for_user(db, challenge.factor_user_id or 0)
    if secret_row is None or secret_row.version != challenge.factor_secret_version:
        raise TwoFactorChallengeExpiredError()

    secret_bytes = decrypt_secret(secret_row.secret_ciphertext)
    if not verify_access_key(secret_bytes, access_key):
        challenge.failed_attempts += 1
        challenge.last_failed_at = _now()
        await write_admin_log(
            db,
            event_type="auth.2fa.challenge_failed",
            actor_user_id=challenge.user_id,
            shop_id=challenge.shop_id,
            payload={
                "challenge_id": str(challenge.id),
                "failed_attempts": challenge.failed_attempts,
            },
        )
        if challenge.failed_attempts >= get_settings().two_factor_max_attempts:
            raise TwoFactorTooManyAttemptsError()
        raise TwoFactorAccessKeyInvalidError()

    challenge.consumed_at = _now()
    user = await db.get(User, challenge.user_id)
    assert user is not None
    await write_admin_log(
        db,
        event_type="auth.2fa.challenge_verified",
        actor_user_id=challenge.user_id,
        shop_id=challenge.shop_id,
        payload={"challenge_id": str(challenge.id)},
    )
    return VerifiedTwoFactorChallenge(challenge=challenge, user=user)


async def create_authenticator_activation_token(
    db: AsyncSession,
    *,
    shop: Shop,
    actor_user_id: int,
    expires_in_minutes: int,
) -> tuple[AuthenticatorActivationToken, str]:
    if shop.two_factor_secret_version is None:
        raise TwoFactorProvisioningRequiredError()
    raw_token = secrets.token_urlsafe(32)
    token = AuthenticatorActivationToken(
        token_hash=_sha256_hex(raw_token),
        shop_id=shop.id,
        secret_version=shop.two_factor_secret_version,
        expires_at=_now() + timedelta(minutes=expires_in_minutes),
        created_by_user_id=actor_user_id,
    )
    db.add(token)
    await db.flush()
    return token, raw_token


async def activate_authenticator(
    db: AsyncSession,
    *,
    activation_token: str,
    machine_label: str | None,
    machine_fingerprint: str,
) -> tuple[AuthenticatorActivation, Shop, str, int]:
    token_row = (
        await db.execute(
            select(AuthenticatorActivationToken).where(
                AuthenticatorActivationToken.token_hash == _sha256_hex(activation_token)
            )
        )
    ).scalar_one_or_none()
    if token_row is None:
        raise ActivationTokenNotFoundError()
    if token_row.consumed_at is not None:
        raise ActivationTokenAlreadyUsedError()
    if token_row.expires_at <= _now():
        raise ActivationTokenExpiredError()
    shop = await db.get(Shop, token_row.shop_id)
    if shop is None or shop.two_factor_secret_version != token_row.secret_version:
        raise TwoFactorProvisioningRequiredError()
    secret_row = await get_active_secret_for_shop(db, shop.id)
    if secret_row is None:
        raise TwoFactorProvisioningRequiredError()
    token_row.consumed_at = _now()
    activation = AuthenticatorActivation(
        shop_id=shop.id,
        secret_version=token_row.secret_version,
        machine_label=machine_label,
        machine_fingerprint_hash=_sha256_hex(machine_fingerprint),
        is_active=True,
        activated_by_user_id=token_row.created_by_user_id,
    )
    db.add(activation)
    await db.flush()
    await write_admin_log(
        db,
        event_type="auth.2fa.authenticator.activated",
        actor_user_id=token_row.created_by_user_id,
        shop_id=shop.id,
        payload={
            "shop_id": shop.id,
            "secret_version": token_row.secret_version,
            "activation_id": activation.id,
        },
    )
    secret_bytes = decrypt_secret(secret_row.secret_ciphertext)
    secret_base32 = base64.b32encode(secret_bytes).decode("ascii")
    return activation, shop, secret_base32, token_row.secret_version
