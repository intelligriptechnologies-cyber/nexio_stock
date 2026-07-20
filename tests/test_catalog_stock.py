"""Issue #40 — Catalog list response carries per-product stock counts.

Contract under test (R-v3-4, AC):
  - GET /products returns accurate current_stock per product for a
    shop with known lots/invoices.
  - The value matches the dashboard's low-stock list value for the
    same product — single source of truth = compute_derived_stock.
"""
from __future__ import annotations

import uuid

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
    receiver_client: AsyncClient, owner_client: AsyncClient, *, items: list[tuple[str, int]]
) -> None:
    resp = await receiver_client.post(
        "/lots",
        json={"lines": [{"barcode": bc, "quantity": q} for bc, q in items]},
    )
    assert resp.status_code == 201, resp.text
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
    resp = await cashier_client.post(
        "/checkout/finalize",
        headers={"Idempotency-Key": f"k-{uuid.uuid4().hex}"},
        json={
            "lines": [{"barcode": barcode, "quantity": quantity}],
            "payments": [{"mode": "cash", "amount": amount}],
        },
    )
    assert resp.status_code == 201, resp.text


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_product_list_carries_current_stock(
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
    cashier_client: AsyncClient,
) -> None:
    # Seed 3 products with known stock state.
    await _seed_product(owner_client, "8903000000050")  # never received
    await _seed_product(owner_client, "8903000000051")  # received 5, sold 1 = 4
    await _seed_product(owner_client, "8903000000052")  # received 10, sold 3 = 7

    await _seed_lot(
        receiver_client,
        owner_client,
        items=[("8903000000051", 5), ("8903000000052", 10)],
    )
    await _finalize(
        cashier_client, barcode="8903000000051", quantity=1, amount="100.00"
    )
    await _finalize(
        cashier_client, barcode="8903000000052", quantity=3, amount="300.00"
    )

    resp = await owner_client.get("/products?active_only=false&limit=500")
    assert resp.status_code == 200
    rows = resp.json()
    by_barcode = {p["barcode"]: p for p in rows}

    # 0050: never received, never sold -> 0.
    assert by_barcode["8903000000050"]["current_stock"] == 0
    # 0051: 5 received - 1 sold = 4.
    assert by_barcode["8903000000051"]["current_stock"] == 4
    # 0052: 10 received - 3 sold = 7.
    assert by_barcode["8903000000052"]["current_stock"] == 7


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_catalog_stock_matches_dashboard_low_stock(
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
) -> None:
    """Single source of truth: the catalog column value must equal the
    dashboard's low-stock-list value for the same product."""
    # Set a per-product threshold so the low-stock list includes it.
    resp = await owner_client.post(
        "/products",
        json={
            "barcode": "8903000000053",
            "brand": "LowMatch",
            "size_label": "750ml",
            "price": "100.00",
            "low_stock_threshold": 100,  # anything below 100 shows up as low
        },
    )
    assert resp.status_code == 201, resp.text
    product_id = resp.json()["id"]

    await _seed_lot(receiver_client, owner_client, items=[("8903000000053", 10)])

    # Catalog endpoint value.
    catalog = await owner_client.get("/products?active_only=false")
    catalog_row = next(
        p for p in catalog.json() if p["id"] == product_id
    )

    # Dashboard endpoint value (low-stock list).
    dashboard = await owner_client.get("/dashboard/low-stock")
    assert dashboard.status_code == 200
    low_stock_rows = dashboard.json()["items"]
    matching = next(
        (r for r in low_stock_rows if r["product_id"] == product_id),
        None,
    )
    assert matching is not None, "low-stock list should include the product"
    assert catalog_row["current_stock"] == matching["current_stock"]


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_product_lookup_returns_current_stock(
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
) -> None:
    """The single-product lookup endpoint also carries current_stock
    (so the cashier's scanner-cache miss path shows the same number)."""
    await _seed_product(owner_client, "8903000000054")
    await _seed_lot(receiver_client, owner_client, items=[("8903000000054", 6)])

    resp = await owner_client.get("/products/lookup?barcode=8903000000054")
    assert resp.status_code == 200
    assert resp.json()["current_stock"] == 6
