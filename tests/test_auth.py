"""Auth tests: login, tokens, role checks at the auth layer."""
from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.shop import Shop
from app.models.user import User, UserRole
from app.security.passwords import hash_password

TEST_DEVICE_KEY = "test-terminal-01"


@pytest.mark.usefixtures("owner", "receiver", "cashier", "superadmin")
async def test_superadmin_login_returns_token(superadmin_client: AsyncClient) -> None:
    resp = await superadmin_client.get("/users/me")
    assert resp.status_code == 200
    body = resp.json()
    assert body["role"] == "superadmin"
    assert body["shop_id"] is None


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_owner_login_with_username_returns_token(owner_client: AsyncClient) -> None:
    resp = await owner_client.get("/users/me")
    assert resp.status_code == 200
    assert resp.json()["role"] == "owner"


@pytest.mark.usefixtures("receiver")
async def test_receiver_login_with_username_returns_token(receiver_client: AsyncClient) -> None:
    resp = await receiver_client.get("/users/me")
    assert resp.status_code == 200
    assert resp.json()["role"] == "receiver_user"


@pytest.mark.usefixtures("cashier")
async def test_cashier_login_with_username_returns_token(cashier_client: AsyncClient) -> None:
    resp = await cashier_client.get("/users/me")
    assert resp.status_code == 200
    assert resp.json()["role"] == "cashier_user"


async def test_shop_login_with_wrong_password(client: AsyncClient, owner, device_binding) -> None:
    resp = await client.post(
        "/auth/login",
        json={
            "role": "owner",
            "username": owner.username,
            "password": "wrong",
            "device_key": TEST_DEVICE_KEY,
        },
    )
    assert resp.status_code == 401


async def test_superadmin_login_with_wrong_password(
    client: AsyncClient, superadmin
) -> None:
    resp = await client.post(
        "/auth/login/superadmin",
        json={"username": superadmin.username, "password": "wrong"},
    )
    assert resp.status_code == 401


async def test_missing_token_returns_401(client: AsyncClient) -> None:
    resp = await client.get("/users/me")
    assert resp.status_code == 401
    assert resp.headers.get("www-authenticate", "").lower().startswith("bearer")


async def test_invalid_token_returns_401(client: AsyncClient) -> None:
    client.headers["Authorization"] = "Bearer not.a.real.token"
    resp = await client.get("/users/me")
    assert resp.status_code == 401


async def test_wrong_role_still_rejected_for_shop_login(
    client: AsyncClient, superadmin
) -> None:
    resp = await client.post(
        "/auth/login",
        json={
            "role": "owner",
            "username": superadmin.username,
            "password": "rootpass1",
            "device_key": TEST_DEVICE_KEY,
        },
    )
    assert resp.status_code == 401


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_shop_login_ignores_device_and_ip_restrictions(
    owner: User, cashier: User, client: AsyncClient, db_session: AsyncSession
) -> None:
    shop = await db_session.get(Shop, owner.shop_id)
    assert shop is not None
    shop.cashier_login_restriction_enabled = True
    shop.allowed_login_cidrs = ["203.0.113.0/24"]
    await db_session.commit()

    owner_resp = await client.post(
        "/auth/login",
        headers={"X-Real-IP": "198.51.100.9"},
        json={
            "role": "owner",
            "username": owner.username,
            "password": "ownerpass",
            "device_key": "unbound-terminal",
        },
    )
    assert owner_resp.status_code == 200, owner_resp.text

    cashier_resp = await client.post(
        "/auth/login",
        headers={"X-Real-IP": "198.51.100.9"},
        json={
            "role": "cashier_user",
            "username": cashier.username,
            "password": "cashpass",
            "device_key": "unbound-terminal",
        },
    )
    assert cashier_resp.status_code == 200, cashier_resp.text


async def test_shop_login_requires_username_role_password_and_device_key(
    client: AsyncClient,
) -> None:
    resp = await client.post("/auth/login", json={"username": "owner1"})
    assert resp.status_code == 422


async def test_superadmin_login_requires_username_and_password(client: AsyncClient) -> None:
    resp = await client.post("/auth/login/superadmin", json={"username": "root"})
    assert resp.status_code == 422  # missing password


@pytest.mark.usefixtures("superadmin")
async def test_superadmin_username_must_be_globally_unique(
    superadmin: User, db_session: AsyncSession
) -> None:
    """Regression: username is now the primary login identifier for every role."""
    dupe = User(
        shop_id=None,
        role=UserRole.SUPERADMIN,
        username=superadmin.username,  # collision
        full_name="Impostor",
        phone="SA-impostor-0001",
        password_hash=hash_password("whatever1"),
        is_active=True,
    )
    db_session.add(dupe)
    with pytest.raises(IntegrityError):
        await db_session.flush()
    await db_session.rollback()
