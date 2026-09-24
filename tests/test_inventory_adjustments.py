"""Approval-gated signed inventory adjustment integration tests."""
from __future__ import annotations

import pytest
from httpx import AsyncClient


async def _product(owner_client: AsyncClient, barcode: str) -> dict:
    response = await owner_client.post(
        "/products",
        json={
            "barcode": barcode,
            "brand": "Counted Stock",
            "size_label": "750ml",
            "price": "100.00",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


async def _receive(
    receiver_client: AsyncClient, owner_client: AsyncClient, barcode: str, quantity: int
) -> None:
    response = await receiver_client.post(
        "/lots",
        json={
            "invoice_value": f"{quantity * 100:.2f}",
            "lines": [{"barcode": barcode, "quantity": quantity, "unit_cost": "100.00"}],
        },
    )
    assert response.status_code == 201, response.text
    approved = await owner_client.post(f"/lots/{response.json()['id']}/approve")
    assert approved.status_code == 200, approved.text


async def _inventory(superadmin_client: AsyncClient, shop_id: int, product_id: int) -> dict:
    response = await superadmin_client.get("/products/inventory", params={"shop_id": shop_id})
    assert response.status_code == 200, response.text
    return next(row for row in response.json() if row["id"] == product_id)


@pytest.mark.usefixtures("owner", "receiver", "cashier", "superadmin")
async def test_adjustment_is_pending_then_applies_exact_signed_delta(
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
    superadmin_client: AsyncClient,
) -> None:
    product = await _product(owner_client, "8990000000001")
    await _receive(receiver_client, owner_client, product["barcode"], 10)

    created = await superadmin_client.post(
        f"/products/{product['id']}/inventory-adjustments",
        json={"shop_id": product["shop_id"], "quantity_delta": -4, "reason": "Cycle count"},
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["movement_type"] == "adjustment"
    assert body["status"] == "pending"
    assert body["notes"] == "Cycle count"
    assert body["lines"][0]["quantity"] == -4
    assert body["lines"][0]["good_condition_quantity"] == -4
    assert body["lines"][0]["breakage_quantity"] == 0

    pending_row = await _inventory(
        superadmin_client, product["shop_id"], product["id"]
    )
    assert pending_row["current_stock"] == 10
    assert pending_row["has_pending_inventory_request"] is True

    approved = await owner_client.post(f"/lots/{body['id']}/approve")
    assert approved.status_code == 200, approved.text
    assert approved.json()["movement_type"] == "adjustment"

    final_row = await _inventory(superadmin_client, product["shop_id"], product["id"])
    assert final_row["current_stock"] == 6
    assert final_row["has_pending_inventory_request"] is False


@pytest.mark.usefixtures("owner", "receiver", "cashier", "superadmin")
async def test_adjustment_permissions_validation_and_pending_conflict(
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
    cashier_client: AsyncClient,
    superadmin_client: AsyncClient,
) -> None:
    product = await _product(owner_client, "8990000000002")
    payload = {"shop_id": product["shop_id"], "quantity_delta": 3, "reason": "Found stock"}

    assert (
        await owner_client.post(
            f"/products/{product['id']}/inventory-adjustments", json=payload
        )
    ).status_code == 403
    assert (
        await receiver_client.post(
            f"/products/{product['id']}/inventory-adjustments", json=payload
        )
    ).status_code == 403
    assert (
        await cashier_client.post(
            f"/products/{product['id']}/inventory-adjustments", json=payload
        )
    ).status_code == 403

    for invalid in (
        {"quantity_delta": 3, "reason": "Missing shop"},
        {"shop_id": product["shop_id"], "quantity_delta": 0, "reason": "No change"},
        {"shop_id": product["shop_id"], "quantity_delta": 1, "reason": "   "},
    ):
        response = await superadmin_client.post(
            f"/products/{product['id']}/inventory-adjustments", json=invalid
        )
        assert response.status_code in {400, 422}, response.text

    first = await superadmin_client.post(
        f"/products/{product['id']}/inventory-adjustments", json=payload
    )
    assert first.status_code == 201, first.text
    duplicate = await superadmin_client.post(
        f"/products/{product['id']}/inventory-adjustments", json=payload
    )
    assert duplicate.status_code == 409, duplicate.text
    assert duplicate.json()["detail"]["code"] == "pending_inventory_request"


@pytest.mark.usefixtures("owner", "receiver", "cashier", "superadmin")
async def test_excessive_removal_stays_pending_and_does_not_change_stock(
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
    superadmin_client: AsyncClient,
) -> None:
    product = await _product(owner_client, "8990000000003")
    await _receive(receiver_client, owner_client, product["barcode"], 2)
    created = await superadmin_client.post(
        f"/products/{product['id']}/inventory-adjustments",
        json={
            "shop_id": product["shop_id"],
            "quantity_delta": -3,
            "reason": "Damaged stock count",
        },
    )
    assert created.status_code == 201, created.text

    rejected_approval = await superadmin_client.post(
        f"/lots/{created.json()['id']}/approve"
    )
    assert rejected_approval.status_code == 409, rejected_approval.text
    assert (
        rejected_approval.json()["detail"]["code"]
        == "insufficient_stock_for_adjustment"
    )

    pending = await superadmin_client.get(
        "/lots", params={"shop_id": product["shop_id"], "status": "pending"}
    )
    assert pending.status_code == 200
    assert [row["id"] for row in pending.json()["lots"]] == [created.json()["id"]]
    row = await _inventory(superadmin_client, product["shop_id"], product["id"])
    assert row["current_stock"] == 2
    assert row["has_pending_inventory_request"] is True
