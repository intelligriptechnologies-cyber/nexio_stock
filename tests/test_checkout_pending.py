"""Issue #26 — Checkout quick-add + blocked-pending-line handling.

Tests mirror the issue ACs. Each AC is asserted via the FastAPI HTTP
seam (no internal function calls).
"""
from __future__ import annotations

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.db import get_sessionmaker
from app.models.log import InvoicingLog, StockinLog


async def _quick_add(
    client: AsyncClient,
    barcode: str,
    brand: str,
    size: str,
    *,
    idem: str,
    origin: str = "receiving",
) -> dict:
    resp = await client.post(
        "/products/quick-add",
        json={"barcode": barcode, "brand": brand, "size_label": size},
        headers={"Idempotency-Key": idem, "X-Quick-Add-Origin": origin},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _create_active_product(client: AsyncClient, barcode: str, price: str = "100.00") -> dict:
    resp = await client.post(
        "/products",
        json={
            "barcode": barcode,
            "brand": "Test Brand",
            "size_label": "750ml",
            "price": price,
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _receive_lot(
    receiver_client: AsyncClient, owner_client: AsyncClient, barcode: str, quantity: int
) -> None:
    resp = await receiver_client.post(
        "/lots",
        json={"lines": [{"barcode": barcode, "quantity": quantity}]},
    )
    assert resp.status_code == 201, resp.text
    inward_id = resp.json()["id"]
    approved = await owner_client.post(f"/lots/{inward_id}/approve")
    assert approved.status_code == 200, approved.text


# --- AC #1 — checkout screen offers the same quick-add action as receiving.


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_checkout_quick_add_creates_pending_product(
    cashier_client: AsyncClient,
) -> None:
    """AC #1: cashier can quick-add at checkout; the resulting product
    is status='pending' (the cashier can't sell it until the owner
    prices it)."""
    resp = await cashier_client.post(
        "/products/quick-add",
        json={"barcode": "8900000000600", "brand": "CO1", "size_label": "750ml"},
        headers={
            "Idempotency-Key": "qa26-1",
            "X-Quick-Add-Origin": "checkout",
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["status"] == "pending"
    assert body["price"] is None


# --- AC #2 — a cart line resolving to a pending product is blocked.


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_finalize_rejects_cart_with_pending_product(
    owner_client: AsyncClient, cashier_client: AsyncClient, receiver_client: AsyncClient
) -> None:
    """AC #2: a cart that includes a pending product fails the whole
    finalize with a specific error code; the rest of the sale cannot
    proceed (D-v2-7)."""
    # Create one active product + receive stock for it.
    active = await _create_active_product(owner_client, "8900000000610", price="200.00")
    await _receive_lot(receiver_client, owner_client, active["barcode"], 5)

    # Create a pending product via quick-add at checkout.
    await _quick_add(
        cashier_client,
        "8900000000611",
        "Pending CO",
        "750ml",
        idem="qa26-2",
        origin="checkout",
    )

    # Try to finalize a cart containing BOTH lines.
    resp = await cashier_client.post(
        "/checkout/finalize",
        json={
            "lines": [
                {"barcode": active["barcode"], "quantity": 1},
                {"barcode": "8900000000611", "quantity": 1},
            ],
            "payments": [{"mode": "cash", "amount": "200.00"}],
        },
        headers={"Idempotency-Key": "ck26-2"},
    )
    assert resp.status_code == 400, resp.text
    detail = resp.json()["detail"]
    # The error code is the agreed-upon marker the cashier UI keys on.
    assert detail.get("code") == "pending_product_in_cart"
    assert "8900000000611" in detail.get("message", "")


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_finalize_with_only_pending_product_also_rejected(
    owner_client: AsyncClient, cashier_client: AsyncClient
) -> None:
    """A cart of ONLY a pending product is still rejected -- there's no
    'remove the bad line and try again' shortcut for the cashier to
    bypass it; they have to actually rescan the cart."""
    await _quick_add(
        cashier_client,
        "8900000000612",
        "Pending Only",
        "750ml",
        idem="qa26-3",
        origin="checkout",
    )
    resp = await cashier_client.post(
        "/checkout/finalize",
        json={
            "lines": [{"barcode": "8900000000612", "quantity": 1}],
            "payments": [{"mode": "cash", "amount": "0.01"}],
        },
        headers={"Idempotency-Key": "ck26-3"},
    )
    assert resp.status_code == 400
    assert resp.json()["detail"].get("code") == "pending_product_in_cart"


# --- AC #3 — invoicing_logs gets a product.pending_created entry when triggered from checkout.


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_checkout_quick_add_writes_invoicing_log_entry(
    cashier_client: AsyncClient,
) -> None:
    """AC #3: X-Quick-Add-Origin=checkout routes the audit-log entry
    to invoicing_logs (D-v2-13)."""
    resp = await cashier_client.post(
        "/products/quick-add",
        json={"barcode": "8900000000620", "brand": "LogCO", "size_label": "750ml"},
        headers={"Idempotency-Key": "qa26-log", "X-Quick-Add-Origin": "checkout"},
    )
    assert resp.status_code == 201
    pid = resp.json()["id"]

    Session = get_sessionmaker()
    async with Session() as session:
        # Must be on invoicing_logs.
        row = (
            await session.execute(
                select(InvoicingLog).where(
                    InvoicingLog.event_type == "product.pending_created",
                )
            )
        ).scalars().one()
        assert row.payload["product_id"] == pid
        assert row.payload["origin"] == "checkout"
        assert row.payload["barcode"] == "8900000000620"

        # Must NOT be on stockin_logs.
        count = (
            await session.execute(
                select(StockinLog).where(
                    StockinLog.event_type == "product.pending_created",
                )
            )
        ).scalars().all()
        # The pre-existing #22 tests may have left rows in stockin_logs;
        # the assertion is just that THIS product_id doesn't appear there.
        assert not any(r.payload.get("product_id") == pid for r in count)


# --- AC #4 — pending-then-activated product still has zero stock until a Lot is received.


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_checkout_created_pending_product_has_zero_stock_after_activation(
    owner_client: AsyncClient, cashier_client: AsyncClient, receiver_client: AsyncClient
) -> None:
    """AC #4: even after the owner sets a price and flips status to
    active, the product cannot be sold until an actual Lot is
    received. The stock-from-lots invariant (D-17) gives 0 stock with
    no Lot, so finalize would fail with insufficient_stock."""
    # 1. Cashier quick-adds at checkout.
    pending = await _quick_add(
        cashier_client,
        "8900000000630",
        "Zero Stock",
        "750ml",
        idem="qa26-zero-1",
        origin="checkout",
    )
    pid = pending["id"]

    # 2. Owner activates.
    resp = await owner_client.post(
        f"/products/{pid}/activate", json={"price": "150.00"}
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "active"

    # 3. Now the cashier tries to finalize a cart containing this
    # product -- should fail with insufficient_stock (no Lot yet).
    resp = await cashier_client.post(
        "/checkout/finalize",
        json={
            "lines": [{"barcode": "8900000000630", "quantity": 1}],
            "payments": [{"mode": "cash", "amount": "150.00"}],
        },
        headers={"Idempotency-Key": "ck26-zero"},
    )
    assert resp.status_code == 409, resp.text
    assert resp.json()["detail"].get("code") == "insufficient_stock"

    # 4. After receiving a Lot, the same cart succeeds.
    await _receive_lot(receiver_client, owner_client, "8900000000630", 3)
    resp = await cashier_client.post(
        "/checkout/finalize",
        json={
            "lines": [{"barcode": "8900000000630", "quantity": 1}],
            "payments": [{"mode": "cash", "amount": "150.00"}],
        },
        headers={"Idempotency-Key": "ck26-zero-after-lot"},
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["invoice"]["status"] == "finalized"


# --- AC #5 — backend pytest coverage (this file IS the coverage).


# --- AC #6 — frontend e2e coverage is added to the existing
# checkout.spec.ts (deferred to the e2e harness that needs a running
# backend; build + lint are the standing-runs fallback).


# --- Edge cases: pending product discovered AFTER it's in the cart (backend safety net).


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_active_product_in_cart_still_succeeds(
    owner_client: AsyncClient, cashier_client: AsyncClient, receiver_client: AsyncClient
) -> None:
    """Sanity check: the new pending_product_in_cart check doesn't
    affect normal finalize paths."""
    active = await _create_active_product(owner_client, "8900000000640", price="50.00")
    await _receive_lot(receiver_client, owner_client, active["barcode"], 3)
    resp = await cashier_client.post(
        "/checkout/finalize",
        json={
            "lines": [{"barcode": active["barcode"], "quantity": 1}],
            "payments": [{"mode": "cash", "amount": "50.00"}],
        },
        headers={"Idempotency-Key": "ck26-active"},
    )
    assert resp.status_code == 201, resp.text


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_checkout_quick_add_conflict_returns_409(
    cashier_client: AsyncClient, owner_client: AsyncClient
) -> None:
    """Same as the receiving flow: same-barcode race returns 409 with a
    friendly detail. The cashier UI handles this the same way (close
    the modal and re-resolve)."""
    payload = {"barcode": "8900000000650", "brand": "X", "size_label": "750ml"}
    r1 = await cashier_client.post(
        "/products/quick-add",
        json=payload,
        headers={"Idempotency-Key": "qa26-conflict-1", "X-Quick-Add-Origin": "checkout"},
    )
    assert r1.status_code == 201

    r2 = await owner_client.post(
        "/products/quick-add",
        json=payload,
        headers={"Idempotency-Key": "qa26-conflict-2", "X-Quick-Add-Origin": "checkout"},
    )
    assert r2.status_code == 409
    assert "already exists" in r2.json()["detail"]


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_checkout_origin_log_in_payload(
    cashier_client: AsyncClient,
) -> None:
    """The log payload's origin field is 'checkout' for cashier
    quick-adds (so the owner can tell which screen the item came
    from when reviewing the Pending Products list)."""
    resp = await cashier_client.post(
        "/products/quick-add",
        json={"barcode": "8900000000660", "brand": "OrigCO", "size_label": "750ml"},
        headers={"Idempotency-Key": "qa26-orig", "X-Quick-Add-Origin": "checkout"},
    )
    assert resp.status_code == 201
    pid = resp.json()["id"]

    Session = get_sessionmaker()
    async with Session() as session:
        # Should appear in the pending list with origin='checkout'.
        # (Test the audit-log entry directly since the list endpoint
        # is exercised in #25 tests.)
        from sqlalchemy import select

        from app.models.log import InvoicingLog

        rows = (
            await session.execute(
                select(InvoicingLog).where(
                    InvoicingLog.event_type == "product.pending_created",
                )
            )
        ).scalars().all()
        matching = [r for r in rows if r.payload.get("product_id") == pid]
        assert len(matching) == 1
        assert matching[0].payload["origin"] == "checkout"
