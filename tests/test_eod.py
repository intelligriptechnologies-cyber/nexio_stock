"""EOD sign-off + dashboard tests (R-26, R-44, D-32, D-36, D-63)."""
from __future__ import annotations

import csv
import uuid
from datetime import date, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.invoice import EodSignOff, Invoice, InvoiceStatus, PastInvoice
from app.models.shop import Shop

# --- helpers ---


async def _seed_product(client: AsyncClient, barcode: str, *, price: str = "100.00") -> None:
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


async def _set_invoice_business_date(db_session, invoice_id: int, business_date: date) -> None:
    row = (
        await db_session.execute(select(Invoice).where(Invoice.id == invoice_id))
    ).scalar_one()
    row.business_date = business_date
    await db_session.commit()


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


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_open_backlog_totals_combine_unreconciled_days_after_last_signoff(
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
    cashier_client: AsyncClient,
    db_session,
) -> None:
    await _seed_product(owner_client, "8903000000101")
    await _seed_lot(receiver_client, owner_client, items=[("8903000000101", 10)])

    three_days_ago = date.today() - timedelta(days=3)
    seeded_signoff = await owner_client.post(
        "/dashboard/eod/sign-off", json={"business_date": three_days_ago.isoformat()}
    )
    assert seeded_signoff.status_code == 201, seeded_signoff.text

    yesterday = date.today() - timedelta(days=1)
    inv1 = await _finalize(
        cashier_client, barcode="8903000000101", quantity=1, amount="100.00", mode="cash"
    )
    await _finalize(
        cashier_client, barcode="8903000000101", quantity=2, amount="200.00", mode="upi"
    )
    await _set_invoice_business_date(db_session, inv1["id"], yesterday)

    totals = await owner_client.get(
        "/dashboard/eod-totals",
        params={"scope": "open_backlog"},
    )
    assert totals.status_code == 200, totals.text
    body = totals.json()
    assert body["signed_off"] is False
    assert body["business_date"] == date.today().isoformat()
    assert body["range_start_business_date"] == yesterday.isoformat()
    assert body["range_end_business_date"] == date.today().isoformat()
    assert body["invoice_count"] == 2
    assert body["revenue"] == "300.00"
    modes = {p["mode"]: p["amount"] for p in body["payments_by_mode"]}
    assert modes == {"cash": "100.00", "upi": "200.00"}


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_open_backlog_totals_without_previous_signoff_include_all_current_invoices(
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
    cashier_client: AsyncClient,
    db_session,
) -> None:
    await _seed_product(owner_client, "8903000000102")
    await _seed_lot(receiver_client, owner_client, items=[("8903000000102", 10)])

    two_days_ago = date.today() - timedelta(days=2)
    inv1 = await _finalize(
        cashier_client, barcode="8903000000102", quantity=1, amount="100.00", mode="cash"
    )
    await _finalize(
        cashier_client, barcode="8903000000102", quantity=1, amount="100.00", mode="card"
    )
    await _set_invoice_business_date(db_session, inv1["id"], two_days_ago)

    totals = await owner_client.get(
        "/dashboard/eod-totals",
        params={"scope": "open_backlog"},
    )
    assert totals.status_code == 200, totals.text
    body = totals.json()
    assert body["range_start_business_date"] == two_days_ago.isoformat()
    assert body["range_end_business_date"] == date.today().isoformat()
    assert body["invoice_count"] == 2
    assert body["revenue"] == "200.00"


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_open_backlog_totals_exclude_past_invoices(
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
    cashier_client: AsyncClient,
    db_session,
) -> None:
    await _seed_product(owner_client, "8903000000103")
    await _seed_lot(receiver_client, owner_client, items=[("8903000000103", 10)])

    two_days_ago = date.today() - timedelta(days=2)
    yesterday = date.today() - timedelta(days=1)
    seeded_signoff = await owner_client.post(
        "/dashboard/eod/sign-off", json={"business_date": two_days_ago.isoformat()}
    )
    assert seeded_signoff.status_code == 201, seeded_signoff.text

    archived_invoice = await _finalize(
        cashier_client, barcode="8903000000103", quantity=1, amount="100.00", mode="cash"
    )
    await _set_invoice_business_date(db_session, archived_invoice["id"], yesterday)
    first_signoff = await owner_client.post(
        "/dashboard/eod/sign-off", json={"business_date": yesterday.isoformat()}
    )
    assert first_signoff.status_code == 201, first_signoff.text

    await _finalize(
        cashier_client, barcode="8903000000103", quantity=2, amount="200.00", mode="upi"
    )
    totals = await owner_client.get(
        "/dashboard/eod-totals",
        params={"scope": "open_backlog"},
    )
    assert totals.status_code == 200, totals.text
    body = totals.json()
    assert body["invoice_count"] == 1
    assert body["revenue"] == "200.00"
    assert body["range_start_business_date"] == date.today().isoformat()
    assert body["range_end_business_date"] == date.today().isoformat()


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_sign_off_archives_entire_open_backlog_window(
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
    cashier_client: AsyncClient,
    db_session,
) -> None:
    await _seed_product(owner_client, "8903000000104")
    await _seed_lot(receiver_client, owner_client, items=[("8903000000104", 10)])

    prior_day = date.today() - timedelta(days=3)
    seeded_signoff = await owner_client.post(
        "/dashboard/eod/sign-off", json={"business_date": prior_day.isoformat()}
    )
    assert seeded_signoff.status_code == 201, seeded_signoff.text

    yesterday = date.today() - timedelta(days=1)
    inv1 = await _finalize(
        cashier_client, barcode="8903000000104", quantity=1, amount="100.00", mode="cash"
    )
    await _finalize(
        cashier_client, barcode="8903000000104", quantity=2, amount="200.00", mode="upi"
    )
    await _set_invoice_business_date(db_session, inv1["id"], yesterday)

    signoff = await owner_client.post(
        "/dashboard/eod/sign-off", json={"business_date": date.today().isoformat()}
    )
    assert signoff.status_code == 201, signoff.text
    body = signoff.json()
    assert body["business_date"] == date.today().isoformat()
    assert body["invoices_signed_off"] == 2

    current_rows = (await db_session.execute(select(Invoice))).scalars().all()
    assert current_rows == []

    archived = (
        await db_session.execute(select(PastInvoice).order_by(PastInvoice.invoice_number.asc()))
    ).scalars().all()
    assert len(archived) == 2
    assert [row.business_date for row in archived] == [yesterday, date.today()]

    signoff_row = (
        await db_session.execute(
            select(EodSignOff).where(
                EodSignOff.shop_id == archived[0].shop_id,
                EodSignOff.business_date == date.today(),
            )
        )
    ).scalar_one()
    assert signoff_row.invoices_signed_off == 2


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_open_backlog_signoff_blocked_when_any_backlog_invoice_is_pending_void(
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
    cashier_client: AsyncClient,
    db_session,
) -> None:
    await _seed_product(owner_client, "8903000000105")
    await _seed_lot(receiver_client, owner_client, items=[("8903000000105", 10)])

    prior_day = date.today() - timedelta(days=3)
    seeded_signoff = await owner_client.post(
        "/dashboard/eod/sign-off", json={"business_date": prior_day.isoformat()}
    )
    assert seeded_signoff.status_code == 201, seeded_signoff.text

    yesterday = date.today() - timedelta(days=1)
    inv1 = await _finalize(
        cashier_client, barcode="8903000000105", quantity=1, amount="100.00", mode="cash"
    )
    await _set_invoice_business_date(db_session, inv1["id"], yesterday)
    await _finalize(
        cashier_client, barcode="8903000000105", quantity=1, amount="100.00", mode="upi"
    )
    requested = await cashier_client.post(f"/invoices/{inv1['id']}/void")
    assert requested.status_code == 200, requested.text

    signoff = await owner_client.post(
        "/dashboard/eod/sign-off", json={"business_date": date.today().isoformat()}
    )
    assert signoff.status_code == 409
    assert signoff.json()["detail"]["code"] == "pending_void_approvals_exist"


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_open_backlog_totals_with_no_current_invoices_show_no_range(
    owner_client: AsyncClient,
) -> None:
    totals = await owner_client.get(
        "/dashboard/eod-totals",
        params={"scope": "open_backlog"},
    )
    assert totals.status_code == 200, totals.text
    body = totals.json()
    assert body["signed_off"] is True
    assert body["range_start_business_date"] is None
    assert body["range_end_business_date"] is None
    assert body["invoice_count"] == 0
    assert body["revenue"] == "0"


