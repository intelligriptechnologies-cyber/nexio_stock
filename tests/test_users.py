from __future__ import annotations

from datetime import date

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.user import User
from app.security.passwords import verify_password


@pytest.mark.usefixtures("owner", "superadmin")
async def test_current_profile_reads_for_owner_and_superadmin(
    owner_client: AsyncClient,
    superadmin_client: AsyncClient,
    owner: User,
    superadmin: User,
    db_session,
) -> None:
    owner.email = "owner@example.com"
    owner.date_of_birth = date(1990, 4, 12)
    owner.pan = "ABCDE1234F"
    owner.gstin = "21ABCDE1234F1Z5"
    superadmin.email = "root@example.com"
    superadmin.date_of_birth = date(1988, 1, 2)
    superadmin.pan = "PQRSX6789L"
    superadmin.gstin = "07PQRSX6789L1Z2"
    await db_session.commit()

    owner_resp = await owner_client.get("/users/me")
    assert owner_resp.status_code == 200
    owner_body = owner_resp.json()
    assert owner_body["email"] == "owner@example.com"
    assert owner_body["date_of_birth"] == "1990-04-12"
    assert owner_body["pan"] == "ABCDE1234F"
    assert owner_body["gstin"] == "21ABCDE1234F1Z5"

    superadmin_resp = await superadmin_client.get("/users/me")
    assert superadmin_resp.status_code == 200
    superadmin_body = superadmin_resp.json()
    assert superadmin_body["email"] == "root@example.com"
    assert superadmin_body["date_of_birth"] == "1988-01-02"
    assert superadmin_body["pan"] == "PQRSX6789L"
    assert superadmin_body["gstin"] == "07PQRSX6789L1Z2"


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_owner_can_update_own_profile(
    owner_client: AsyncClient, owner: User, db_session
) -> None:
    resp = await owner_client.patch(
        "/users/me",
        json={
            "email": "updated-owner@example.com",
            "phone": "+15555559999",
            "date_of_birth": "1991-05-06",
            "pan": "ABCDE1234F",
            "gstin": "21ABCDE1234F1Z5",
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["email"] == "updated-owner@example.com"
    assert body["phone"] == "+15555559999"
    assert body["date_of_birth"] == "1991-05-06"
    assert body["pan"] == "ABCDE1234F"
    assert body["gstin"] == "21ABCDE1234F1Z5"

    user = (await db_session.execute(select(User).where(User.id == owner.id))).scalar_one()
    await db_session.refresh(user)
    assert user.email == "updated-owner@example.com"
    assert user.phone == "+15555559999"
    assert user.date_of_birth == date(1991, 5, 6)
    assert user.pan == "ABCDE1234F"
    assert user.gstin == "21ABCDE1234F1Z5"


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_password_change_rejects_bad_current_password(
    owner_client: AsyncClient, owner: User, db_session
) -> None:
    user_before = (await db_session.execute(select(User).where(User.id == owner.id))).scalar_one()
    await db_session.refresh(user_before)
    original_hash = user_before.password_hash

    resp = await owner_client.patch(
        "/users/me/password",
        json={
            "current_password": "wrong-pass",
            "new_password": "new-owner-pass",
            "confirm_password": "new-owner-pass",
        },
    )
    assert resp.status_code == 401

    user_after = (await db_session.execute(select(User).where(User.id == owner.id))).scalar_one()
    await db_session.refresh(user_after)
    assert user_after.password_hash == original_hash
    assert verify_password("ownerpass", user_after.password_hash)


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_password_change_accepts_valid_current_password(
    owner_client: AsyncClient, owner: User, db_session
) -> None:
    resp = await owner_client.patch(
        "/users/me/password",
        json={
            "current_password": "ownerpass",
            "new_password": "new-owner-pass",
            "confirm_password": "new-owner-pass",
        },
    )
    assert resp.status_code == 200, resp.text
    assert "password_hash" not in resp.json()

    user = (await db_session.execute(select(User).where(User.id == owner.id))).scalar_one()
    await db_session.refresh(user)
    assert verify_password("new-owner-pass", user.password_hash)

    old_login = await owner_client.post(
        "/auth/login",
        json={
            "role": "owner",
            "username": "owner1",
            "password": "ownerpass",
            "device_key": "test-terminal-01",
        },
    )
    assert old_login.status_code == 401

    new_login = await owner_client.post(
        "/auth/login",
        json={
            "role": "owner",
            "username": "owner1",
            "password": "new-owner-pass",
            "device_key": "test-terminal-01",
        },
    )
    assert new_login.status_code == 200, new_login.text
