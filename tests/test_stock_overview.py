"""Issue #41 — Dashboard cross-shop stock overview endpoint.

Contracts under test (R-v3-5, D-v3-5, AC):
  - Endpoint is owner/superadmin-only (receiver/cashier rejected).
  - Returns stock per product, grouped by shop, across every shop the
    caller is authorized to see.
  - Single-shop owner sees just their own shop's group.
"""
from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession


# --- helpers (kept local; the project uses small per-file helpers) ---


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
) -> None:
    resp = await receiver_client.post(
        "/lots",
        json={"lines": [{"barcode": bc, "quantity": q} for bc, q in items]},
    )
    assert resp.status_code == 201, resp.text


async def _finalize(
    cashier_client: AsyncClient,
    *,
    barcode: str,
    quantity: int,
    amount: str,
) -> None:
    resp = await cashier_client.post(
        "/checkout/finalize",
        headers={"Idempotency-Key": f"k-{uuid.uuid4().hex}"},
        json={
            "lines": [{"barcode": barcode, "quantity": quantity}],
            "payments": [{"mode": "cash", "amount": amount}],
        },
    )
    assert resp.status_code == 201, resp.text


# --- tests ---


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_owner_sees_their_own_shop(
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
    cashier_client: AsyncClient,
) -> None:
    """An owner of a single shop gets exactly one shop group in the
    response, scoped to their shop_id."""
    await _seed_product(owner_client, "8903000000060")
    await _seed_lot(receiver_client, items=[("8903000000060", 5)])
    await _finalize(
        cashier_client, barcode="8903000000060", quantity=1, amount="100.00"
    )

    resp = await owner_client.get("/dashboard/stock-overview")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body["shops"]) == 1
    shop_group = body["shops"][0]
    assert shop_group["shop_id"] == 1
    assert shop_group["shop_name"]
    by_barcode = {it["barcode"]: it for it in shop_group["items"]}
    assert by_barcode["8903000000060"]["current_stock"] == 4
    assert "evaluated_at" in body


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_receiver_is_forbidden(receiver_client: AsyncClient) -> None:
    """Receiver/cashier must NOT see the cross-shop view — that's
    owner/superadmin only (per AC: 'owner/superadmin-gated')."""
    resp = await receiver_client.get("/dashboard/stock-overview")
    assert resp.status_code == 403


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_cashier_is_forbidden(cashier_client: AsyncClient) -> None:
    resp = await cashier_client.get("/dashboard/stock-overview")
    assert resp.status_code == 403


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_superadmin_sees_every_shop_with_correct_groupings(
    superadmin_client: AsyncClient,
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """A superadmin caller sees EVERY shop with correct per-shop stock
    groupings. Provisions a second shop directly to assert the cross-
    shop shape with two non-overlapping product sets."""
    # Shop #1: existing fixture shop. Seed a known product + stock.
    await _seed_product(owner_client, "8903000000061")
    await _seed_lot(receiver_client, items=[("8903000000061", 7)])

    # Provision a second shop directly via the model layer (D-58 shop
    # provisioning flow isn't built yet, but for this test the row
    # just needs to exist).
    from app.models.lot import Lot, LotLine
    from app.models.shop import Shop

    shop2 = Shop(
        name="Second Shop",
        code="SECOND-2",
        low_stock_threshold_default=5,
        last_invoice_number=0,
    )
    db_session.add(shop2)
    await db_session.commit()
    await db_session.refresh(shop2)

    # Seed a product in shop #2 via the superadmin API (D-65).
    resp = await superadmin_client.post(
        "/products",
        json={
            "barcode": "8903000000062",
            "brand": "X2",
            "size_label": "750ml",
            "price": "100.00",
            "shop_id": shop2.id,
        },
    )
    assert resp.status_code == 201, resp.text
    product2_id = resp.json()["id"]

    # Receive 12 units directly via the model (receiver-in-shop-2 isn't
    # set up in conftest fixtures).
    lot2 = Lot(shop_id=shop2.id, received_by_user_id=2)
    db_session.add(lot2)
    await db_session.commit()
    await db_session.refresh(lot2)
    db_session.add(LotLine(lot_id=lot2.id, product_id=product2_id, quantity=12))
    await db_session.commit()

    resp = await superadmin_client.get("/dashboard/stock-overview")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["shops"]) == 2

    by_shop_id = {g["shop_id"]: g for g in body["shops"]}

    # Shop #1 has product 0061 with stock 7; shop #2 has 0062 with 12.
    s1_items = {it["barcode"]: it for it in by_shop_id[1]["items"]}
    assert s1_items["8903000000061"]["current_stock"] == 7

    s2_items = {it["barcode"]: it for it in by_shop_id[shop2.id]["items"]}
    assert s2_items["8903000000062"]["current_stock"] == 12


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_endpoint_independent_of_low_stock(
    owner_client: AsyncClient,
) -> None:
    """D-v3-5 — the new endpoint is independent of /dashboard/low-stock.
    Smoke check: the response shape carries ``shops`` (grouped) rather
    than the flat ``items`` list that low-stock returns."""
    resp = await owner_client.get("/dashboard/stock-overview")
    assert resp.status_code == 200
    body = resp.json()
    assert "shops" in body
    assert "evaluated_at" in body
    # And the low-stock endpoint still returns the old shape.
    low = await owner_client.get("/dashboard/low-stock")
    assert low.status_code == 200
    low_body = low.json()
    assert "items" in low_body
    assert "shops" not in low_body
