from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy import select, text

from app.models.shop import Shop


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_owner_can_read_and_update_own_settings(
    owner_client: AsyncClient, db_session
) -> None:
    resp = await owner_client.get("/settings/me")
    assert resp.status_code == 200
    assert resp.json()["app_display_name"] == "BarStock"
    assert resp.json()["action_color"] == "#22c55e"
    assert resp.json()["active_tab_color"] == "#5a5148"
    assert resp.json()["sidebar_menu_inactive_text_color"] == "#535353cf"
    assert resp.json()["sidebar_menu_active_text_color"] == "#ffffff"
    assert resp.json()["cashier_login_restriction_enabled"] is False
    assert resp.json()["receiving_vendor_link_enabled"] is True
    assert resp.json()["allowed_login_cidrs"] == []

    resp = await owner_client.patch(
        "/settings/me",
        json={
            "app_display_name": "Counter One",
            "action_color": "#2563eb",
            "active_tab_color": "#5a5148",
            "sidebar_menu_inactive_text_color": "#535353cf",
            "sidebar_menu_active_text_color": "#111827",
            "email_enabled": True,
            "cashier_login_restriction_enabled": True,
            "receiving_vendor_link_enabled": False,
            "smtp_host": "smtp.example.com",
            "smtp_port": 587,
            "smtp_username": "mailer",
            "smtp_password": "secret-pass",
            "smtp_from_email": "receipts@example.com",
            "smtp_from_name": "Receipts",
            "smtp_use_tls": True,
            "gstin": "21ABCDE1234F1Z5",
            "excise_duty_rate": "12.50",
            "low_stock_threshold_default": 4,
            "allowed_login_cidrs": ["203.0.113.0/24", "198.51.100.10"],
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["app_display_name"] == "Counter One"
    assert body["action_color"] == "#2563eb"
    assert body["active_tab_color"] == "#5a5148"
    assert body["sidebar_menu_inactive_text_color"] == "#535353cf"
    assert body["sidebar_menu_active_text_color"] == "#111827"
    assert body["cashier_login_restriction_enabled"] is True
    assert body["receiving_vendor_link_enabled"] is False
    assert body["smtp_host"] == "smtp.example.com"
    assert "smtp_password" not in body
    assert body["gstin"] == "21ABCDE1234F1Z5"
    assert body["excise_duty_rate"] == "12.50"
    assert body["low_stock_threshold_default"] == 4
    assert body["allowed_login_cidrs"] == ["203.0.113.0/24", "198.51.100.10/32"]

    shop = (await db_session.execute(select(Shop).where(Shop.id == 1))).scalar_one()
    assert shop.smtp_password == "secret-pass"


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_cashier_and_receiver_cannot_access_settings(
    cashier_client: AsyncClient, receiver_client: AsyncClient
) -> None:
    for ac in (cashier_client, receiver_client):
        assert (await ac.get("/settings/me")).status_code == 403
        assert (await ac.patch("/settings/me", json={"action_color": "#2563eb"})).status_code == 403


@pytest.mark.usefixtures("owner", "receiver", "cashier", "superadmin")
async def test_superadmin_requires_and_uses_shop_id(
    superadmin_client: AsyncClient, db_session
) -> None:
    missing = await superadmin_client.get("/settings/me")
    assert missing.status_code == 400

    other = Shop(code="shop2", name="Shop Two")
    db_session.add(other)
    await db_session.commit()
    await db_session.refresh(other)

    resp = await superadmin_client.patch(
        "/settings/me",
        json={"shop_id": other.id, "app_display_name": "Selected Shop", "action_color": "#0ea5e9"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["id"] == other.id

    first_shop = (await db_session.execute(select(Shop).where(Shop.id == 1))).scalar_one()
    await db_session.refresh(other)
    assert first_shop.app_display_name == "BarStock"
    assert other.app_display_name == "Selected Shop"


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_owner_must_not_pass_shop_id(owner_client: AsyncClient) -> None:
    resp = await owner_client.patch("/settings/me", json={"shop_id": 1, "action_color": "#2563eb"})
    assert resp.status_code == 400


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_smtp_password_is_write_only_and_blank_update_preserves_it(
    owner_client: AsyncClient, db_session
) -> None:
    resp = await owner_client.patch("/settings/me", json={"smtp_password": "first-secret"})
    assert resp.status_code == 200
    assert "smtp_password" not in resp.json()

    resp = await owner_client.get("/settings/me")
    assert resp.status_code == 200
    assert "smtp_password" not in resp.json()

    resp = await owner_client.patch("/settings/me", json={"smtp_password": ""})
    assert resp.status_code == 200
    stored = (
        await db_session.execute(text("SELECT smtp_password FROM shops WHERE id = 1"))
    ).scalar_one()
    assert stored == "first-secret"

    resp = await owner_client.patch("/settings/me", json={"smtp_password": "second-secret"})
    assert resp.status_code == 200
    stored = (
        await db_session.execute(text("SELECT smtp_password FROM shops WHERE id = 1"))
    ).scalar_one()
    assert stored == "second-secret"


@pytest.mark.usefixtures("owner", "receiver", "cashier")
@pytest.mark.parametrize(
    "payload",
    [
        {"action_color": "green"},
        {"action_color": "#12345g"},
        {"active_tab_color": "brown"},
        {"active_tab_color": "#12345g"},
        {"sidebar_menu_inactive_text_color": "gray"},
        {"sidebar_menu_inactive_text_color": "#12345g"},
        {"sidebar_menu_active_text_color": "#123456789"},
        {"smtp_from_email": "not-an-email"},
        {"smtp_port": 0},
        {"smtp_port": 65536},
        {"gstin": "SHORT"},
        {"excise_duty_rate": "-1.00"},
        {"excise_duty_rate": "100.01"},
        {"low_stock_threshold_default": -1},
        {"allowed_login_cidrs": ["not-a-cidr"]},
    ],
)
async def test_invalid_settings_values_are_rejected(
    owner_client: AsyncClient, payload: dict
) -> None:
    resp = await owner_client.patch("/settings/me", json=payload)
    assert resp.status_code == 422
