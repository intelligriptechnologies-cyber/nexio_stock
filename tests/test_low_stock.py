"""Low-stock alert tests (D-34, D-15, R-15, #7)."""
from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy import select, update

from app.models.product import Product
from app.models.shop import Shop

# --- helpers ---


async def _seed_product(
    client: AsyncClient, barcode: str, *, price: str = "100.00", brand: str = "X"
) -> dict:
    resp = await client.post(
        "/products",
        json={"barcode": barcode, "brand": brand, "size_label": "750ml", "price": price},
    )
    assert resp.status_code == 201
    return resp.json()


async def _seed_lot(
    receiver_client: AsyncClient, owner_client: AsyncClient, *, items: list[tuple[str, int]]
) -> None:
    resp = await receiver_client.post(
        "/lots",
        json={"lines": [{"barcode": bc, "quantity": q} for bc, q in items]},
    )
    assert resp.status_code == 201
    inward_id = resp.json()["id"]
    approved = await owner_client.post(f"/lots/{inward_id}/approve")
    assert approved.status_code == 200, approved.text


async def _finalize(
    cashier_client: AsyncClient,
    *,
    barcode: str,
    quantity: int,
    amount: str,
) -> None:
    import uuid

    resp = await cashier_client.post(
        "/checkout/finalize",
        headers={"Idempotency-Key": f"k-{uuid.uuid4().hex}"},
        json={
            "lines": [{"barcode": barcode, "quantity": quantity}],
            "payments": [{"mode": "cash", "amount": amount}],
        },
    )
    assert resp.status_code == 201


