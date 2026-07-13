"""Auth tests for device-bound shop login."""
from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.shop import Shop

TEST_DEVICE_KEY = "test-terminal-01"


@pytest.mark.usefixtures("owner", "receiver", "cashier", "device_binding", "superadmin")
async def test_device_context_reports_registered_device(client: AsyncClient) -> None:
    resp = await client.get(f"/auth/device-context?device_key={TEST_DEVICE_KEY}")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["device_key"] == TEST_DEVICE_KEY
    assert body["is_registered"] is True
    assert body["can_login"] is True
    assert body["shop_name"] == "Shop One"
    assert body["shop_code"] == "shop1"
    assert body["counter_name"] == "Front counter"


@pytest.mark.usefixtures("owner", "receiver", "cashier", "superadmin")
async def test_device_context_reports_unregistered_device(client: AsyncClient) -> None:
    resp = await client.get("/auth/device-context?device_key=unregistered-01")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["is_registered"] is False
    assert body["can_login"] is False
    assert "not registered" in body["message"].lower()


@pytest.mark.usefixtures("owner", "receiver", "cashier", "device_binding", "superadmin")
async def test_shop_login_uses_username_role_and_device_key(
    client: AsyncClient, owner
) -> None:
    resp = await client.post(
        "/auth/login",
        json={
            "role": "owner",
            "username": owner.username,
            "password": "ownerpass",
            "device_key": TEST_DEVICE_KEY,
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["user"]["role"] == "owner"
    assert body["user"]["username"] == owner.username
    assert body["user"]["shop_id"] == owner.shop_id


@pytest.mark.usefixtures("owner", "receiver", "cashier", "device_binding")
async def test_shop_login_rejects_wrong_role(client: AsyncClient, owner) -> None:
    resp = await client.post(
        "/auth/login",
        json={
            "role": "cashier_user",
            "username": owner.username,
            "password": "ownerpass",
            "device_key": TEST_DEVICE_KEY,
        },
    )
    assert resp.status_code == 401, resp.text


@pytest.mark.usefixtures("owner", "receiver", "cashier", "device_binding")
async def test_shop_login_rejects_unknown_or_unbound_device(
    client: AsyncClient, owner
) -> None:
    resp = await client.post(
        "/auth/login",
        json={
            "role": "owner",
            "username": owner.username,
            "password": "ownerpass",
            "device_key": "unregistered-terminal",
        },
    )
    assert resp.status_code == 403, resp.text
    assert "not registered" in resp.json()["detail"].lower()


@pytest.mark.usefixtures("owner", "receiver", "cashier", "device_binding")
async def test_shop_login_rejects_wrong_password(client: AsyncClient, owner) -> None:
    resp = await client.post(
        "/auth/login",
        json={
            "role": "owner",
            "username": owner.username,
            "password": "wrong",
            "device_key": TEST_DEVICE_KEY,
        },
    )
    assert resp.status_code == 401, resp.text


@pytest.mark.usefixtures("owner", "receiver", "cashier", "device_binding")
async def test_shop_login_rejects_username_without_device_binding(
    client: AsyncClient, owner, db_session
) -> None:
    shop = (await db_session.execute(select(Shop).where(Shop.id == owner.shop_id))).scalar_one()
    shop.allowed_login_cidrs = ["203.0.113.0/24"]
    await db_session.commit()

    blocked = await client.post(
        "/auth/login",
        headers={"X-Real-IP": "198.51.100.9"},
        json={
            "role": "owner",
            "username": owner.username,
            "password": "ownerpass",
            "device_key": TEST_DEVICE_KEY,
        },
    )
    assert blocked.status_code == 403
    assert blocked.json()["detail"] == "login allowed only from the shop network"

    allowed = await client.post(
        "/auth/login",
        headers={"X-Real-IP": "203.0.113.7"},
        json={
            "role": "owner",
            "username": owner.username,
            "password": "ownerpass",
            "device_key": TEST_DEVICE_KEY,
        },
    )
    assert allowed.status_code == 200, allowed.text


@pytest.mark.usefixtures("owner", "receiver", "cashier", "device_binding", "superadmin")
async def test_superadmin_login_still_uses_username_password(
    superadmin_client: AsyncClient,
) -> None:
    resp = await superadmin_client.get("/users/me")
    assert resp.status_code == 200
    assert resp.json()["role"] == "superadmin"


@pytest.mark.usefixtures("owner", "receiver", "cashier", "device_binding")
async def test_shop_login_requires_allowed_ip(
    client: AsyncClient, db_session, owner
) -> None:
    shop = (await db_session.execute(select(Shop).where(Shop.id == owner.shop_id))).scalar_one()
    shop.allowed_login_cidrs = ["203.0.113.0/24"]
    await db_session.commit()

    allowed = await client.post(
        "/auth/login",
        headers={"X-Real-IP": "203.0.113.7"},
        json={
            "role": "owner",
            "username": owner.username,
            "password": "ownerpass",
            "device_key": TEST_DEVICE_KEY,
        },
    )
    assert allowed.status_code == 200, allowed.text

    blocked = await client.post(
        "/auth/login",
        headers={"X-Real-IP": "198.51.100.9"},
        json={
            "role": "owner",
            "username": owner.username,
            "password": "ownerpass",
            "device_key": TEST_DEVICE_KEY,
        },
    )
    assert blocked.status_code == 403
    assert blocked.json()["detail"] == "login allowed only from the shop network"


@pytest.mark.usefixtures("owner", "receiver", "cashier", "device_binding")
async def test_device_context_requires_allowed_ip(client: AsyncClient, db_session, owner) -> None:
    shop = (await db_session.execute(select(Shop).where(Shop.id == owner.shop_id))).scalar_one()
    shop.allowed_login_cidrs = ["203.0.113.0/24"]
    await db_session.commit()

    allowed = await client.get(
        f"/auth/device-context?device_key={TEST_DEVICE_KEY}",
        headers={"X-Real-IP": "203.0.113.8"},
    )
    assert allowed.status_code == 200

    blocked = await client.get(
        f"/auth/device-context?device_key={TEST_DEVICE_KEY}",
        headers={"X-Real-IP": "198.51.100.10"},
    )
    assert blocked.status_code == 403
    assert blocked.json()["detail"] == "login allowed only from the shop network"


@pytest.mark.usefixtures("owner", "receiver", "cashier", "device_binding", "superadmin")
async def test_superadmin_login_is_not_ip_restricted(
    client: AsyncClient, db_session, owner, superadmin
) -> None:
    shop = (await db_session.execute(select(Shop).where(Shop.id == owner.shop_id))).scalar_one()
    shop.allowed_login_cidrs = ["203.0.113.0/24"]
    await db_session.commit()

    resp = await client.post(
        "/auth/login/superadmin",
        headers={"X-Real-IP": "198.51.100.99"},
        json={"username": superadmin.username, "password": "rootpass1"},
    )
    assert resp.status_code == 200, resp.text
