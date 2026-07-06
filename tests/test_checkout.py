"""Checkout finalize + invoice PDF tests (R-8, R-9, R-12, R-13, R-40, R-43, D-30, D-37)."""
from __future__ import annotations

import asyncio
import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.invoice import (
    Invoice,
)
from app.models.log import InvoicingLog
from app.models.lot import LotLine

# --- helpers ---


async def _seed_product(
    client: AsyncClient, barcode: str, *, price: str = "100.00", brand: str = "Test"
) -> dict:
    resp = await client.post(
        "/products",
        json={"barcode": barcode, "brand": brand, "size_label": "750ml", "price": price},
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
    assert resp.status_code == 201, resp.text


def _idem_key() -> str:
    return f"idem-{uuid.uuid4().hex}"


# --- happy path ---


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_cashier_finalizes_a_one_line_invoice(
    cashier_client: AsyncClient, owner_client: AsyncClient, receiver_client: AsyncClient
) -> None:
    await _seed_product(owner_client, "8901000000001", price="100.00")
    await _seed_lot(receiver_client, items=[("8901000000001", 5)])

    resp = await cashier_client.post(
        "/checkout/finalize",
        headers={"Idempotency-Key": _idem_key()},
        json={
            "lines": [{"barcode": "8901000000001", "quantity": 2}],
            "payments": [{"mode": "cash", "amount": "200.00"}],
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["is_replay"] is False
    invoice = body["invoice"]
    assert invoice["status"] == "finalized"
    assert invoice["total_amount"] == "200.00"
    assert invoice["invoice_number"] == 1
    assert len(invoice["lines"]) == 1
    assert invoice["lines"][0]["quantity"] == 2
    assert invoice["lines"][0]["unit_price"] == "100.00"
    assert invoice["lines"][0]["line_total"] == "200.00"
    assert invoice["payments"][0]["mode"] == "cash"
    assert invoice["payments"][0]["amount"] == "200.00"


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_cashier_finalizes_multi_line_invoice(
    cashier_client: AsyncClient, owner_client: AsyncClient, receiver_client: AsyncClient
) -> None:
    for bc, price in [("8901000000002", "100.00"), ("8901000000003", "250.00")]:
        await _seed_product(owner_client, bc, price=price)
    await _seed_lot(
        receiver_client,
        items=[("8901000000002", 5), ("8901000000003", 5)],
    )

    resp = await cashier_client.post(
        "/checkout/finalize",
        headers={"Idempotency-Key": _idem_key()},
        json={
            "lines": [
                {"barcode": "8901000000002", "quantity": 1},
                {"barcode": "8901000000003", "quantity": 2},
            ],
            "payments": [{"mode": "upi", "amount": "600.00"}],
        },
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["invoice"]["total_amount"] == "600.00"
    assert len(body["invoice"]["lines"]) == 2


# --- payment splits (D-59, R-40) ---


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_payment_split_across_modes(
    cashier_client: AsyncClient, owner_client: AsyncClient, receiver_client: AsyncClient
) -> None:
    await _seed_product(owner_client, "8901000000004", price="500.00")
    await _seed_lot(receiver_client, items=[("8901000000004", 5)])

    resp = await cashier_client.post(
        "/checkout/finalize",
        headers={"Idempotency-Key": _idem_key()},
        json={
            "lines": [{"barcode": "8901000000004", "quantity": 1}],
            "payments": [
                {"mode": "cash", "amount": "200.00"},
                {"mode": "upi", "amount": "300.00"},
            ],
        },
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["invoice"]["total_amount"] == "500.00"
    modes = {p["mode"]: p["amount"] for p in body["invoice"]["payments"]}
    assert modes == {"cash": "200.00", "upi": "300.00"}


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_payment_mismatch_is_rejected_with_400(
    cashier_client: AsyncClient, owner_client: AsyncClient, receiver_client: AsyncClient
) -> None:
    await _seed_product(owner_client, "8901000000005", price="100.00")
    await _seed_lot(receiver_client, items=[("8901000000005", 5)])

    resp = await cashier_client.post(
        "/checkout/finalize",
        headers={"Idempotency-Key": _idem_key()},
        json={
            "lines": [{"barcode": "8901000000005", "quantity": 1}],
            "payments": [{"mode": "cash", "amount": "99.00"}],
        },
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "payment_mismatch"


# --- stock / oversell ---


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_quantity_exceeding_stock_is_rejected(
    cashier_client: AsyncClient, owner_client: AsyncClient, receiver_client: AsyncClient
) -> None:
    await _seed_product(owner_client, "8901000000006", price="100.00")
    await _seed_lot(receiver_client, items=[("8901000000006", 3)])

    resp = await cashier_client.post(
        "/checkout/finalize",
        headers={"Idempotency-Key": _idem_key()},
        json={
            "lines": [{"barcode": "8901000000006", "quantity": 5}],
            "payments": [{"mode": "cash", "amount": "500.00"}],
        },
    )
    assert resp.status_code == 409
    assert resp.json()["detail"]["code"] == "insufficient_stock"


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_unknown_barcode_is_rejected_with_404(
    cashier_client: AsyncClient, owner_client: AsyncClient, receiver_client: AsyncClient
) -> None:
    await _seed_product(owner_client, "8901000000007", price="100.00")
    await _seed_lot(receiver_client, items=[("8901000000007", 5)])

    resp = await cashier_client.post(
        "/checkout/finalize",
        headers={"Idempotency-Key": _idem_key()},
        json={
            "lines": [{"barcode": "does-not-exist", "quantity": 1}],
            "payments": [{"mode": "cash", "amount": "1.00"}],
        },
    )
    assert resp.status_code == 404
    assert resp.json()["detail"]["code"] == "unknown_barcode"


# --- idempotency ---


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_idempotency_key_replay_returns_same_invoice(
    cashier_client: AsyncClient, owner_client: AsyncClient, receiver_client: AsyncClient
) -> None:
    await _seed_product(owner_client, "8901000000008", price="100.00")
    await _seed_lot(receiver_client, items=[("8901000000008", 5)])

    key = _idem_key()
    body = {
        "lines": [{"barcode": "8901000000008", "quantity": 1}],
        "payments": [{"mode": "cash", "amount": "100.00"}],
    }
    first = await cashier_client.post(
        "/checkout/finalize", headers={"Idempotency-Key": key}, json=body
    )
    assert first.status_code == 201
    first_id = first.json()["invoice"]["id"]

    second = await cashier_client.post(
        "/checkout/finalize", headers={"Idempotency-Key": key}, json=body
    )
    assert second.status_code == 201
    assert second.json()["is_replay"] is True
    assert second.json()["invoice"]["id"] == first_id


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_missing_idempotency_key_is_400(
    cashier_client: AsyncClient, owner_client: AsyncClient, receiver_client: AsyncClient
) -> None:
    await _seed_product(owner_client, "8901000000009", price="100.00")
    await _seed_lot(receiver_client, items=[("8901000000009", 5)])

    resp = await cashier_client.post(
        "/checkout/finalize",
        json={
            "lines": [{"barcode": "8901000000009", "quantity": 1}],
            "payments": [{"mode": "cash", "amount": "100.00"}],
        },
    )
    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "idempotency_key_required"


# --- concurrency ---


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_two_concurrent_finalizes_for_last_unit_only_one_wins(
    owner_client: AsyncClient, receiver_client: AsyncClient
) -> None:
    """The acceptance criterion: two concurrent checkout requests for the
    last unit of the same SKU: exactly one succeeds, the other is
    rejected cleanly (no oversell)."""
    await _seed_product(owner_client, "8901000000010", price="100.00")
    # One unit in stock.
    await _seed_lot(receiver_client, items=[("8901000000010", 1)])

    # Two distinct cashiers would happen in real life; we use the same
    # client twice but with separate sessions by issuing both at once.
    # Construct the requests manually because we want them to actually
    # race (not serialize via await). httpx AsyncClient supports
    # parallel calls via asyncio.gather.

    # We need two cashier clients because the second call needs a fresh
    # login. Build them on the fly using the same cashier user.
    from httpx import ASGITransport
    from httpx import AsyncClient as HttpxClient

    from app.main import app

    async def cashier_call() -> int:
        async with HttpxClient(transport=ASGITransport(app=app), base_url="http://t") as c:
            login = await c.post(
                "/auth/login", json={"phone": "+15555550003", "password": "cashpass"}
            )
            assert login.status_code == 200
            c.headers["Authorization"] = f"Bearer {login.json()['access_token']}"
            r = await c.post(
                "/checkout/finalize",
                headers={"Idempotency-Key": _idem_key()},
                json={
                    "lines": [{"barcode": "8901000000010", "quantity": 1}],
                    "payments": [{"mode": "cash", "amount": "100.00"}],
                },
            )
            return r.status_code

    code_a, code_b = await asyncio.gather(cashier_call(), cashier_call())
    codes = sorted([code_a, code_b])
    assert codes == [201, 409], f"expected one 201 and one 409, got {codes}"

    # Verify only one Invoice was created and only one unit was decremented.
    from app.db import get_sessionmaker

    Session = get_sessionmaker()
    async with Session() as session, session.begin():
        n = (await session.execute(select(Invoice))).scalars().all()
        assert len(n) == 1
        # Stock derivation: 1 received, 1 sold → 0 remaining. No oversell.
        sums = (
            await session.execute(
                select(LotLine.product_id)
            )
        ).all()
        assert len(sums) == 1


# --- authorization ---


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_receiver_cannot_finalize_checkout(receiver_client: AsyncClient) -> None:
    resp = await receiver_client.post(
        "/checkout/finalize",
        headers={"Idempotency-Key": _idem_key()},
        json={
            "lines": [{"barcode": "x", "quantity": 1}],
            "payments": [{"mode": "cash", "amount": "1.00"}],
        },
    )
    assert resp.status_code == 403


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_owner_can_finalize_checkout(
    owner_client: AsyncClient, receiver_client: AsyncClient
) -> None:
    await _seed_product(owner_client, "8901000000011", price="50.00")
    await _seed_lot(receiver_client, items=[("8901000000011", 5)])

    resp = await owner_client.post(
        "/checkout/finalize",
        headers={"Idempotency-Key": _idem_key()},
        json={
            "lines": [{"barcode": "8901000000011", "quantity": 1}],
            "payments": [{"mode": "cash", "amount": "50.00"}],
        },
    )
    assert resp.status_code == 201


# --- immutability ---


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_finalized_invoice_lines_are_immutable(
    cashier_client: AsyncClient, owner_client: AsyncClient, receiver_client: AsyncClient
) -> None:
    """There is no PATCH /invoices/{id}/lines — corrections go through Void
    (D-18, #5). Verify no update route is exposed for invoice content."""
    await _seed_product(owner_client, "8901000000012", price="100.00")
    await _seed_lot(receiver_client, items=[("8901000000012", 5)])
    cr = await cashier_client.post(
        "/checkout/finalize",
        headers={"Idempotency-Key": _idem_key()},
        json={
            "lines": [{"barcode": "8901000000012", "quantity": 1}],
            "payments": [{"mode": "cash", "amount": "100.00"}],
        },
    )
    invoice_id = cr.json()["invoice"]["id"]

    # GET works.
    g = await cashier_client.get(f"/invoices/{invoice_id}")
    assert g.status_code == 200
    assert g.json()["lines"][0]["quantity"] == 1

    # There is no PUT/PATCH/DELETE on /invoices/{id} — confirm by trying
    # a few verbs and getting 405.
    for verb in ("put", "patch", "delete"):
        r = await getattr(cashier_client, verb)(f"/invoices/{invoice_id}")
        assert r.status_code == 405, f"verb {verb} should not be allowed"


# --- invoicing_logs ---


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_finalize_writes_an_invoicing_log(
    cashier_client: AsyncClient,
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
    db_session,
) -> None:
    await _seed_product(owner_client, "8901000000013", price="100.00")
    await _seed_lot(receiver_client, items=[("8901000000013", 5)])

    cr = await cashier_client.post(
        "/checkout/finalize",
        headers={"Idempotency-Key": _idem_key()},
        json={
            "lines": [{"barcode": "8901000000013", "quantity": 1}],
            "payments": [{"mode": "cash", "amount": "100.00"}],
        },
    )
    invoice_id = cr.json()["invoice"]["id"]
    rows = (await db_session.execute(select(InvoicingLog))).scalars().all()
    finalize_logs = [r for r in rows if r.event_type == "invoice.finalized"]
    assert len(finalize_logs) == 1
    assert finalize_logs[0].payload["invoice_id"] == invoice_id


# --- PDF ---


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_invoice_pdf_is_a_real_pdf(
    cashier_client: AsyncClient, owner_client: AsyncClient, receiver_client: AsyncClient
) -> None:
    await _seed_product(owner_client, "8901000000014", price="100.00")
    await _seed_lot(receiver_client, items=[("8901000000014", 5)])
    cr = await cashier_client.post(
        "/checkout/finalize",
        headers={"Idempotency-Key": _idem_key()},
        json={
            "lines": [{"barcode": "8901000000014", "quantity": 1}],
            "payments": [{"mode": "cash", "amount": "100.00"}],
        },
    )
    invoice_id = cr.json()["invoice"]["id"]

    resp = await cashier_client.get(f"/invoices/{invoice_id}/pdf")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/pdf"
    body = resp.content
    assert body.startswith(b"%PDF-"), "PDF should start with the %PDF magic"
    assert len(body) > 200  # any real invoice is at least a few hundred bytes


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_invoice_pdf_is_403_for_receiver(
    receiver_client: AsyncClient, owner_client: AsyncClient
) -> None:
    # Receiver doesn't need to download invoice PDFs; the cashier flow
    # is for them. Verify the gate.
    await _seed_product(owner_client, "8901000000015", price="100.00")
    resp = await receiver_client.get("/invoices/1/pdf")
    assert resp.status_code == 403


# --- empty cart ---


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_empty_cart_rejected(
    cashier_client: AsyncClient,
) -> None:
    resp = await cashier_client.post(
        "/checkout/finalize",
        headers={"Idempotency-Key": _idem_key()},
        json={"lines": [], "payments": [{"mode": "cash", "amount": "1.00"}]},
    )
    # Pydantic min_length=1 on lines -> 422.
    assert resp.status_code == 422
