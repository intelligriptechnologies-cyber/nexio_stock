"""Auth tests for the public shop-staff lookup."""
from __future__ import annotations

import pytest
from httpx import AsyncClient

TEST_DEVICE_KEY = "test-terminal-01"


@pytest.mark.usefixtures("owner", "receiver", "cashier", "device_binding", "superadmin")
async def test_shop_staff_endpoint_lists_active_staff(client: AsyncClient) -> None:
    resp = await client.get("/auth/shop-staff")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert [row["full_name"] for row in body] == ["Cashier One", "Owner One", "Receiver One"]
    assert {row["role"] for row in body} == {"owner", "receiver_user", "cashier_user"}
    assert all("phone" not in row for row in body)


@pytest.mark.usefixtures("owner", "receiver", "cashier", "device_binding")
async def test_shop_staff_endpoint_ignores_login_restriction_flags(
    client: AsyncClient, db_session, owner
) -> None:
    from app.models.shop import Shop

    shop = await db_session.get(Shop, owner.shop_id)
    assert shop is not None
    shop.cashier_login_restriction_enabled = True
    shop.allowed_login_cidrs = ["203.0.113.0/24"]
    await db_session.commit()

    resp = await client.get("/auth/shop-staff", headers={"X-Real-IP": "198.51.100.10"})
    assert resp.status_code == 200, resp.text


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
async def test_shop_login_ignores_unbound_device_and_ip_allowlist(
    client: AsyncClient, db_session, owner
) -> None:
    from app.models.shop import Shop

    shop = await db_session.get(Shop, owner.shop_id)
    assert shop is not None
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
            "device_key": "unregistered-terminal",
        },
    )
    assert blocked.status_code == 200, blocked.text


@pytest.mark.usefixtures("owner", "receiver", "cashier", "device_binding", "superadmin")
async def test_superadmin_login_still_uses_username_password(
    superadmin_client: AsyncClient,
) -> None:
    resp = await superadmin_client.get("/users/me")
    assert resp.status_code == 200
    assert resp.json()["role"] == "superadmin"


@pytest.mark.usefixtures("owner", "receiver", "cashier", "device_binding", "superadmin")
async def test_superadmin_login_is_not_ip_restricted(
    client: AsyncClient, db_session, owner, superadmin
) -> None:
    from app.models.shop import Shop

    shop = await db_session.get(Shop, owner.shop_id)
    assert shop is not None
    shop.allowed_login_cidrs = ["203.0.113.0/24"]
    await db_session.commit()

    resp = await client.post(
        "/auth/login/superadmin",
        headers={"X-Real-IP": "198.51.100.99"},
        json={"username": superadmin.username, "password": "rootpass1"},
    )
    assert resp.status_code == 200, resp.text
