"""Auth tests: login, tokens, role checks at the auth layer."""
from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User, UserRole
from app.security.passwords import hash_password


@pytest.mark.usefixtures("owner", "receiver", "cashier", "superadmin")
async def test_superadmin_login_returns_token(superadmin_client: AsyncClient) -> None:
    resp = await superadmin_client.get("/users/me")
    assert resp.status_code == 200
    body = resp.json()
    assert body["role"] == "superadmin"
    assert body["shop_id"] is None


@pytest.mark.usefixtures("owner")
async def test_owner_login_with_phone_returns_token(owner_client: AsyncClient) -> None:
    resp = await owner_client.get("/users/me")
    assert resp.status_code == 200
    body = resp.json()
    assert body["role"] == "owner"


@pytest.mark.usefixtures("receiver")
async def test_receiver_login_with_phone_returns_token(receiver_client: AsyncClient) -> None:
    resp = await receiver_client.get("/users/me")
    assert resp.status_code == 200
    assert resp.json()["role"] == "receiver_user"


@pytest.mark.usefixtures("cashier")
async def test_cashier_login_with_phone_returns_token(cashier_client: AsyncClient) -> None:
    resp = await cashier_client.get("/users/me")
    assert resp.status_code == 200
    assert resp.json()["role"] == "cashier_user"


async def test_shop_login_with_wrong_password(client: AsyncClient, owner) -> None:
    resp = await client.post(
        "/auth/login", json={"phone": owner.phone, "password": "wrong"}
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


async def test_superadmin_token_cannot_be_used_for_shop_login(
    client: AsyncClient, superadmin
) -> None:
    """Sanity: a superadmin doesn't have a real phone; shop login rejects them."""
    resp = await client.post(
        "/auth/login", json={"phone": superadmin.phone, "password": "rootpass1"}
    )
    assert resp.status_code == 401


async def test_shop_login_requires_phone_and_password(client: AsyncClient) -> None:
    resp = await client.post("/auth/login", json={"phone": "+15555550001"})
    assert resp.status_code == 422  # missing password


async def test_superadmin_login_requires_username_and_password(client: AsyncClient) -> None:
    resp = await client.post("/auth/login/superadmin", json={"username": "root"})
    assert resp.status_code == 422  # missing password


@pytest.mark.usefixtures("superadmin")
async def test_superadmin_username_must_be_globally_unique(
    superadmin: User, db_session: AsyncSession
) -> None:
    """Regression: shop_id is NULL for every superadmin, and a unique
    constraint on (shop_id, username) is a no-op across NULL shop_ids —
    so without a dedicated constraint, two superadmins could share a
    username and login-by-username would crash with MultipleResultsFound.
    """
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