# --- history ---


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_eod_history_lists_signoffs_in_descending_order(
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
    cashier_client: AsyncClient,
) -> None:
    yesterday = (date.today() - timedelta(days=1)).isoformat()
    first = await owner_client.post(
        "/dashboard/eod/sign-off", json={"business_date": yesterday}
    )
    assert first.status_code == 201, first.text

    await _seed_product(owner_client, "8903000000007")
    await _seed_lot(receiver_client, owner_client, items=[("8903000000007", 5)])
    await _finalize(cashier_client, barcode="8903000000007", quantity=1, amount="100.00")

    today = date.today().isoformat()
    second = await owner_client.post(
        "/dashboard/eod/sign-off", json={"business_date": today}
    )
    assert second.status_code == 201, second.text

    h = await owner_client.get("/dashboard/eod-history")
    assert h.status_code == 200
    body = h.json()
    assert len(body["signoffs"]) == 2
    # Descending by business_date.
    assert body["signoffs"][0]["business_date"].startswith(today)
    assert body["signoffs"][1]["business_date"].startswith(yesterday)
    assert body["signoffs"][0]["id"] > 0
    assert body["signoffs"][0]["signed_off_by_name"] == "Owner One"
    assert body["signoffs"][0]["revenue"] == "100.00"
    assert body["signoffs"][0]["payments_by_mode"] == [{"mode": "cash", "amount": "100.00"}]
    assert body["signoffs"][0]["notes"] is None


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_eod_history_filters_by_date_range(
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
    cashier_client: AsyncClient,
) -> None:
    today = date.today()
    two_days_ago = today - timedelta(days=2)
    five_days_ago = today - timedelta(days=5)

    for d in (five_days_ago, two_days_ago):
        resp = await owner_client.post(
            "/dashboard/eod/sign-off", json={"business_date": d.isoformat()}
        )
        assert resp.status_code == 201, resp.text

    await _seed_product(owner_client, "8903000000008")
    await _seed_lot(receiver_client, owner_client, items=[("8903000000008", 5)])
    await _finalize(cashier_client, barcode="8903000000008", quantity=1, amount="100.00")
    today_resp = await owner_client.post(
        "/dashboard/eod/sign-off", json={"business_date": today.isoformat()}
    )
    assert today_resp.status_code == 201, today_resp.text

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


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_eod_history_detail_and_note_update_owner_only(
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
    cashier_client: AsyncClient,
    db_session,
) -> None:
    await _seed_product(owner_client, "8903000000016")
    await _seed_lot(receiver_client, owner_client, items=[("8903000000016", 5)])
    await _finalize(cashier_client, barcode="8903000000016", quantity=1, amount="100.00")

    created = await owner_client.post(
        "/dashboard/eod/sign-off",
        json={"business_date": date.today().isoformat(), "notes": " Initial settlement note. "},
    )
    assert created.status_code == 201, created.text
    signoff_id = created.json()["id"]

    detail = await owner_client.get(f"/dashboard/eod-history/{signoff_id}")
    assert detail.status_code == 200, detail.text
    detail_body = detail.json()
    assert detail_body["id"] == signoff_id
    assert detail_body["signed_off_by_name"] == "Owner One"
    assert detail_body["revenue"] == "100.00"
    assert detail_body["payments_by_mode"] == [{"mode": "cash", "amount": "100.00"}]
    assert detail_body["notes"] == "Initial settlement note."

    updated = await owner_client.patch(
        f"/dashboard/eod-history/{signoff_id}",
        json={"notes": " Updated note from history tab. "},
    )
    assert updated.status_code == 200, updated.text
    updated_body = updated.json()
    assert updated_body["notes"] == "Updated note from history tab."
    assert updated_body["business_date"] == detail_body["business_date"]
    assert updated_body["signed_off_at"] == detail_body["signed_off_at"]
    assert updated_body["signed_off_by_user_id"] == detail_body["signed_off_by_user_id"]
    assert updated_body["signed_off_by_name"] == detail_body["signed_off_by_name"]
    assert updated_body["invoices_signed_off"] == detail_body["invoices_signed_off"]
    assert updated_body["revenue"] == detail_body["revenue"]
    assert updated_body["payments_by_mode"] == detail_body["payments_by_mode"]

    row = (
        await db_session.execute(select(EodSignOff).where(EodSignOff.id == signoff_id))
    ).scalar_one()
    assert row.notes == "Updated note from history tab."


