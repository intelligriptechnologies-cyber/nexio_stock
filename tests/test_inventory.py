"""Issue #43 — Inventory page backend: /inventory/lots endpoint.

Contracts under test (R-v3-7, R-v3-8, R-v3-16):
  - Endpoint reachable by all three shop-scoped roles (owner,
    receiver, cashier) and superadmin — receiver/cashier should not
    be excluded.
  - Single-shop-scoped caller (e.g. receiver) sees only their own
    shop's lot history with no picker required.
  - Superadmin-with-no-shop-picked is rejected by the existing
    resolve_read_shop_id guard (the superadmin must pick a shop
    before reading).
  - Each row carries (lot #, received_at, received_by_user_id,
    received_by_name, total_quantity) — the lean LotSummary shape.
  - total_quantity is the SUM of all line quantities on that lot.
"""
from __future__ import annotations

import pytest
from httpx import AsyncClient


async def _seed_product(
    client: AsyncClient, barcode: str, *, price: str = "100.00"
) -> None:
    resp = await client.post(
        "/products",
        json={"barcode": barcode, "brand": "X", "size_label": "750ml", "price": price},
    )
    assert resp.status_code == 201, resp.text


async def _seed_lot(
    receiver_client: AsyncClient, *, items: list[tuple[str, int]]
) -> dict:
    resp = await receiver_client.post(
        "/lots",
        json={"lines": [{"barcode": bc, "quantity": q} for bc, q in items]},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_cashier_can_read_inventory_lots(
    cashier_client: AsyncClient,
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
) -> None:
    """Per R-v3-13, cashier_user must be able to read the Inventory
    page (and the lot history is part of it)."""
    await _seed_product(owner_client, "8903000000070")
    await _seed_lot(receiver_client, items=[("8903000000070", 8)])

    resp = await cashier_client.get("/inventory/lots")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "lots" in body
    assert "evaluated_at" in body
    assert len(body["lots"]) == 1
    row = body["lots"][0]
    assert row["total_quantity"] == 8
    assert row["received_by_name"]  # non-empty
    assert "received_at" in row


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_receiver_can_read_inventory_lots(
    receiver_client: AsyncClient,
    owner_client: AsyncClient,
) -> None:
    await _seed_product(owner_client, "8903000000071")
    await _seed_lot(receiver_client, items=[("8903000000071", 5)])

    resp = await receiver_client.get("/inventory/lots")
    assert resp.status_code == 200
    rows = resp.json()["lots"]
    assert len(rows) == 1
    assert rows[0]["total_quantity"] == 5


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_owner_can_read_inventory_lots(
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
) -> None:
    await _seed_product(owner_client, "8903000000072")
    await _seed_lot(receiver_client, items=[("8903000000072", 3)])

    resp = await owner_client.get("/inventory/lots")
    assert resp.status_code == 200
    rows = resp.json()["lots"]
    assert len(rows) == 1


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_superadmin_without_picker_is_rejected(
    superadmin_client: AsyncClient,
) -> None:
    """A superadmin who hasn't picked a shop gets the same
    resolve_read_shop_id guard as every other dashboard read."""
    resp = await superadmin_client.get("/inventory/lots")
    assert resp.status_code in (400, 404)


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_total_quantity_sums_multiple_lines(
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
) -> None:
    """A lot with multiple lines should report the sum of quantities."""
    await _seed_product(owner_client, "8903000000073")
    await _seed_product(owner_client, "8903000000074")
    lot = await _seed_lot(
        receiver_client,
        items=[("8903000000073", 4), ("8903000000074", 7)],
    )

    resp = await owner_client.get("/inventory/lots")
    assert resp.status_code == 200
    matching = next(r for r in resp.json()["lots"] if r["id"] == lot["id"])
    assert matching["total_quantity"] == 11


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_receiver_sees_only_their_own_shop_lots(
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
    cashier_client: AsyncClient,
    db_session,
) -> None:
    """Single-shop role sees only their own shop's data — the
    absence of a shop-picker for them is the implicit guarantee."""
    # Lot in shop #1 (the default fixture shop).
    await _seed_product(owner_client, "8903000000075")
    await _seed_lot(receiver_client, items=[("8903000000075", 6)])

    # Provision a second shop directly and seed a lot there.
    from app.models.lot import Lot, LotLine
    from app.models.shop import Shop

    shop2 = Shop(
        name="Second Shop",
        code="SECOND-2-INV",
        low_stock_threshold_default=5,
        last_invoice_number=0,
    )
    db_session.add(shop2)
    await db_session.commit()
    await db_session.refresh(shop2)

    await _seed_product(owner_client, "8903000000076")
    product2 = None
    # Find the just-created product id.
    resp = await owner_client.get("/products?active_only=false")
    for p in resp.json():
        if p["barcode"] == "8903000000076":
            product2 = p["id"]
            break
    lot2 = Lot(shop_id=shop2.id, received_by_user_id=2)
    db_session.add(lot2)
    await db_session.commit()
    await db_session.refresh(lot2)
    db_session.add(LotLine(lot_id=lot2.id, product_id=product2, quantity=4))
    await db_session.commit()

    # Cashier (in shop #1) sees only the shop-1 lot.
    resp = await cashier_client.get("/inventory/lots")
    assert resp.status_code == 200
    rows = resp.json()["lots"]
    assert len(rows) == 1
    assert rows[0]["total_quantity"] == 6