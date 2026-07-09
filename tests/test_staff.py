"""Staff management tests: owner creates receiver/cashier, role boundaries,
duplicate detection (D-27, D-25, R-4, R-21).
"""
from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.shop import Shop
from app.models.user import User, UserRole


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


@pytest.mark.usefixtures("owner")
async def test_duplicate_phone_rejected_across_shops_with_409(
    superadmin_client: AsyncClient, owner: User, db_session: AsyncSession
) -> None:
    """Regression: phone must be globally unique, not just per-shop.

    Login for shop-scoped roles looks a user up by phone alone (it has no
    way to know the shop ahead of time), so two different shops' users
    sharing a phone made that lookup match multiple rows and crash with
    MultipleResultsFound (500) instead of ever reaching password checks —
    which showed up as "owner/staff login doesn't redirect anywhere".
    """
    shop2 = Shop(code="shop2-staffdupe", name="Shop Two")
    db_session.add(shop2)
    await db_session.flush()
    await db_session.commit()

    resp = await superadmin_client.post(
        "/staff",
        json={
            "role": "cashier_user",
            "username": "newu2",
            "full_name": "Cross Shop Dupe",
            "phone": owner.phone,  # collides with owner's phone in a different shop
            "password": "duppass",
            "shop_id": shop2.id,
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
    # Staff page manages cashier/receiver only; owner accounts are handled
    # from Shop Management.
    assert len(body) == 2
    assert all(u["shop_id"] == shop.id for u in body)
    assert {u["role"] for u in body} == {"receiver_user", "cashier_user"}


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_owner_staff_list_rejects_explicit_shop_id(owner_client: AsyncClient, shop: object) -> None:
    resp = await owner_client.get("/staff", params={"shop_id": shop.id})
    assert resp.status_code == 400


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


@pytest.mark.usefixtures("owner")
async def test_owner_resets_staff_password(
    owner_client: AsyncClient, receiver: User
) -> None:
    resp = await owner_client.patch(
        f"/staff/{receiver.id}/password",
        json={"password": "newrecvpass"},
    )
    assert resp.status_code == 200
    assert resp.json()["id"] == receiver.id

    # Old password no longer works, new one does.
    stale = await owner_client.post(
        "/auth/login", json={"phone": receiver.phone, "password": "recvpass"}
    )
    assert stale.status_code == 401
    fresh = await owner_client.post(
        "/auth/login", json={"phone": receiver.phone, "password": "newrecvpass"}
    )
    assert fresh.status_code == 200


@pytest.mark.usefixtures("owner")
async def test_owner_cannot_reset_password_for_other_shop_staff(
    owner_client: AsyncClient, db_session: AsyncSession
) -> None:
    shop2 = Shop(code="shop2-staffreset", name="Shop Two")
    db_session.add(shop2)
    await db_session.flush()
    other = User(
        shop_id=shop2.id,
        role=UserRole.CASHIER_USER,
        username="othercash",
        full_name="Other Cashier",
        phone="+15555550400",
        password_hash="x",
        is_active=True,
    )
    db_session.add(other)
    await db_session.commit()
    await db_session.refresh(other)

    resp = await owner_client.patch(
        f"/staff/{other.id}/password",
        json={"password": "whatever1"},
    )
    assert resp.status_code == 404


@pytest.mark.usefixtures("owner")
async def test_owner_cannot_reset_own_password_via_staff_endpoint(
    owner_client: AsyncClient, owner: User
) -> None:
    resp = await owner_client.patch(
        f"/staff/{owner.id}/password",
        json={"password": "newownerpass"},
    )
    assert resp.status_code == 404


@pytest.mark.usefixtures("owner")
async def test_owner_can_activate_and_deactivate_staff(
    owner_client: AsyncClient, receiver: User
) -> None:
    inactive = await owner_client.patch(
        f"/staff/{receiver.id}",
        json={"is_active": False},
    )
    assert inactive.status_code == 200
    assert inactive.json()["is_active"] is False

    active = await owner_client.patch(
        f"/staff/{receiver.id}",
        json={"is_active": True},
    )
    assert active.status_code == 200
    assert active.json()["is_active"] is True


@pytest.mark.usefixtures("owner")
async def test_owner_cannot_activate_owner_via_staff_endpoint(
    owner_client: AsyncClient, owner: User
) -> None:
    resp = await owner_client.patch(f"/staff/{owner.id}", json={"is_active": False})
    assert resp.status_code == 404


@pytest.mark.usefixtures("owner", "receiver")
async def test_receiver_cannot_reset_staff_password(
    receiver_client: AsyncClient, receiver: User
) -> None:
    resp = await receiver_client.patch(
        f"/staff/{receiver.id}/password",
        json={"password": "whatever1"},
    )
    assert resp.status_code == 403


@pytest.mark.usefixtures("owner", "receiver")
async def test_superadmin_resets_staff_password_any_shop(
    superadmin_client: AsyncClient, receiver: User
) -> None:
    resp = await superadmin_client.patch(
        f"/staff/{receiver.id}/password",
        json={"password": "supersetpass"},
    )
    assert resp.status_code == 200


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_superadmin_lists_staff_for_selected_shop_only(
    superadmin_client: AsyncClient,
    receiver: User,
    cashier: User,
    db_session: AsyncSession,
) -> None:
    shop2 = Shop(code="shop2-stafflist", name="Shop Two")
    db_session.add(shop2)
    await db_session.flush()
    other = User(
        shop_id=shop2.id,
        role=UserRole.CASHIER_USER,
        username="othercash2",
        full_name="Other Cashier",
        phone="+15555550401",
        password_hash="x",
        is_active=True,
    )
    db_session.add(other)
    await db_session.commit()

    resp = await superadmin_client.get("/staff", params={"shop_id": receiver.shop_id})
    assert resp.status_code == 200
    ids = {row["id"] for row in resp.json()}
    assert ids == {receiver.id, cashier.id}


@pytest.mark.usefixtures("superadmin")
async def test_superadmin_staff_list_requires_shop_id(superadmin_client: AsyncClient) -> None:
    resp = await superadmin_client.get("/staff")
    assert resp.status_code == 400


@pytest.mark.usefixtures("owner", "receiver")
async def test_superadmin_can_bound_staff_activation_to_selected_shop(
    superadmin_client: AsyncClient,
    receiver: User,
    db_session: AsyncSession,
) -> None:
    shop2 = Shop(code="shop2-staffactive", name="Shop Two")
    db_session.add(shop2)
    await db_session.flush()
    await db_session.commit()

    wrong_shop = await superadmin_client.patch(
        f"/staff/{receiver.id}",
        params={"shop_id": shop2.id},
        json={"is_active": False},
    )
    assert wrong_shop.status_code == 404

    ok = await superadmin_client.patch(
        f"/staff/{receiver.id}",
        params={"shop_id": receiver.shop_id},
        json={"is_active": False},
    )
    assert ok.status_code == 200
    assert ok.json()["is_active"] is False
