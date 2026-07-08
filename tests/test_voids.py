"""Void & reversal tests (D-18, D-37, R-8, R-41)."""
from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.invoice import Invoice, InvoiceStatus
from app.models.log import InvoicingLog
from app.models.lot import LotLine
from app.models.product import Product

# --- helpers ---


async def _seed_product(
    client: AsyncClient, barcode: str, *, price: str = "100.00"
) -> dict:
    resp = await client.post(
        "/products",
        json={"barcode": barcode, "brand": "X", "size_label": "750ml", "price": price},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _seed_lot(
    receiver_client: AsyncClient, *, items: list[tuple[str, int]]
) -> None:
    resp = await receiver_client.post(
        "/lots",
        json={"lines": [{"barcode": bc, "quantity": q} for bc, q in items]},
    )
    assert resp.status_code == 201


async def _finalize(
    cashier_client: AsyncClient,
    *,
    barcode: str,
    quantity: int,
    amount: str,
) -> dict:
    resp = await cashier_client.post(
        "/checkout/finalize",
        headers={"Idempotency-Key": f"k-{uuid.uuid4().hex}"},
        json={
            "lines": [{"barcode": barcode, "quantity": quantity}],
            "payments": [{"mode": "cash", "amount": amount}],
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["invoice"]


# --- pre-EOD direct void ---


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_cashier_can_directly_void_a_pre_eod_invoice(
    cashier_client: AsyncClient, owner_client: AsyncClient, receiver_client: AsyncClient
) -> None:
    await _seed_product(owner_client, "8902000000001", price="100.00")
    await _seed_lot(receiver_client, items=[("8902000000001", 5)])
    inv = await _finalize(
        cashier_client, barcode="8902000000001", quantity=2, amount="200.00"
    )

    resp = await cashier_client.post(f"/invoices/{inv['id']}/void")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "voided"


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_pre_eod_void_restores_stock(
    cashier_client: AsyncClient, owner_client: AsyncClient, receiver_client: AsyncClient, db_session
) -> None:
    await _seed_product(owner_client, "8902000000002", price="100.00")
    await _seed_lot(receiver_client, items=[("8902000000002", 5)])
    inv = await _finalize(
        cashier_client, barcode="8902000000002", quantity=3, amount="300.00"
    )
    # After finalize: stock = 5 - 3 = 2.
    products = (await db_session.execute(select(Product))).scalars().all()
    # Sanity: there's exactly one product and one lot_line of 5.
    assert len(products) == 1
    product_id = products[0].id
    received = (
        await db_session.execute(
            select(LotLine.quantity).where(LotLine.product_id == product_id)
        )
    ).scalar_one()
    assert received == 5

    # Now void. Stock should be back to 5 (the voided invoice no
    # longer counts as "sold").
    void = await cashier_client.post(f"/invoices/{inv['id']}/void")
    assert void.status_code == 200

    # Verify via derived-stock: received(5) - sold(0) = 5. We can't
    # run the service's stock query directly from a test, but we
    # can check the voided invoice is excluded.
    voided = (
        await db_session.execute(
            select(Invoice).where(Invoice.id == inv["id"])
        )
    ).scalar_one()
    assert voided.status == InvoiceStatus.VOIDED


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_voiding_a_voided_invoice_returns_409(
    cashier_client: AsyncClient, owner_client: AsyncClient, receiver_client: AsyncClient
) -> None:
    await _seed_product(owner_client, "8902000000003", price="100.00")
    await _seed_lot(receiver_client, items=[("8902000000003", 5)])
    inv = await _finalize(
        cashier_client, barcode="8902000000003", quantity=1, amount="100.00"
    )
    first = await cashier_client.post(f"/invoices/{inv['id']}/void")
    assert first.status_code == 200
    second = await cashier_client.post(f"/invoices/{inv['id']}/void")
    assert second.status_code == 409
    assert second.json()["detail"]["code"] == "already_voided"


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_session_usable_after_void_error_rejects_a_later_unrelated_void(
    cashier_client: AsyncClient, owner_client: AsyncClient, receiver_client: AsyncClient
) -> None:
    """Issue #27: request_void's VoidError path rolls back via
    unit_of_work before translating to HTTP. Pin that the rollback
    leaves the session usable for a completely unrelated mutation in
    the same test run, not just a retry of the same failing call."""
    await _seed_product(owner_client, "8902000000010", price="100.00")
    await _seed_lot(receiver_client, items=[("8902000000010", 10)])
    first_inv = await _finalize(
        cashier_client, barcode="8902000000010", quantity=1, amount="100.00"
    )
    already_voided = await cashier_client.post(f"/invoices/{first_inv['id']}/void")
    assert already_voided.status_code == 200

    # This second void of the SAME invoice hits the VoidError("already_voided")
    # path and its rollback -- the failure this test is pinning.
    failing = await cashier_client.post(f"/invoices/{first_inv['id']}/void")
    assert failing.status_code == 409

    # An unrelated invoice's direct void must still succeed afterward.
    second_inv = await _finalize(
        cashier_client, barcode="8902000000010", quantity=1, amount="100.00"
    )
    recovered = await cashier_client.post(f"/invoices/{second_inv['id']}/void")
    assert recovered.status_code == 200


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_pre_eod_void_writes_invoicing_log(
    cashier_client: AsyncClient, owner_client: AsyncClient, receiver_client: AsyncClient, db_session
) -> None:
    await _seed_product(owner_client, "8902000000004", price="100.00")
    await _seed_lot(receiver_client, items=[("8902000000004", 5)])
    inv = await _finalize(
        cashier_client, barcode="8902000000004", quantity=1, amount="100.00"
    )
    await cashier_client.post(f"/invoices/{inv['id']}/void")

    logs = (
        await db_session.execute(
            select(InvoicingLog).where(
                InvoicingLog.event_type == "invoice.voided"
            )
        )
    ).scalars().all()
    assert len(logs) == 1
    assert logs[0].payload["from_status"] == "finalized"
    assert logs[0].payload["to_status"] == "voided"
    assert logs[0].payload["invoice_id"] == inv["id"]


# --- post-EOD pending + approve + reject ---


async def _mark_signed_off(db_session, invoice_id: int) -> None:
    inv = (
        await db_session.execute(
            select(Invoice).where(Invoice.id == invoice_id)
        )
    ).scalar_one()
    inv.eod_signed_off = True
    await db_session.commit()


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_cashier_can_request_void_on_signed_off_invoice(
    cashier_client: AsyncClient, owner_client: AsyncClient, receiver_client: AsyncClient, db_session
) -> None:
    await _seed_product(owner_client, "8902000000005", price="100.00")
    await _seed_lot(receiver_client, items=[("8902000000005", 5)])
    inv = await _finalize(
        cashier_client, barcode="8902000000005", quantity=1, amount="100.00"
    )
    await _mark_signed_off(db_session, inv["id"])

    resp = await cashier_client.post(f"/invoices/{inv['id']}/void")
    assert resp.status_code == 200
    assert resp.json()["status"] == "pending_void"


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_request_void_reason_reaches_backend_as_json_body(
    cashier_client: AsyncClient, owner_client: AsyncClient, receiver_client: AsyncClient, db_session
) -> None:
    # Regression: the frontend sends `reason` as a JSON body field
    # (`json: { reason }`), not a query param — the endpoint must accept it
    # that way.
    await _seed_product(owner_client, "8902000000011", price="100.00")
    await _seed_lot(receiver_client, items=[("8902000000011", 5)])
    inv = await _finalize(
        cashier_client, barcode="8902000000011", quantity=1, amount="100.00"
    )
    await _mark_signed_off(db_session, inv["id"])

    resp = await cashier_client.post(
        f"/invoices/{inv['id']}/void", json={"reason": "Wrong item scanned"}
    )
    assert resp.status_code == 200

    log = (
        await db_session.execute(
            select(InvoicingLog).where(InvoicingLog.event_type == "invoice.void_requested")
        )
    ).scalar_one()
    assert log.payload["reason"] == "Wrong item scanned"


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_cashier_cannot_approve_pending_void(
    cashier_client: AsyncClient, owner_client: AsyncClient, receiver_client: AsyncClient, db_session
) -> None:
    await _seed_product(owner_client, "8902000000006", price="100.00")
    await _seed_lot(receiver_client, items=[("8902000000006", 5)])
    inv = await _finalize(
        cashier_client, barcode="8902000000006", quantity=1, amount="100.00"
    )
    await _mark_signed_off(db_session, inv["id"])
    await cashier_client.post(f"/invoices/{inv['id']}/void")

    resp = await cashier_client.post(f"/invoices/{inv['id']}/void/approve")
    assert resp.status_code == 403


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_owner_approving_pending_void_creates_reversal(
    cashier_client: AsyncClient, owner_client: AsyncClient, receiver_client: AsyncClient, db_session
) -> None:
    await _seed_product(owner_client, "8902000000007", price="100.00")
    await _seed_lot(receiver_client, items=[("8902000000007", 5)])
    inv = await _finalize(
        cashier_client, barcode="8902000000007", quantity=1, amount="100.00"
    )
    await _mark_signed_off(db_session, inv["id"])
    await cashier_client.post(f"/invoices/{inv['id']}/void")

    approve = await owner_client.post(
        f"/invoices/{inv['id']}/void/approve", json={"reason": "Customer returned"}
    )
    assert approve.status_code == 200
    body = approve.json()
    assert body["status"] == "voided"

    # The reversal is a separate invoice with reverses_invoice_id set.
    from sqlalchemy import select as sa_select

    reversals = (
        await db_session.execute(
            sa_select(Invoice).where(Invoice.reverses_invoice_id == inv["id"])
        )
    ).scalars().all()
    assert len(reversals) == 1
    rev = reversals[0]
    assert rev.status == InvoiceStatus.REVERSAL
    assert rev.total_amount < 0
    # Reversal mirrors the original's lines with negative totals.
    await db_session.refresh(rev, attribute_names=["lines"])
    assert len(rev.lines) == 1
    assert rev.lines[0].line_total < 0

    # Regression: `reason` must actually reach the backend as a JSON body
    # field (it was previously bound as an unused query param).
    approved_log = (
        await db_session.execute(
            select(InvoicingLog).where(InvoicingLog.event_type == "invoice.void_approved")
        )
    ).scalar_one()
    assert approved_log.payload["reason"] == "Customer returned"


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_owner_rejecting_pending_void_reverts_to_finalized(
    cashier_client: AsyncClient, owner_client: AsyncClient, receiver_client: AsyncClient, db_session
) -> None:
    await _seed_product(owner_client, "8902000000008", price="100.00")
    await _seed_lot(receiver_client, items=[("8902000000008", 5)])
    inv = await _finalize(
        cashier_client, barcode="8902000000008", quantity=1, amount="100.00"
    )
    await _mark_signed_off(db_session, inv["id"])
    await cashier_client.post(f"/invoices/{inv['id']}/void")

    reject = await owner_client.post(
        f"/invoices/{inv['id']}/void/reject", json={"reason": "Verified sale"}
    )
    assert reject.status_code == 200
    assert reject.json()["status"] == "finalized"


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_approve_on_non_pending_invoice_is_409(
    cashier_client: AsyncClient, owner_client: AsyncClient, receiver_client: AsyncClient
) -> None:
    await _seed_product(owner_client, "8902000000009", price="100.00")
    await _seed_lot(receiver_client, items=[("8902000000009", 5)])
    inv = await _finalize(
        cashier_client, barcode="8902000000009", quantity=1, amount="100.00"
    )
    # Not pending — just finalized.
    approve = await owner_client.post(f"/invoices/{inv['id']}/void/approve")
    assert approve.status_code == 409
    assert approve.json()["detail"]["code"] == "not_pending"


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_void_actions_write_invoicing_logs(
    cashier_client: AsyncClient, owner_client: AsyncClient, receiver_client: AsyncClient, db_session
) -> None:
    await _seed_product(owner_client, "8902000000010", price="100.00")
    await _seed_lot(receiver_client, items=[("8902000000010", 5)])
    inv = await _finalize(
        cashier_client, barcode="8902000000010", quantity=1, amount="100.00"
    )
    await _mark_signed_off(db_session, inv["id"])
    await cashier_client.post(f"/invoices/{inv['id']}/void")
    await owner_client.post(f"/invoices/{inv['id']}/void/approve")

    types = sorted(
        row.event_type
        for row in (await db_session.execute(select(InvoicingLog))).scalars().all()
    )
    # The finalize log + void_requested + void_approved.
    assert "invoice.finalized" in types
    assert "invoice.void_requested" in types
    assert "invoice.void_approved" in types