@pytest.mark.usefixtures("owner", "receiver", "cashier", "superadmin")
async def test_superadmin_can_read_and_update_history_with_shop_id(
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
    cashier_client: AsyncClient,
    superadmin_client: AsyncClient,
    shop,
) -> None:
    await _seed_product(owner_client, "8903000000017")
    await _seed_lot(receiver_client, owner_client, items=[("8903000000017", 5)])
    await _finalize(cashier_client, barcode="8903000000017", quantity=1, amount="100.00")

    created = await owner_client.post(
        "/dashboard/eod/sign-off",
        json={"business_date": date.today().isoformat()},
    )
    assert created.status_code == 201, created.text
    signoff_id = created.json()["id"]

    listed = await superadmin_client.get("/dashboard/eod-history", params={"shop_id": shop.id})
    assert listed.status_code == 200, listed.text
    assert listed.json()["signoffs"][0]["id"] == signoff_id
    assert listed.json()["signoffs"][0]["revenue"] == "100.00"
    assert listed.json()["signoffs"][0]["payments_by_mode"] == [{"mode": "cash", "amount": "100.00"}]

    detail = await superadmin_client.get(
        f"/dashboard/eod-history/{signoff_id}",
        params={"shop_id": shop.id},
    )
    assert detail.status_code == 200, detail.text
    assert detail.json()["revenue"] == "100.00"
    assert detail.json()["payments_by_mode"] == [{"mode": "cash", "amount": "100.00"}]

    patched = await superadmin_client.patch(
        f"/dashboard/eod-history/{signoff_id}",
        json={"shop_id": shop.id, "notes": ""},
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["notes"] is None


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_cashier_and_receiver_forbidden_from_reconciled_history(
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
    cashier_client: AsyncClient,
) -> None:
    created = await owner_client.post(
        "/dashboard/eod/sign-off",
        json={"business_date": date.today().isoformat()},
    )
    assert created.status_code == 201, created.text
    signoff_id = created.json()["id"]

    for client in (cashier_client, receiver_client):
        listed = await client.get("/dashboard/eod-history")
        assert listed.status_code == 403

        detail = await client.get(f"/dashboard/eod-history/{signoff_id}")
        assert detail.status_code == 403

        patched = await client.patch(
            f"/dashboard/eod-history/{signoff_id}",
            json={"notes": "nope"},
        )
        assert patched.status_code == 403


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_eod_history_note_update_validates_max_length(
    owner_client: AsyncClient,
) -> None:
    created = await owner_client.post(
        "/dashboard/eod/sign-off",
        json={"business_date": date.today().isoformat()},
    )
    assert created.status_code == 201, created.text
    signoff_id = created.json()["id"]

    patched = await owner_client.patch(
        f"/dashboard/eod-history/{signoff_id}",
        json={"notes": "x" * 501},
    )
    assert patched.status_code == 422


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_eod_history_aggregates_mixed_payment_modes_from_archived_invoices(
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
    cashier_client: AsyncClient,
) -> None:
    await _seed_product(owner_client, "8903000000018")
    await _seed_lot(receiver_client, owner_client, items=[("8903000000018", 5)])
    await _finalize(cashier_client, barcode="8903000000018", quantity=1, amount="100.00", mode="cash")
    await _finalize(cashier_client, barcode="8903000000018", quantity=2, amount="200.00", mode="upi")

    created = await owner_client.post(
        "/dashboard/eod/sign-off",
        json={"business_date": date.today().isoformat()},
    )
    assert created.status_code == 201, created.text
    signoff_id = created.json()["id"]

    listed = await owner_client.get("/dashboard/eod-history")
    assert listed.status_code == 200, listed.text
    history_row = listed.json()["signoffs"][0]
    assert history_row["id"] == signoff_id
    assert history_row["revenue"] == "300.00"
    assert history_row["payments_by_mode"] == [
        {"mode": "cash", "amount": "100.00"},
        {"mode": "upi", "amount": "200.00"},
    ]

    detail = await owner_client.get(f"/dashboard/eod-history/{signoff_id}")
    assert detail.status_code == 200, detail.text
    assert detail.json()["revenue"] == "300.00"
    assert detail.json()["payments_by_mode"] == [
        {"mode": "cash", "amount": "100.00"},
        {"mode": "upi", "amount": "200.00"},
    ]


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_eod_history_aggregates_entire_backlog_signoff_not_just_signoff_business_date(
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
    cashier_client: AsyncClient,
    db_session,
) -> None:
    await _seed_product(owner_client, "8903000000020")
    await _seed_product(owner_client, "8903000000021", price="20.00")
    await _seed_lot(receiver_client, owner_client, items=[("8903000000020", 20)])
    await _seed_lot(receiver_client, owner_client, items=[("8903000000021", 20)])

    prior_day = date.today() - timedelta(days=3)
    seeded_signoff = await owner_client.post(
        "/dashboard/eod/sign-off", json={"business_date": prior_day.isoformat()}
    )
    assert seeded_signoff.status_code == 201, seeded_signoff.text

    two_days_ago = date.today() - timedelta(days=2)
    yesterday = date.today() - timedelta(days=1)

    inv1 = await _finalize(
        cashier_client, barcode="8903000000020", quantity=1, amount="100.00", mode="cash"
    )
    inv2 = await _finalize(
        cashier_client, barcode="8903000000021", quantity=1, amount="20.00", mode="cash"
    )
    await _set_invoice_business_date(db_session, inv1["id"], two_days_ago)
    await _set_invoice_business_date(db_session, inv2["id"], yesterday)

    created = await owner_client.post(
        "/dashboard/eod/sign-off",
        json={"business_date": date.today().isoformat()},
    )
    assert created.status_code == 201, created.text
    signoff_id = created.json()["id"]

    detail = await owner_client.get(f"/dashboard/eod-history/{signoff_id}")
    assert detail.status_code == 200, detail.text
    assert detail.json()["invoices_signed_off"] == 2
    assert detail.json()["revenue"] == "120.00"
    assert detail.json()["payments_by_mode"] == [{"mode": "cash", "amount": "120.00"}]


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_eod_history_excludes_voided_invoices_from_archived_summary(
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
    cashier_client: AsyncClient,
) -> None:
    await _seed_product(owner_client, "8903000000019")
    await _seed_lot(receiver_client, owner_client, items=[("8903000000019", 5)])
    voided = await _finalize(
        cashier_client, barcode="8903000000019", quantity=1, amount="100.00", mode="cash"
    )
    await _finalize(
        cashier_client, barcode="8903000000019", quantity=1, amount="100.00", mode="upi"
    )
    await owner_client.post(f"/invoices/{voided['id']}/void")

    created = await owner_client.post(
        "/dashboard/eod/sign-off",
        json={"business_date": date.today().isoformat()},
    )
    assert created.status_code == 201, created.text
    signoff_id = created.json()["id"]

    detail = await owner_client.get(f"/dashboard/eod-history/{signoff_id}")
    assert detail.status_code == 200, detail.text
    assert detail.json()["revenue"] == "100.00"
    assert detail.json()["payments_by_mode"] == [{"mode": "upi", "amount": "100.00"}]


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_eod_history_export_returns_csv_with_attachment_headers(
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
    cashier_client: AsyncClient,
) -> None:
    await _seed_product(owner_client, "8903000000030")
    await _seed_lot(receiver_client, owner_client, items=[("8903000000030", 5)])
    await _finalize(
        cashier_client, barcode="8903000000030", quantity=1, amount="100.00", mode="cash"
    )

    created = await owner_client.post(
        "/dashboard/eod/sign-off",
        json={"business_date": date.today().isoformat(), "notes": "Till balanced."},
    )
    assert created.status_code == 201, created.text
    signoff_id = created.json()["id"]

    exported = await owner_client.get(
        "/dashboard/eod-history/export",
        params=[("signoff_id", str(signoff_id))],
    )
    assert exported.status_code == 200, exported.text
    assert exported.headers["content-type"].startswith("text/csv")
    assert "attachment; filename=\"reconciliations-" in exported.headers["content-disposition"]

    rows = list(csv.DictReader(exported.text.splitlines()))
    assert len(rows) == 1
    assert rows[0]["reconciliation_id"] == str(signoff_id)
    assert rows[0]["signed_off_by_name"] == "Owner One"
    assert rows[0]["reconciliation_notes"] == "Till balanced."
    assert rows[0]["invoice_number"] == "1"
    assert rows[0]["invoice_payments"] == "cash 100.00"
    assert "X 750ml x1 @ 100.00 = 100.00" in rows[0]["invoice_line_items"]


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_eod_history_export_includes_entire_backlog_batch_not_just_signoff_business_date(
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
    cashier_client: AsyncClient,
    db_session,
) -> None:
    await _seed_product(owner_client, "8903000000031")
    await _seed_lot(receiver_client, owner_client, items=[("8903000000031", 10)])

    prior_day = date.today() - timedelta(days=3)
    seeded_signoff = await owner_client.post(
        "/dashboard/eod/sign-off", json={"business_date": prior_day.isoformat()}
    )
    assert seeded_signoff.status_code == 201, seeded_signoff.text

    yesterday = date.today() - timedelta(days=1)
    inv1 = await _finalize(
        cashier_client, barcode="8903000000031", quantity=1, amount="100.00", mode="cash"
    )
    inv2 = await _finalize(
        cashier_client, barcode="8903000000031", quantity=2, amount="200.00", mode="upi"
    )
    await _set_invoice_business_date(db_session, inv1["id"], yesterday)

    created = await owner_client.post(
        "/dashboard/eod/sign-off",
        json={"business_date": date.today().isoformat(), "notes": "Backlog cleared."},
    )
    assert created.status_code == 201, created.text
    signoff_id = created.json()["id"]

    exported = await owner_client.get(
        "/dashboard/eod-history/export",
        params=[("signoff_id", str(signoff_id))],
    )
    assert exported.status_code == 200, exported.text

    rows = list(csv.DictReader(exported.text.splitlines()))
    assert len(rows) == 2
    assert {row["invoice_business_date"] for row in rows} == {
        yesterday.isoformat(),
        date.today().isoformat(),
    }
    assert {row["invoice_id"] for row in rows} == {"1", "2"} or len({row["invoice_id"] for row in rows}) == 2
    assert {row["reconciliation_notes"] for row in rows} == {"Backlog cleared."}
    assert {row["reconciliation_payments_by_mode"] for row in rows} == {"cash 100.00; upi 200.00"}


@pytest.mark.usefixtures("owner", "receiver", "cashier", "superadmin")
async def test_superadmin_can_export_eod_history_with_shop_id(
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
    cashier_client: AsyncClient,
    superadmin_client: AsyncClient,
    shop,
) -> None:
    await _seed_product(owner_client, "8903000000032")
    await _seed_lot(receiver_client, owner_client, items=[("8903000000032", 5)])
    await _finalize(
        cashier_client, barcode="8903000000032", quantity=1, amount="100.00", mode="card"
    )

    created = await owner_client.post(
        "/dashboard/eod/sign-off",
        json={"business_date": date.today().isoformat()},
    )
    assert created.status_code == 201, created.text
    signoff_id = created.json()["id"]

    exported = await superadmin_client.get(
        "/dashboard/eod-history/export",
        params=[("shop_id", str(shop.id)), ("signoff_id", str(signoff_id))],
    )
    assert exported.status_code == 200, exported.text
    rows = list(csv.DictReader(exported.text.splitlines()))
    assert len(rows) == 1
    assert rows[0]["reconciliation_id"] == str(signoff_id)
    assert rows[0]["invoice_payments"] == "card 100.00"


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
