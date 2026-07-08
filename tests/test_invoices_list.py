"""Issue #44 — Invoices list endpoint (R-v3-9, R-v3-15, D-v3-6, D-v3-15).

Contracts under test:
  - Endpoint exists at GET /invoices.
  - Returns paginated results with total/page/limit in the envelope.
  - Role-scoping (R-v3-15): cashier/receiver see only invoices they
    personally created; owner sees all in their shop.
  - Filters: date range, signed-off status, cashier filter (for owner)
    narrow correctly.
  - Pagination correctness: page 2 returns the next slice, not a
    repeat.
"""
from __future__ import annotations

import uuid
from datetime import date, timedelta

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
) -> None:
    resp = await receiver_client.post(
        "/lots",
        json={"lines": [{"barcode": bc, "quantity": q} for bc, q in items]},
    )
    assert resp.status_code == 201, resp.text


async def _finalize(
    cashier_client: AsyncClient, *, barcode: str, quantity: int = 1
) -> dict:
    resp = await cashier_client.post(
        "/checkout/finalize",
        headers={"Idempotency-Key": f"k-{uuid.uuid4().hex}"},
        json={
            "lines": [{"barcode": barcode, "quantity": quantity}],
            "payments": [{"mode": "cash", "amount": f"{100.00 * quantity:.2f}"}],
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["invoice"]


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_owner_sees_all_invoices_in_shop(
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
    cashier_client: AsyncClient,
) -> None:
    await _seed_product(owner_client, "8903000000080")
    await _seed_lot(receiver_client, items=[("8903000000080", 5)])
    inv1 = await _finalize(cashier_client, barcode="8903000000080", quantity=1)
    inv2 = await _finalize(cashier_client, barcode="8903000000080", quantity=2)

    resp = await owner_client.get("/invoices")
    assert resp.status_code == 200
    body = resp.json()
    ids = {r["id"] for r in body["invoices"]}
    assert inv1["id"] in ids
    assert inv2["id"] in ids
    assert body["total"] >= 2


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_cashier_only_sees_their_own_invoices(
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
    cashier_client: AsyncClient,
    db_session,
) -> None:
    """R-v3-15 — cashier_user sees only invoices they personally
    created. Other cashiers' invoices must not appear."""
    await _seed_product(owner_client, "8903000000081")
    await _seed_lot(receiver_client, items=[("8903000000081", 5)])
    inv = await _finalize(cashier_client, barcode="8903000000081")

    # Insert an "other cashier" invoice directly with a different
    # cashier_user_id, bypassing the API path.
    from app.models.invoice import (
        Invoice,
        InvoiceStatus,
    )
    from app.models.user import User, UserRole
    from sqlalchemy import select

    other_cashier = User(
        username="other_cashier",
        full_name="Other Cashier",
        phone="9999999999",
        password_hash="x",
        role=UserRole.CASHIER_USER,
        shop_id=1,
        is_active=True,
    )
    db_session.add(other_cashier)
    await db_session.commit()
    await db_session.refresh(other_cashier)

    other_inv = Invoice(
        shop_id=1,
        cashier_user_id=other_cashier.id,
        invoice_number=99999,
        status=InvoiceStatus.FINALIZED,
        total_amount="100.00",
    )
    db_session.add(other_inv)
    await db_session.commit()
    await db_session.refresh(other_inv)

    resp = await cashier_client.get("/invoices")
    assert resp.status_code == 200
    body = resp.json()
    ids = {r["id"] for r in body["invoices"]}
    assert inv["id"] in ids
    assert other_inv.id not in ids, "cashier must not see other cashiers' invoices"


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_pagination_returns_distinct_pages(
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
    cashier_client: AsyncClient,
) -> None:
    """Page 2 returns the next slice, not a repeat of page 1."""
    await _seed_product(owner_client, "8903000000082")
    await _seed_lot(receiver_client, items=[("8903000000082", 10)])
    # Create 3 invoices.
    for _ in range(3):
        await _finalize(cashier_client, barcode="8903000000082", quantity=1)

    p1 = await owner_client.get("/invoices?page=1&limit=2")
    p2 = await owner_client.get("/invoices?page=2&limit=2")
    assert p1.status_code == 200
    assert p2.status_code == 200

    body1 = p1.json()
    body2 = p2.json()
    assert body1["limit"] == 2
    assert body2["limit"] == 2
    assert body1["page"] == 1
    assert body2["page"] == 2

    ids1 = {r["id"] for r in body1["invoices"]}
    ids2 = {r["id"] for r in body2["invoices"]}
    assert ids1.isdisjoint(ids2), "page 2 must not overlap page 1"


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_signed_off_filter(
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
    cashier_client: AsyncClient,
) -> None:
    await _seed_product(owner_client, "8903000000083")
    await _seed_lot(receiver_client, items=[("8903000000083", 5)])
    inv = await _finalize(cashier_client, barcode="8903000000083")

    # Pre-mutation: signed_off is False.
    pre = await owner_client.get("/invoices?signed_off=false&limit=200")
    assert pre.status_code == 200, pre.text
    pre_ids = {r["id"] for r in pre.json()["invoices"]}
    assert inv["id"] in pre_ids
    signed_off_pre = await owner_client.get("/invoices?signed_off=true&limit=200")
    assert inv["id"] not in {r["id"] for r in signed_off_pre.json()["invoices"]}

    # Sign off the day — invoice should now appear under signed_off=true.
    today = date.today().isoformat()
    so = await owner_client.post(
        "/dashboard/eod/sign-off", json={"business_date": today}
    )
    assert so.status_code == 201

    post = await owner_client.get("/invoices?signed_off=true&limit=200")
    post_ids = {r["id"] for r in post.json()["invoices"]}
    assert inv["id"] in post_ids


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_cashier_filter_for_owner(
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
    cashier_client: AsyncClient,
) -> None:
    """Owner can filter invoices by cashier_user_id."""
    await _seed_product(owner_client, "8903000000084")
    await _seed_lot(receiver_client, items=[("8903000000084", 5)])
    inv = await _finalize(cashier_client, barcode="8903000000084")

    # Without filter — invoice appears.
    all_resp = await owner_client.get("/invoices?limit=200")
    assert inv["id"] in {r["id"] for r in all_resp.json()["invoices"]}

    # Filter to a non-existent cashier — invoice should not appear.
    none = await owner_client.get("/invoices?cashier_user_id=99999")
    assert inv["id"] not in {r["id"] for r in none.json()["invoices"]}

    # Filter to the actual cashier — invoice should appear.
    me = await owner_client.get(
        f"/invoices?cashier_user_id={inv['cashier_user_id']}"
    )
    assert inv["id"] in {r["id"] for r in me.json()["invoices"]}


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_date_range_filter(
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
    cashier_client: AsyncClient,
) -> None:
    """from_date / to_date filters narrow the result by finalized_at."""
    await _seed_product(owner_client, "8903000000085")
    await _seed_lot(receiver_client, items=[("8903000000085", 5)])
    await _finalize(cashier_client, barcode="8903000000085")

    today = date.today().isoformat()
    yesterday = (date.today() - timedelta(days=1)).isoformat()
    far_past = (date.today() - timedelta(days=30)).isoformat()

    # Window covering today — invoice appears.
    today_resp = await owner_client.get(
        f"/invoices?from_date={today}&to_date={today}&limit=200"
    )
    assert len(today_resp.json()["invoices"]) >= 1

    # Window 30 days ago to yesterday — invoice should NOT appear.
    past_resp = await owner_client.get(
        f"/invoices?from_date={far_past}&to_date={yesterday}&limit=200"
    )
    assert all(
        r["id"] != (today_resp.json()["invoices"][0]["id"])
        for r in past_resp.json()["invoices"]
    )