# --- shop default threshold ---


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_no_default_no_overrides_returns_empty(
    owner_client: AsyncClient, receiver_client: AsyncClient
) -> None:
    # No shop default, no per-product thresholds. The product has
    # stock but isn't monitored.
    await _seed_product(owner_client, "8905000000001", brand="Watched")
    await _seed_lot(receiver_client, owner_client, items=[("8905000000001", 5)])

    resp = await owner_client.get("/dashboard/low-stock")
    assert resp.status_code == 200
    assert resp.json()["items"] == []


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_per_product_override_triggers_alert(
    owner_client: AsyncClient, receiver_client: AsyncClient
) -> None:
    await _seed_product(owner_client, "8905000000002", brand="R")
    await _seed_lot(receiver_client, owner_client, items=[("8905000000002", 3)])

    # Per-product threshold = 5; stock 3 → low.
    upd = await owner_client.patch(
        "/products/1",
        json={"low_stock_threshold": 5},
    )
    # (Product id 1 — relies on insertion order, but we just seeded one.)
    assert upd.status_code == 200

    resp = await owner_client.get("/dashboard/low-stock")
    items = resp.json()["items"]
    assert len(items) == 1
    assert items[0]["barcode"] == "8905000000002"
    assert items[0]["current_stock"] == 3
    assert items[0]["effective_threshold"] == 5


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_product_above_threshold_not_in_list(
    owner_client: AsyncClient, receiver_client: AsyncClient, db_session
) -> None:
    # Set shop default threshold to 5. A product with 10 stock is
    # above threshold → not in the list.
    await db_session.execute(
        update(Shop).where(Shop.id == 1).values(low_stock_threshold_default=5)
    )
    await db_session.commit()

    await _seed_product(owner_client, "8905000000003", brand="Plenty")
    await _seed_lot(receiver_client, owner_client, items=[("8905000000003", 10)])

    resp = await owner_client.get("/dashboard/low-stock")
    assert resp.json()["items"] == []


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_product_at_threshold_appears(
    owner_client: AsyncClient, receiver_client: AsyncClient, db_session
) -> None:
    # D-34 says "at or below" — boundary inclusion.
    await db_session.execute(
        update(Shop).where(Shop.id == 1).values(low_stock_threshold_default=5)
    )
    await db_session.commit()

    await _seed_product(owner_client, "8905000000004", brand="Edge")
    await _seed_lot(receiver_client, owner_client, items=[("8905000000004", 5)])

    resp = await owner_client.get("/dashboard/low-stock")
    items = resp.json()["items"]
    assert len(items) == 1
    assert items[0]["barcode"] == "8905000000004"
    assert items[0]["current_stock"] == 5
    assert items[0]["effective_threshold"] == 5


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_sale_brings_product_below_threshold(
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
    cashier_client: AsyncClient,
    db_session,
) -> None:
    # 10 in stock, threshold 5. Sell 6 → stock 4 → low. The acceptance
    # criterion "stock counts increase" works in reverse too: a sale
    # that drops stock below threshold should surface the product.
    await db_session.execute(
        update(Shop).where(Shop.id == 1).values(low_stock_threshold_default=5)
    )
    await db_session.commit()

    await _seed_product(owner_client, "8905000000005", brand="Y")
    await _seed_lot(receiver_client, owner_client, items=[("8905000000005", 10)])
    await _finalize(cashier_client, barcode="8905000000005", quantity=6, amount="600.00")

    resp = await owner_client.get("/dashboard/low-stock")
    items = resp.json()["items"]
    assert len(items) == 1
    assert items[0]["barcode"] == "8905000000005"
    assert items[0]["current_stock"] == 4
    assert items[0]["effective_threshold"] == 5


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_per_product_override_beats_shop_default(
    owner_client: AsyncClient, receiver_client: AsyncClient, db_session
) -> None:
    # Shop default 5. Product A has per-product override 20 (i.e.
    # warn sooner); product B has the shop default.
    await db_session.execute(
        update(Shop).where(Shop.id == 1).values(low_stock_threshold_default=10)
    )
    await db_session.commit()

    await _seed_product(owner_client, "8905000000006", brand="Sensitive")
    await _seed_product(owner_client, "8905000000007", brand="Normal")
    await _seed_lot(
        receiver_client,
        owner_client,
        items=[("8905000000006", 8), ("8905000000007", 8)],
    )
    # Sensitive wants warning at <=20, so 8 is low.
    # Normal wants warning at <=10, so 8 is low too.
    sens_id = (
        await db_session.execute(
            select(Product).where(Product.barcode == "8905000000006")
        )
    ).scalar_one().id
    await owner_client.patch(
        f"/products/{sens_id}", json={"low_stock_threshold": 20}
    )

    resp = await owner_client.get("/dashboard/low-stock")
    items = resp.json()["items"]
    by_barcode = {it["barcode"]: it for it in items}
    assert "8905000000006" in by_barcode
    assert "8905000000007" in by_barcode
    assert by_barcode["8905000000006"]["effective_threshold"] == 20
    assert by_barcode["8905000000007"]["effective_threshold"] == 10


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_list_sorted_most_urgent_first(
    owner_client: AsyncClient, receiver_client: AsyncClient, db_session
) -> None:
    await db_session.execute(
        update(Shop).where(Shop.id == 1).values(low_stock_threshold_default=10)
    )
    await db_session.commit()
    for bc in ("8905000000008", "8905000000009", "8905000000010"):
        await _seed_product(owner_client, bc, brand=bc[-4:])
    await _seed_lot(
        receiver_client,
        owner_client,
        items=[("8905000000008", 1), ("8905000000009", 5), ("8905000000010", 9)],
    )

    resp = await owner_client.get("/dashboard/low-stock")
    items = resp.json()["items"]
    stocks = [it["current_stock"] for it in items]
    assert stocks == sorted(stocks)


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_receiver_can_view_low_stock(
    owner_client: AsyncClient, receiver_client: AsyncClient, db_session
) -> None:
    await db_session.execute(
        update(Shop).where(Shop.id == 1).values(low_stock_threshold_default=5)
    )
    await db_session.commit()
    await _seed_product(owner_client, "8905000000011", brand="Z")
    await _seed_lot(receiver_client, owner_client, items=[("8905000000011", 2)])

    # The receiver needs to see what to order.
    resp = await receiver_client.get("/dashboard/low-stock")
    assert resp.status_code == 200
    assert len(resp.json()["items"]) == 1


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_low_stock_inactive_products_excluded(
    owner_client: AsyncClient, receiver_client: AsyncClient, db_session
) -> None:
    await db_session.execute(
        update(Shop).where(Shop.id == 1).values(low_stock_threshold_default=5)
    )
    await db_session.commit()
    await _seed_product(owner_client, "8905000000012", brand="Z")
    await _seed_lot(receiver_client, owner_client, items=[("8905000000012", 2)])
    # Deactivate the product.
    product = (
        await db_session.execute(
            select(Product).where(Product.barcode == "8905000000012")
        )
    ).scalar_one()
    product.is_active = False
    await db_session.commit()

    resp = await owner_client.get("/dashboard/low-stock")
    assert resp.json()["items"] == []
