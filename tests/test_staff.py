"""Staff management tests: owner creates receiver/cashier, role boundaries,
duplicate detection (D-27, D-25, R-4, R-21).
"""
from __future__ import annotations

import pytest
from httpx import AsyncClient


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_owner_creates_receiver_user(owner_client: AsyncClient) -> None:
    resp = await owner_client.post(
        "/staff",
        json={
            "role": "receiver_user",
            "username": "recv2",
            "full_name": "Receiver Two",
            "phone": "+15555550100",
            "password": "recvpass2",
        },
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["role"] == "receiver_user"
    assert body["username"] == "recv2"
    assert body["shop_id"] is not None


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_owner_creates_cashier_user(owner_client: AsyncClient) -> None:
    resp = await owner_client.post(
        "/staff",
        json={
            "role": "cashier_user",
            "username": "cash2",
            "full_name": "Cashier Two",
            "phone": "+15555550101",
            "password": "cashpass2",
        },
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["role"] == "cashier_user"


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_owner_cannot_create_another_owner(owner_client: AsyncClient) -> None:
    resp = await owner_client.post(
        "/staff",
        json={
            "role": "owner",
            "username": "owner2",
            "full_name": "Owner Two",
            "phone": "+15555550102",
            "password": "ownerpass2",
        },
    )
    assert resp.status_code == 422  # schema validator rejects


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_owner_cannot_create_superadmin(owner_client: AsyncClient) -> None:
    resp = await owner_client.post(
        "/staff",
        json={
            "role": "superadmin",
            "username": "root2",
            "full_name": "Root Two",
            "phone": "+15555550103",
            "password": "rootpass2",
        },
    )
    assert resp.status_code == 422


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_duplicate_username_rejected_with_409(
    owner_client: AsyncClient, receiver: object
) -> None:
    # `receiver` fixture already has username="receiver1" in the same shop.
    resp = await owner_client.post(
        "/staff",
        json={
            "role": "cashier_user",
            "username": "receiver1",  # collision
            "full_name": "Dupe",
            "phone": "+15555550200",
            "password": "duppass",
        },
    )
    assert resp.status_code == 409


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_duplicate_phone_rejected_with_409(
    owner_client: AsyncClient, receiver: object
) -> None:
    # `receiver` fixture already has phone="+15555550002" in the same shop.
    resp = await owner_client.post(
        "/staff",
        json={
            "role": "cashier_user",
            "username": "newu",
            "full_name": "Dupe Phone",
            "phone": "+15555550002",  # collision
            "password": "duppass",
        },
    )
    assert resp.status_code == 409


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_owner_lists_only_their_shop_staff(
    owner_client: AsyncClient, shop: object
) -> None:
    resp = await owner_client.get("/staff")
    assert resp.status_code == 200
    body = resp.json()
    # owner + receiver + cashier in the same shop = 3
    assert len(body) == 3
    assert all(u["shop_id"] == shop.id for u in body)


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_receiver_cannot_create_staff(receiver_client: AsyncClient) -> None:
    resp = await receiver_client.post(
        "/staff",
        json={
            "role": "cashier_user",
            "username": "evil",
            "full_name": "Evil",
            "phone": "+15555550300",
            "password": "evilpass",
        },
    )
    assert resp.status_code == 403
