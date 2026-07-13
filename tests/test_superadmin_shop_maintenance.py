from __future__ import annotations

from httpx import AsyncClient


async def test_superadmin_can_create_update_shop_and_manage_users(
    superadmin_client: AsyncClient,
) -> None:
    created = await superadmin_client.post(
        "/shops",
        json={"name": "Second Shop", "code": "shop2", "low_stock_threshold_default": 4},
    )
    assert created.status_code == 201, created.text
    shop_id = created.json()["id"]

    updated = await superadmin_client.patch(
        f"/shops/{shop_id}",
        json={
            "name": "Second Shop Updated",
            "code": "shop-2",
            "allowed_login_cidrs": ["203.0.113.0/24"],
        },
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["name"] == "Second Shop Updated"
    assert updated.json()["code"] == "shop-2"
    assert updated.json()["allowed_login_cidrs"] == ["203.0.113.0/24"]

    user = await superadmin_client.post(
        f"/shops/{shop_id}/users",
        json={
            "role": "owner",
            "username": "owner2",
            "full_name": "Owner Two",
            "phone": "+15555550101",
            "password": "ownerpass",
        },
    )
    assert user.status_code == 201, user.text
    user_id = user.json()["id"]

    listed = await superadmin_client.get(f"/shops/{shop_id}/users")
    assert listed.status_code == 200
    assert [row["id"] for row in listed.json()] == [user_id]

    inactive = await superadmin_client.patch(
        f"/shops/{shop_id}/users/{user_id}",
        json={"is_active": False},
    )
    assert inactive.status_code == 200
    assert inactive.json()["is_active"] is False

    reset = await superadmin_client.patch(
        f"/shops/{shop_id}/users/{user_id}/password",
        json={"password": "newpass1"},
    )
    assert reset.status_code == 200


async def test_non_superadmin_cannot_access_shop_maintenance(
    owner_client: AsyncClient,
) -> None:
    resp = await owner_client.post("/shops", json={"name": "Nope", "code": "nope"})
    assert resp.status_code == 403


async def test_superadmin_product_copy_skips_existing_and_does_not_copy_stock(
    owner_client: AsyncClient,
    superadmin_client: AsyncClient,
    receiver_client: AsyncClient,
) -> None:
    product = await owner_client.post(
        "/products",
        json={
            "barcode": "COPY-1",
            "brand": "Copy Brand",
            "size_label": "750ml",
            "price": "123.45",
            "low_stock_threshold": 3,
        },
    )
    assert product.status_code == 201, product.text
    lot = await receiver_client.post("/lots", json={"lines": [{"barcode": "COPY-1", "quantity": 5}]})
    assert lot.status_code == 201, lot.text

    target = await superadmin_client.post("/shops", json={"name": "Target", "code": "target"})
    assert target.status_code == 201, target.text
    target_id = target.json()["id"]

    copied = await superadmin_client.post(
        f"/shops/{target_id}/products/copy-from-shop",
        json={"source_shop_id": 1},
    )
    assert copied.status_code == 200, copied.text
    assert copied.json()["copied"] == 1
    assert copied.json()["skipped"] == 0

    rows = await superadmin_client.get("/products", params={"shop_id": target_id})
    assert rows.status_code == 200
    body = rows.json()
    assert len(body) == 1
    assert body[0]["barcode"] == "COPY-1"
    assert body[0]["price"] == "123.45"
    assert body[0]["low_stock_threshold"] == 3
    assert body[0]["current_stock"] == 0

    copied_again = await superadmin_client.post(
        f"/shops/{target_id}/products/copy-from-shop",
        json={"source_shop_id": 1},
    )
    assert copied_again.status_code == 200
    assert copied_again.json()["copied"] == 0
    assert copied_again.json()["skipped"] == 1
