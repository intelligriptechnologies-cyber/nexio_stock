"""JWT issuance + verification (HS256, short-lived access tokens)."""
from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from jose import JWTError, jwt

from app.config import get_settings


class TokenError(Exception):
    """Raised on bad signature, expiry, or malformed token."""


def create_access_token(
    *,
    sub: str,
    shop_id: int | None,
    role: str,
    extra: dict[str, Any] | None = None,
    ttl_minutes: int | None = None,
) -> str:
    settings = get_settings()
    ttl = ttl_minutes if ttl_minutes is not None else settings.jwt_access_ttl_min
    now = datetime.now(UTC)
    payload: dict[str, Any] = {
        "sub": sub,
        "shop_id": shop_id,
        "role": role,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=ttl)).timestamp()),
    }
    if extra:
        payload.update(extra)
    return jwt.encode(payload, settings.secret_key, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict[str, Any]:
    settings = get_settings()
    try:
        return jwt.decode(token, settings.secret_key, algorithms=[settings.jwt_algorithm])
    except JWTError as exc:
        raise TokenError(str(exc)) from exc
