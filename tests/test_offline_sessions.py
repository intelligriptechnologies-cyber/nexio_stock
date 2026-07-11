from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.offline_session import OfflineSession, OfflineSessionState
from app.models.shop import Shop

pytestmark = pytest.mark.asyncio


async def _create_product_and_stock(
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
    *,
    barcode: str = "8900000009001",
    quantity: int = 10,
) -> None:
    resp = await owner_client.post(
        "/products",
        json={
            "barcode": barcode,
            "brand": "Offline Test",
            "size_label": "750ml",
            "price": "100.00",
        },
    )
    assert resp.status_code == 201, resp.text
    resp = await receiver_client.post(
        "/lots",
        json={"lines": [{"barcode": barcode, "quantity": quantity}]},
    )
    assert resp.status_code == 201, resp.text


async def test_start_offline_session_returns_catalog_and_locks_writes(
    cashier_client: AsyncClient,
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
) -> None:
    await _create_product_and_stock(owner_client, receiver_client)

    start = await cashier_client.post("/offline-sessions/start", json={})
    assert start.status_code == 201, start.text
    body = start.json()
    assert body["session"]["state"] == "active"
    assert body["offline_token"]
    assert body["catalog"][0]["barcode"] == "8900000009001"
    assert body["catalog"][0]["current_stock"] == 10

    checkout = await cashier_client.post(
        "/checkout/finalize",
        headers={"Idempotency-Key": "online-while-offline"},
        json={
            "lines": [{"barcode": "8900000009001", "quantity": 1}],
            "payments": [{"mode": "cash", "amount": "100.00"}],
        },
    )
    assert checkout.status_code == 409
    assert checkout.json()["detail"]["code"] == "offline_session_active"

    lot = await receiver_client.post(
        "/lots",
        json={"lines": [{"barcode": "8900000009001", "quantity": 1}]},
    )
    assert lot.status_code == 409
    assert lot.json()["detail"]["code"] == "offline_session_active"


async def test_sync_offline_session_creates_official_invoice_and_unlocks(
    cashier_client: AsyncClient,
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
) -> None:
    await _create_product_and_stock(owner_client, receiver_client)
    start = await cashier_client.post("/offline-sessions/start", json={})
    session_id = start.json()["session"]["id"]
    offline_token = start.json()["offline_token"]

    sync = await cashier_client.post(
        f"/offline-sessions/{session_id}/sync",
        headers={"Authorization": f"Bearer {offline_token}"},
        json={
            "receipts": [
                {
                    "temp_receipt_id": f"OFF-{session_id}-0001",
                    "idempotency_key": f"offline-{session_id}-0001",
                    "lines": [{"barcode": "8900000009001", "quantity": 2}],
                    "payments": [{"mode": "cash", "amount": "200.00"}],
                    "created_at": datetime.now(UTC).isoformat(),
                }
            ]
        },
    )
    assert sync.status_code == 200, sync.text
    assert sync.json()["session"]["state"] == "synced"
    assert sync.json()["mappings"][0]["invoice_number"] == 1

    checkout = await cashier_client.post(
        "/checkout/finalize",
        headers={"Idempotency-Key": "after-sync"},
        json={
            "lines": [{"barcode": "8900000009001", "quantity": 1}],
            "payments": [{"mode": "cash", "amount": "100.00"}],
        },
    )
    assert checkout.status_code == 201, checkout.text
    assert checkout.json()["invoice"]["invoice_number"] == 2


async def test_sync_conflict_marks_session_failed_and_keeps_eod_locked(
    cashier_client: AsyncClient,
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    await _create_product_and_stock(owner_client, receiver_client, quantity=1)
    start = await cashier_client.post("/offline-sessions/start", json={})
    session_id = start.json()["session"]["id"]

    sync = await cashier_client.post(
        f"/offline-sessions/{session_id}/sync",
        json={
            "receipts": [
                {
                    "temp_receipt_id": f"OFF-{session_id}-0001",
                    "idempotency_key": f"offline-{session_id}-bad-stock",
                    "lines": [{"barcode": "8900000009001", "quantity": 2}],
                    "payments": [{"mode": "cash", "amount": "200.00"}],
                }
            ]
        },
    )
    assert sync.status_code == 409

    session = (
        await db_session.execute(
            select(OfflineSession).where(OfflineSession.id == session_id)
        )
    ).scalar_one()
    assert session.state == OfflineSessionState.FAILED
    assert session.failure_reason["code"] == "insufficient_stock"

    shop = (await db_session.execute(select(Shop))).scalar_one()
    eod = await owner_client.post(
        "/dashboard/eod/sign-off",
        json={"business_date": shop.current_business_date.isoformat()},
    )
    assert eod.status_code == 409
    assert eod.json()["detail"]["code"] == "offline_session_active"


async def test_cashier_can_extend_once_and_owner_can_discard(
    cashier_client: AsyncClient,
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
) -> None:
    await _create_product_and_stock(owner_client, receiver_client)
    start = await cashier_client.post("/offline-sessions/start", json={})
    session_id = start.json()["session"]["id"]

    extended = await cashier_client.post(f"/offline-sessions/{session_id}/extend")
    assert extended.status_code == 200, extended.text
    assert extended.json()["session"]["extension_count"] == 1

    second = await cashier_client.post(f"/offline-sessions/{session_id}/extend")
    assert second.status_code == 409
    assert second.json()["detail"]["code"] == "extension_used"

    discarded = await owner_client.post(
        f"/offline-sessions/{session_id}/discard",
        json={"reason": "cashier device lost connectivity and receipt batch is abandoned"},
    )
    assert discarded.status_code == 200, discarded.text
    assert discarded.json()["session"]["state"] == "discarded"


async def test_expired_session_releases_checkout_lock(
    cashier_client: AsyncClient,
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    await _create_product_and_stock(owner_client, receiver_client)
    start = await cashier_client.post("/offline-sessions/start", json={})
    session_id = start.json()["session"]["id"]

    session = (
        await db_session.execute(
            select(OfflineSession).where(OfflineSession.id == session_id)
        )
    ).scalar_one()
    session.expires_at = datetime.now(UTC) - timedelta(minutes=1)
    await db_session.commit()

    checkout = await cashier_client.post(
        "/checkout/finalize",
        headers={"Idempotency-Key": "after-expiry"},
        json={
            "lines": [{"barcode": "8900000009001", "quantity": 1}],
            "payments": [{"mode": "cash", "amount": "100.00"}],
        },
    )
    assert checkout.status_code == 201, checkout.text
