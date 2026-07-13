"""Vendor CRUD and historical-lot retention tests."""
from __future__ import annotations

import pytest
from httpx import AsyncClient


async def _create_product(client: AsyncClient, barcode: str) -> None:
    resp = await client.post(
        "/products",
        json={"barcode": barcode, "brand": "Retail", "size_label": "750ml", "price": "100.00"},
    )
    assert resp.status_code == 201, resp.text


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_owner_can_create_update_and_deactivate_vendor(
    owner_client: AsyncClient,
) -> None:
    created = await owner_client.post(
        "/vendors",
        json={
            "name": "Supplier X",
            "gstin": "21ABCDE1234F1Z5",
            "address": "Plot 1",
            "email": "x@example.com",
            "phone": "+15555550005",
        },
    )
    assert created.status_code == 201, created.text
    vendor_id = created.json()["id"]

    listed = await owner_client.get("/vendors")
    assert listed.status_code == 200, listed.text
    assert any(row["id"] == vendor_id for row in listed.json())

    patched = await owner_client.patch(
        f"/vendors/{vendor_id}",
        json={"phone": "+15555550006", "is_active": False},
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["phone"] == "+15555550006"
    assert patched.json()["is_active"] is False

    active_only = await owner_client.get("/vendors")
    assert active_only.status_code == 200
    assert all(row["id"] != vendor_id for row in active_only.json())

    all_rows = await owner_client.get("/vendors?include_inactive=true")
    assert all_rows.status_code == 200
    assert any(row["id"] == vendor_id and row["is_active"] is False for row in all_rows.json())


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_receiver_cannot_mutate_vendors(receiver_client: AsyncClient) -> None:
    create = await receiver_client.post("/vendors", json={"name": "Forbidden"})
    assert create.status_code == 403

    update = await receiver_client.patch("/vendors/1", json={"name": "Nope"})
    assert update.status_code == 403


@pytest.mark.usefixtures("owner", "receiver", "cashier", "superadmin")
async def test_superadmin_can_manage_vendors_for_selected_shop(
    superadmin_client: AsyncClient,
) -> None:
    created = await superadmin_client.post(
        "/vendors",
        json={
            "shop_id": 1,
            "name": "Global Supply",
            "gstin": "21ABCDE1234F1Z5",
            "address": "Warehouse",
            "email": "global@example.com",
            "phone": "+15555550007",
        },
    )
    assert created.status_code == 201, created.text
    vendor_id = created.json()["id"]

    listed = await superadmin_client.get("/vendors?shop_id=1&include_inactive=true")
    assert listed.status_code == 200, listed.text
    assert any(row["id"] == vendor_id for row in listed.json())

    updated = await superadmin_client.patch(
        f"/vendors/{vendor_id}",
        json={"shop_id": 1, "is_active": False},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["is_active"] is False


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_historical_lot_still_shows_deactivated_vendor(
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
) -> None:
    vendor = await owner_client.post(
        "/vendors",
        json={
            "name": "Heritage Supply",
            "gstin": "21ABCDE1234F1Z5",
            "address": "Plot 2",
            "email": "heritage@example.com",
            "phone": "+15555550008",
        },
    )
    assert vendor.status_code == 201, vendor.text
    vendor_id = vendor.json()["id"]

    await _create_product(owner_client, "8999999999991")
    lot = await receiver_client.post(
        "/lots",
        json={
            "vendor_id": vendor_id,
            "purchase_date": "2026-07-13",
            "vendor_invoice_number": "A-1",
            "invoice_value": "100.00",
            "lines": [
                {
                    "barcode": "8999999999991",
                    "quantity": 2,
                    "good_condition_quantity": 2,
                }
            ],
        },
    )
    assert lot.status_code == 201, lot.text
    lot_id = lot.json()["id"]

    deactivated = await owner_client.patch(f"/vendors/{vendor_id}", json={"is_active": False})
    assert deactivated.status_code == 200, deactivated.text

    fetched = await receiver_client.get(f"/lots/{lot_id}")
    assert fetched.status_code == 200, fetched.text
    assert fetched.json()["vendor"]["name"] == "Heritage Supply"
    assert fetched.json()["vendor"]["is_active"] is False
