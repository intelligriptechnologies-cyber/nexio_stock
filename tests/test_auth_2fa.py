from __future__ import annotations

from datetime import UTC, datetime

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.shop import Shop
from app.models.user import User
from app.services.two_factor import (
    create_authenticator_activation_token,
    decrypt_secret,
    generate_access_key,
    get_active_secret_for_shop,
    get_active_secret_for_user,
    rotate_shop_secret,
    rotate_user_secret,
    verify_access_key,
)


async def test_generate_access_key_is_deterministic() -> None:
    secret = bytes(range(32))
    now = datetime(2026, 7, 27, 10, 0, tzinfo=UTC)

    first = generate_access_key(secret, at=now)
    second = generate_access_key(secret, at=now)

    assert first == second
    assert len(first) == 6
    assert first.isdigit()


async def test_verify_access_key_accepts_previous_window_only_within_grace() -> None:
    secret = bytes(range(32))
    previous_window = datetime(2026, 7, 27, 10, 0, tzinfo=UTC)
    submitted = generate_access_key(secret, at=previous_window)

    within_grace = datetime(2026, 7, 27, 10, 5, 10, tzinfo=UTC)
    outside_grace = datetime(2026, 7, 27, 10, 5, 45, tzinfo=UTC)

    assert verify_access_key(secret, submitted, at=within_grace) is True
    assert verify_access_key(secret, submitted, at=outside_grace) is False


async def test_shop_login_returns_two_factor_challenge_when_enabled(
    client: AsyncClient,
    db_session: AsyncSession,
    shop: Shop,
    owner: User,
    device_binding,
) -> None:
    await rotate_shop_secret(db_session, shop=shop, actor_user_id=owner.id)
    shop.two_factor_enabled = True
    await db_session.commit()

    resp = await client.post(
        "/auth/login",
        json={
            "role": "owner",
            "username": owner.username,
            "password": "ownerpass",
            "device_key": device_binding.device_key,
        },
    )

    assert resp.status_code == 202, resp.text
    body = resp.json()
    assert body["auth_status"] == "two_factor_required"
    assert body["factor_type"] == "shop_access_key"


async def test_verify_two_factor_returns_token_for_valid_shop_access_key(
    client: AsyncClient,
    db_session: AsyncSession,
    shop: Shop,
    owner: User,
    device_binding,
) -> None:
    await rotate_shop_secret(db_session, shop=shop, actor_user_id=owner.id)
    shop.two_factor_enabled = True
    await db_session.commit()

    login_resp = await client.post(
        "/auth/login",
        json={
            "role": "owner",
            "username": owner.username,
            "password": "ownerpass",
            "device_key": device_binding.device_key,
        },
    )
    assert login_resp.status_code == 202, login_resp.text
    challenge = login_resp.json()

    secret_row = await get_active_secret_for_shop(db_session, shop.id)
    assert secret_row is not None
    access_key = generate_access_key(decrypt_secret(secret_row.secret_ciphertext))

    verify_resp = await client.post(
        "/auth/verify-2fa",
        json={
            "challenge_token": challenge["challenge_token"],
            "access_key": access_key,
            "device_key": device_binding.device_key,
        },
    )

    assert verify_resp.status_code == 200, verify_resp.text
    assert "access_token" in verify_resp.json()


async def test_superadmin_login_returns_two_factor_challenge_when_enabled(
    client: AsyncClient,
    db_session: AsyncSession,
    superadmin: User,
) -> None:
    await rotate_user_secret(db_session, user=superadmin, actor_user_id=superadmin.id)
    superadmin.two_factor_enabled = True
    await db_session.commit()

    resp = await client.post(
        "/auth/login/superadmin",
        json={"username": superadmin.username, "password": "rootpass1"},
    )

    assert resp.status_code == 202, resp.text
    body = resp.json()
    assert body["auth_status"] == "two_factor_required"
    assert body["factor_type"] == "superadmin_access_key"


