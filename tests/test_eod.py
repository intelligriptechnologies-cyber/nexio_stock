"""EOD sign-off + dashboard tests (R-26, R-44, D-32, D-36, D-63)."""
from __future__ import annotations

import uuid
from datetime import date, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.invoice import EodSignOff, Invoice, InvoiceStatus, PastInvoice
from app.models.shop import Shop

# --- helpers ---


async def _seed_product(client: AsyncClient, barcode: str) -> None:
    resp = await client.post(
        "/products",
        json={"barcode": barcode, "brand": "X", "size_label": "750ml", "price": "100.00"},
    )
    assert resp.status_code == 201, resp.text


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
    mode: str = "cash",
) -> dict:
    resp = await cashier_client.post(
        "/checkout/finalize",
        headers={"Idempotency-Key": f"k-{uuid.uuid4().hex}"},
        json={
            "lines": [{"barcode": barcode, "quantity": quantity}],
            "payments": [{"mode": mode, "amount": amount}],
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["invoice"]


# --- sign-off happy path ---


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_owner_signs_off_today(
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
    cashier_client: AsyncClient,
    db_session,
) -> None:
    await _seed_product(owner_client, "8903000000001")
    await _seed_lot(receiver_client, owner_client, items=[("8903000000001", 5)])
    await _finalize(cashier_client, barcode="8903000000001", quantity=1, amount="100.00")
    await _finalize(
        cashier_client, barcode="8903000000001", quantity=2, amount="200.00", mode="upi"
    )

    shop_before = (await db_session.execute(select(Shop))).scalar_one()
    today = date.today()
    resp = await owner_client.post(
        "/dashboard/eod/sign-off", json={"business_date": today.isoformat()}
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["invoices_signed_off"] == 2
    await db_session.refresh(shop_before)
    assert shop_before.current_business_date == today


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_double_sign_off_returns_409(
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
    cashier_client: AsyncClient,
) -> None:
    await _seed_product(owner_client, "8903000000002")
    await _seed_lot(receiver_client, owner_client, items=[("8903000000002", 5)])
    await _finalize(cashier_client, barcode="8903000000002", quantity=1, amount="100.00")

    today = date.today().isoformat()
    first = await owner_client.post(
        "/dashboard/eod/sign-off", json={"business_date": today}
    )
    assert first.status_code == 201
    second = await owner_client.post(
        "/dashboard/eod/sign-off", json={"business_date": today}
    )
    assert second.status_code == 409
    assert second.json()["detail"]["code"] == "already_signed_off"


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_future_date_rejected(
    owner_client: AsyncClient,
) -> None:
    future = (date.today() + timedelta(days=2)).isoformat()
    resp = await owner_client.post(
        "/dashboard/eod/sign-off", json={"business_date": future}
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "future_date"


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_cashier_cannot_sign_off(cashier_client: AsyncClient) -> None:
    today = date.today().isoformat()
    resp = await cashier_client.post(
        "/dashboard/eod/sign-off", json={"business_date": today}
    )
    assert resp.status_code == 403


# --- the post-EOD checkout gate ---


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_checkout_still_succeeds_after_eod_sign_off(
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
    cashier_client: AsyncClient,
) -> None:
    await _seed_product(owner_client, "8903000000003")
    await _seed_lot(receiver_client, owner_client, items=[("8903000000003", 5)])
    # Sign off the day.
    today = date.today().isoformat()
    so = await owner_client.post(
        "/dashboard/eod/sign-off", json={"business_date": today}
    )
    assert so.status_code == 201

    # New sales continue to use the live calendar date after archive-only sign-off.
    resp = await cashier_client.post(
        "/checkout/finalize",
        headers={"Idempotency-Key": f"k-{uuid.uuid4().hex}"},
        json={
            "lines": [{"barcode": "8903000000003", "quantity": 1}],
            "payments": [{"mode": "cash", "amount": "100.00"}],
        },
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["invoice"]["business_date"] == date.today().isoformat()


# --- totals / dashboard ---


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_eod_totals_for_signed_off_day(
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
    cashier_client: AsyncClient,
) -> None:
    await _seed_product(owner_client, "8903000000004")
    await _seed_lot(receiver_client, owner_client, items=[("8903000000004", 5)])
    await _finalize(cashier_client, barcode="8903000000004", quantity=1, amount="100.00", mode="cash")
    await _finalize(cashier_client, barcode="8903000000004", quantity=1, amount="100.00", mode="upi")

    today = date.today().isoformat()
    so = await owner_client.post(
        "/dashboard/eod/sign-off", json={"business_date": today}
    )
    assert so.status_code == 201

    totals = await owner_client.get(
        "/dashboard/eod-totals", params={"business_date": today}
    )
    assert totals.status_code == 200
    body = totals.json()
    assert body["signed_off"] is True
    assert body["invoice_count"] == 2
    assert body["revenue"] == "200.00"
    modes = {p["mode"]: p["amount"] for p in body["payments_by_mode"]}
    assert modes == {"cash": "100.00", "upi": "100.00"}


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_eod_totals_for_unsigned_day_returns_zero_signed_off_false(
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
    cashier_client: AsyncClient,
) -> None:
    await _seed_product(owner_client, "8903000000005")
    await _seed_lot(receiver_client, owner_client, items=[("8903000000005", 5)])
    await _finalize(cashier_client, barcode="8903000000005", quantity=1, amount="100.00")

    # Don't sign off; query totals for today.
    today = date.today().isoformat()
    totals = await owner_client.get(
        "/dashboard/eod-totals", params={"business_date": today}
    )
    body = totals.json()
    assert body["signed_off"] is False
    # Revenue/invoice_count still reflect the day's activity.
    assert body["invoice_count"] == 1
    assert body["revenue"] == "100.00"


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_eod_totals_excludes_voided_and_reversal_from_revenue(
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
    cashier_client: AsyncClient,
    db_session,
) -> None:
    """A direct-voided invoice should not contribute to the day's
    revenue, and a REVERSAL row should net out."""
    await _seed_product(owner_client, "8903000000006")
    await _seed_lot(receiver_client, owner_client, items=[("8903000000006", 5)])
    inv1 = await _finalize(cashier_client, barcode="8903000000006", quantity=1, amount="100.00")
    await _finalize(cashier_client, barcode="8903000000006", quantity=1, amount="100.00")
    # Owner direct-voids the first.
    await owner_client.post(f"/invoices/{inv1['id']}/void")

    today = date.today().isoformat()
    await owner_client.post(
        "/dashboard/eod/sign-off", json={"business_date": today}
    )

    totals = await owner_client.get(
        "/dashboard/eod-totals", params={"business_date": today}
    )
    body = totals.json()
    # Only the un-voided invoice counts.
    assert body["invoice_count"] == 1
    assert body["revenue"] == "100.00"
    assert body["voided_count"] == 1
    assert body["reversal_count"] == 0


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_eod_signoff_blocked_when_pending_void_exists(
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
    cashier_client: AsyncClient,
) -> None:
    await _seed_product(owner_client, "8903000000014")
    await _seed_lot(receiver_client, owner_client, items=[("8903000000014", 5)])
    inv = await _finalize(
        cashier_client, barcode="8903000000014", quantity=1, amount="100.00"
    )
    requested = await cashier_client.post(f"/invoices/{inv['id']}/void")
    assert requested.status_code == 200
    assert requested.json()["status"] == "pending_void"

    today = date.today().isoformat()
    resp = await owner_client.post(
        "/dashboard/eod/sign-off", json={"business_date": today}
    )
    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "pending_void_approvals_exist"


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_eod_totals_include_pending_void_as_revenue(
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
    cashier_client: AsyncClient,
    db_session,
) -> None:
    await _seed_product(owner_client, "8903000000015")
    await _seed_lot(receiver_client, owner_client, items=[("8903000000015", 5)])
    inv = await _finalize(
        cashier_client, barcode="8903000000015", quantity=1, amount="100.00"
    )
    await cashier_client.post(f"/invoices/{inv['id']}/void")

    row = (
        await db_session.execute(select(Invoice).where(Invoice.id == inv["id"]))
    ).scalar_one()
    assert row.status == InvoiceStatus.PENDING_VOID

    totals = await owner_client.get(
        "/dashboard/eod-totals", params={"business_date": date.today().isoformat()}
    )
    body = totals.json()
    assert body["invoice_count"] == 1
    assert body["revenue"] == "100.00"


# --- history ---


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_eod_history_lists_signoffs_in_descending_order(
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
    cashier_client: AsyncClient,
) -> None:
    await _seed_product(owner_client, "8903000000007")
    await _seed_lot(receiver_client, owner_client, items=[("8903000000007", 5)])
    await _finalize(cashier_client, barcode="8903000000007", quantity=1, amount="100.00")

    today = date.today().isoformat()
    yesterday = (date.today() - timedelta(days=1)).isoformat()
    await owner_client.post(
        "/dashboard/eod/sign-off", json={"business_date": yesterday}
    )
    await owner_client.post(
        "/dashboard/eod/sign-off", json={"business_date": today}
    )

    h = await owner_client.get("/dashboard/eod-history")
    assert h.status_code == 200
    body = h.json()
    assert len(body["signoffs"]) == 2
    # Descending by business_date.
    assert body["signoffs"][0]["business_date"].startswith(today)
    assert body["signoffs"][1]["business_date"].startswith(yesterday)


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_eod_history_filters_by_date_range(
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
    cashier_client: AsyncClient,
) -> None:
    await _seed_product(owner_client, "8903000000008")
    await _seed_lot(receiver_client, owner_client, items=[("8903000000008", 5)])
    await _finalize(cashier_client, barcode="8903000000008", quantity=1, amount="100.00")

    today = date.today()
    two_days_ago = today - timedelta(days=2)
    five_days_ago = today - timedelta(days=5)

    for d in (five_days_ago, two_days_ago, today):
        await owner_client.post(
            "/dashboard/eod/sign-off", json={"business_date": d.isoformat()}
        )

    h = await owner_client.get(
        "/dashboard/eod-history",
        params={
            "from_date": (today - timedelta(days=3)).isoformat(),
            "to_date": today.isoformat(),
        },
    )
    body = h.json()
    dates = [s["business_date"][:10] for s in body["signoffs"]]
    # Only today and two_days_ago; the 5-days-ago entry is filtered out.
    assert two_days_ago.isoformat() in dates
    assert today.isoformat() in dates
    assert five_days_ago.isoformat() not in dates


# --- void queue ---


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_void_queue_lists_pending_invoices(
    cashier_client: AsyncClient,
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
    db_session,
) -> None:
    await _seed_product(owner_client, "8903000000009")
    await _seed_lot(receiver_client, owner_client, items=[("8903000000009", 5)])
    inv = await _finalize(cashier_client, barcode="8903000000009", quantity=1, amount="100.00")
    # Mark signed-off + request void to make it PENDING_VOID.
    inv_row = (
        await db_session.execute(select(Invoice).where(Invoice.id == inv["id"]))
    ).scalar_one()
    inv_row.eod_signed_off = True
    await db_session.commit()
    await cashier_client.post(f"/invoices/{inv['id']}/void")

    q = await owner_client.get("/dashboard/void-queue")
    assert q.status_code == 200
    body = q.json()
    assert len(body["invoices"]) == 1
    assert body["invoices"][0]["id"] == inv["id"]
    assert body["invoices"][0]["status"] == "pending_void"


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_void_queue_excludes_resolved_voids(
    cashier_client: AsyncClient,
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
    db_session,
) -> None:
    await _seed_product(owner_client, "8903000000010")
    await _seed_lot(receiver_client, owner_client, items=[("8903000000010", 5)])
    inv = await _finalize(cashier_client, barcode="8903000000010", quantity=1, amount="100.00")
    inv_row = (
        await db_session.execute(select(Invoice).where(Invoice.id == inv["id"]))
    ).scalar_one()
    inv_row.eod_signed_off = True
    await db_session.commit()
    await cashier_client.post(f"/invoices/{inv['id']}/void")
    # Approve it — it should leave the queue.
    await owner_client.post(f"/invoices/{inv['id']}/void/approve")

    q = await owner_client.get("/dashboard/void-queue")
    assert q.json()["invoices"] == []


# --- eod_signoffs table ---


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_eod_signoff_record_persists(
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
    cashier_client: AsyncClient,
    db_session,
) -> None:
    await _seed_product(owner_client, "8903000000011")
    await _seed_lot(receiver_client, owner_client, items=[("8903000000011", 5)])
    await _finalize(cashier_client, barcode="8903000000011", quantity=1, amount="100.00")
    await owner_client.post(
        "/dashboard/eod/sign-off", json={"business_date": date.today().isoformat()}
    )
    rows = (await db_session.execute(select(EodSignOff))).scalars().all()
    assert len(rows) == 1
    assert rows[0].invoices_signed_off == 1


@pytest.mark.usefixtures("owner", "receiver", "cashier", "superadmin")
async def test_superadmin_signoff_with_shop_id_archives_current_invoices_and_notes(
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
    cashier_client: AsyncClient,
    superadmin_client: AsyncClient,
    db_session,
    shop,
) -> None:
    await _seed_product(owner_client, "8903000000013")
    await _seed_lot(receiver_client, owner_client, items=[("8903000000013", 5)])
    inv = await _finalize(
        cashier_client,
        barcode="8903000000013",
        quantity=1,
        amount="100.00",
        mode="card",
    )

    today = date.today().isoformat()
    resp = await superadmin_client.post(
        "/dashboard/eod/sign-off",
        json={
            "business_date": today,
            "shop_id": shop.id,
            "notes": "Reviewed cash/card settlement at counter.",
        },
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["invoices_signed_off"] == 1

    current = (
        await db_session.execute(select(Invoice).where(Invoice.id == inv["id"]))
    ).scalar_one_or_none()
    assert current is None

    archived = (
        await db_session.execute(
            select(PastInvoice).where(PastInvoice.original_invoice_id == inv["id"])
        )
    ).scalar_one()
    assert archived.shop_id == shop.id
    assert archived.invoice_number == inv["invoice_number"]

    signoff = (
        await db_session.execute(
            select(EodSignOff).where(
                EodSignOff.shop_id == shop.id,
                EodSignOff.business_date == date.today(),
            )
        )
    ).scalar_one()
    assert signoff.notes == "Reviewed cash/card settlement at counter."


# --- issue #37: eod-totals no longer 500s when business_date is omitted ---


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_eod_totals_defaults_to_today_when_business_date_omitted(
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
    cashier_client: AsyncClient,
) -> None:
    """Regression for issue #37.

    The endpoint previously required `business_date` and used
    `Query(...)` (Ellipsis) as its default. FastAPI's validation-error
    serializer couldn't serialise the literal `...`, so a missing param
    surfaced as an unhandled 500 (not a clean 422), and the dashboard's
    `Promise.all` rejected the whole batch, leaving "today" null and
    "Mark day end" stuck disabled.

    With the fix in `app/api/dashboard.py` + `app/api/deps.py`, omitting
    the param now resolves to server-local "today" and returns 200.
    """
    await _seed_product(owner_client, "8903000000012")
    await _seed_lot(receiver_client, owner_client, items=[("8903000000012", 5)])
    await _finalize(
        cashier_client, barcode="8903000000012", quantity=1, amount="100.00"
    )

    # No `business_date` query param at all.
    resp = await owner_client.get("/dashboard/eod-totals")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["business_date"] == date.today().isoformat()
    assert body["invoice_count"] == 1
    assert body["revenue"] == "100.00"
    assert body["signed_off"] is False