async def test_verify_two_factor_rejects_wrong_access_key(
    client: AsyncClient,
    db_session: AsyncSession,
    shop: Shop,
    owner: User,
    device_binding,
) -> None:
    await rotate_shop_secret(db_session, shop=shop, actor_user_id=owner.id)
    shop.two_factor_enabled = True
    await db_session.commit()

    login_resp = await client.post(
        "/auth/login",
        json={
            "role": "owner",
            "username": owner.username,
            "password": "ownerpass",
            "device_key": device_binding.device_key,
        },
    )
    assert login_resp.status_code == 202, login_resp.text
    challenge = login_resp.json()

    verify_resp = await client.post(
        "/auth/verify-2fa",
        json={
            "challenge_token": challenge["challenge_token"],
            "access_key": "000000",
            "device_key": device_binding.device_key,
        },
    )

    assert verify_resp.status_code == 401, verify_resp.text


async def test_authenticator_activation_succeeds_with_valid_token(
    client: AsyncClient,
    db_session: AsyncSession,
    shop: Shop,
    owner: User,
) -> None:
    await rotate_shop_secret(db_session, shop=shop, actor_user_id=owner.id)
    _token_row, raw_token = await create_authenticator_activation_token(
        db_session,
        shop=shop,
        actor_user_id=owner.id,
        expires_in_minutes=15,
    )
    await db_session.commit()

    resp = await client.post(
        "/auth/authenticator/activate",
        json={
            "activation_token": raw_token,
            "machine_label": "Front Counter PC",
            "machine_fingerprint": "machine-fingerprint-001",
            "app_version": "1.0.0",
        },
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["shop_name"] == shop.name
    assert body["shop_code"] == shop.code
    assert body["secret_version"] == shop.two_factor_secret_version
    assert body["step_seconds"] == 300
    assert body["secret_base32"]


async def test_authenticator_activation_rejects_reused_token(
    client: AsyncClient,
    db_session: AsyncSession,
    shop: Shop,
    owner: User,
) -> None:
    await rotate_shop_secret(db_session, shop=shop, actor_user_id=owner.id)
    _token_row, raw_token = await create_authenticator_activation_token(
        db_session,
        shop=shop,
        actor_user_id=owner.id,
        expires_in_minutes=15,
    )
    await db_session.commit()

    payload = {
        "activation_token": raw_token,
        "machine_label": "Front Counter PC",
        "machine_fingerprint": "machine-fingerprint-001",
        "app_version": "1.0.0",
    }
    first = await client.post("/auth/authenticator/activate", json=payload)
    assert first.status_code == 200, first.text

    second = await client.post("/auth/authenticator/activate", json=payload)
    assert second.status_code == 409, second.text
    assert second.json()["detail"] == "activation token has already been used"


async def test_authenticator_activation_rejects_expired_token(
    client: AsyncClient,
    db_session: AsyncSession,
    shop: Shop,
    owner: User,
) -> None:
    await rotate_shop_secret(db_session, shop=shop, actor_user_id=owner.id)
    token_row, raw_token = await create_authenticator_activation_token(
        db_session,
        shop=shop,
        actor_user_id=owner.id,
        expires_in_minutes=15,
    )
    token_row.expires_at = datetime(2026, 7, 27, 10, 0, tzinfo=UTC)
    await db_session.commit()

    resp = await client.post(
        "/auth/authenticator/activate",
        json={
            "activation_token": raw_token,
            "machine_label": "Front Counter PC",
            "machine_fingerprint": "machine-fingerprint-001",
            "app_version": "1.0.0",
        },
    )

    assert resp.status_code == 410, resp.text
    assert resp.json()["detail"] == "activation token has expired"


async def test_authenticator_activation_rejects_missing_shop_secret(
    client: AsyncClient,
    db_session: AsyncSession,
    shop: Shop,
    owner: User,
) -> None:
    await rotate_shop_secret(db_session, shop=shop, actor_user_id=owner.id)
    _token_row, raw_token = await create_authenticator_activation_token(
        db_session,
        shop=shop,
        actor_user_id=owner.id,
        expires_in_minutes=15,
    )
    await db_session.commit()

    shop.two_factor_secret_version = (shop.two_factor_secret_version or 0) + 1
    await db_session.commit()

    resp = await client.post(
        "/auth/authenticator/activate",
        json={
            "activation_token": raw_token,
            "machine_label": "Front Counter PC",
            "machine_fingerprint": "machine-fingerprint-001",
            "app_version": "1.0.0",
        },
    )

    assert resp.status_code == 409, resp.text
    assert resp.json()["detail"] == "shop two-factor secret is missing or out of date"
