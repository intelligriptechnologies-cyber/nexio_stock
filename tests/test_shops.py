"""GST/Excise stub tests (D-23, R-33, R-34, #8).

The AC says the duty rate is a CONFIGURABLE placeholder — no
hardcoded CGST/SGST percentage anywhere. The tests verify:
  - Shop has gstin + excise_duty_rate fields (configurable)
  - Owner can update them via PATCH /shops/me
  - The PDF surfaces the configured GSTIN + duty rate
  - The PDF disclaimer text is present ("placeholder", "do not rely
    on this figure for filings")
  - No CGST/SGST percentage is baked into the renderer output
"""
from __future__ import annotations

import re
import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.shop import Shop


async def _seed_product(client: AsyncClient, barcode: str) -> None:
    resp = await client.post(
        "/products",
        json={"barcode": barcode, "brand": "X", "size_label": "750ml", "price": "100.00"},
    )
    assert resp.status_code == 201


async def _seed_lot(
    receiver_client: AsyncClient, owner_client: AsyncClient, *, bc: str, qty: int
) -> None:
    resp = await receiver_client.post(
        "/lots", json={"lines": [{"barcode": bc, "quantity": qty}]}
    )
    assert resp.status_code == 201
    inward_id = resp.json()["id"]
    approved = await owner_client.post(f"/lots/{inward_id}/approve")
    assert approved.status_code == 200, approved.text


async def _finalize(
    cashier_client: AsyncClient, *, bc: str, qty: int, amount: str
) -> dict:
    resp = await cashier_client.post(
        "/checkout/finalize",
        headers={"Idempotency-Key": f"k-{uuid.uuid4().hex}"},
        json={
            "lines": [{"barcode": bc, "quantity": qty}],
            "payments": [{"mode": "cash", "amount": amount}],
        },
    )
    assert resp.status_code == 201
    return resp.json()["invoice"]


# --- /shops/me read/write ---


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_get_shop_returns_defaults(
    owner_client: AsyncClient, db_session
) -> None:
    shop = (await db_session.execute(select(Shop).where(Shop.id == 1))).scalar_one()
    # Defaults: NULL.
    assert shop.gstin is None
    assert shop.excise_duty_rate is None
    assert shop.cashier_login_restriction_enabled is False
    assert shop.receiving_vendor_link_enabled is True

    resp = await owner_client.get("/shops/me")
    assert resp.status_code == 200
    body = resp.json()
    assert body["gstin"] is None
    assert body["excise_duty_rate"] is None
    assert body["cashier_login_restriction_enabled"] is False
    assert body["receiving_vendor_link_enabled"] is True


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_owner_updates_gstin_and_duty_rate(
    owner_client: AsyncClient, db_session
) -> None:
    resp = await owner_client.patch(
        "/shops/me",
        json={"gstin": "21ABCDE1234F1Z5", "excise_duty_rate": "20.00"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["gstin"] == "21ABCDE1234F1Z5"
    assert body["excise_duty_rate"] == "20.00"
    assert body["cashier_login_restriction_enabled"] is False
    assert body["receiving_vendor_link_enabled"] is True

    # Persisted.
    shop = (await db_session.execute(select(Shop).where(Shop.id == 1))).scalar_one()
    assert shop.gstin == "21ABCDE1234F1Z5"
    assert shop.excise_duty_rate == 20.00


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_cashier_cannot_update_shop(cashier_client: AsyncClient) -> None:
    resp = await cashier_client.patch(
        "/shops/me",
        json={"gstin": "21ABCDE1234F1Z5"},
    )
    assert resp.status_code == 403


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_invalid_gstin_rejected(owner_client: AsyncClient) -> None:
    # Too short.
    resp = await owner_client.patch("/shops/me", json={"gstin": "SHORT"})
    assert resp.status_code == 422
    # Lowercase letters not allowed.
    resp = await owner_client.patch("/shops/me", json={"gstin": "21abcdE1234F1Z5"})
    assert resp.status_code == 422


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_duty_rate_must_be_0_to_100(owner_client: AsyncClient) -> None:
    for bad in ("-1.00", "100.01", "1000.00"):
        resp = await owner_client.patch(
            "/shops/me", json={"excise_duty_rate": bad}
        )
        assert resp.status_code == 422, f"expected 422 for {bad}"


# --- PDF surface ---


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_pdf_includes_configured_gstin(
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
    cashier_client: AsyncClient,
) -> None:
    await owner_client.patch(
        "/shops/me", json={"gstin": "21ABCDE1234F1Z5"}
    )
    await _seed_product(owner_client, "8908000000001")
    await _seed_lot(receiver_client, owner_client, bc="8908000000001", qty=2)
    inv = await _finalize(cashier_client, bc="8908000000001", qty=1, amount="100.00")

    resp = await cashier_client.get(f"/invoices/{inv['id']}/pdf")
    assert resp.status_code == 200
    body = resp.content
    # The rendered PDF is a binary blob. reportlab PDFs embed the
    # plain-text we passed in; decode and check for the GSTIN.
    text = body.decode("latin-1", errors="replace")
    assert "21ABCDE1234F1Z5" in text, "configured GSTIN should appear in the PDF"


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_pdf_includes_configured_duty_rate(
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
    cashier_client: AsyncClient,
) -> None:
    await owner_client.patch(
        "/shops/me", json={"excise_duty_rate": "20.00"}
    )
    await _seed_product(owner_client, "8908000000002")
    await _seed_lot(receiver_client, owner_client, bc="8908000000002", qty=2)
    inv = await _finalize(cashier_client, bc="8908000000002", qty=1, amount="100.00")

    resp = await cashier_client.get(f"/invoices/{inv['id']}/pdf")
    text = resp.content.decode("latin-1", errors="replace")
    # The duty rate is rendered as e.g. "20.00%".
    assert "20.00%" in text
    # And it's labelled as a placeholder, not a CGST/SGST.
    assert "placeholder" in text.lower()


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_pdf_includes_placeholder_disclaimer(
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
    cashier_client: AsyncClient,
) -> None:
    # Even without configuring a rate, the PDF should still flag the
    # GST/excise line as a placeholder pending confirmation.
    await _seed_product(owner_client, "8908000000003")
    await _seed_lot(receiver_client, owner_client, bc="8908000000003", qty=2)
    inv = await _finalize(cashier_client, bc="8908000000003", qty=1, amount="100.00")

    resp = await cashier_client.get(f"/invoices/{inv['id']}/pdf")
    text = resp.content.decode("latin-1", errors="replace")
    assert "placeholder" in text.lower()
    assert "odisha" in text.lower()  # the disclaimer names the regulator


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_pdf_does_not_hardcode_cgst_or_sgst(
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
    cashier_client: AsyncClient,
) -> None:
    # The AC says no standard CGST/SGST percentage is hardcoded into
    # the calculation. A configured rate is the *only* thing that
    # shows on the invoice. With no rate set, no CGST/SGST line.
    await _seed_product(owner_client, "8908000000004")
    await _seed_lot(receiver_client, owner_client, bc="8908000000004", qty=2)
    inv = await _finalize(cashier_client, bc="8908000000004", qty=1, amount="100.00")

    resp = await cashier_client.get(f"/invoices/{inv['id']}/pdf")
    text = resp.content.decode("latin-1", errors="replace")
    # No CGST or SGST labels in the body.
    # (These are the standard Indian GST slabs — none should appear
    # in v1. The footer disclaimer names "Excise" / "VAT" but those
    # are different labels.)
    assert not re.search(r"\bCGST\b", text), "CGST must not appear"
    assert not re.search(r"\bSGST\b", text), "SGST must not appear"
    assert not re.search(r"\bIGST\b", text), "IGST must not appear"


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_shop_name_appears_on_invoice(
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
    cashier_client: AsyncClient,
    db_session
) -> None:
    # Update the shop name and verify it appears on the next PDF.
    shop = (await db_session.execute(select(Shop).where(Shop.id == 1))).scalar_one()
    shop.name = "Test Liquor Corner"
    await db_session.commit()

    await _seed_product(owner_client, "8908000000005")
    await _seed_lot(receiver_client, owner_client, bc="8908000000005", qty=2)
    inv = await _finalize(cashier_client, bc="8908000000005", qty=1, amount="100.00")

    resp = await cashier_client.get(f"/invoices/{inv['id']}/pdf")
    text = resp.content.decode("latin-1", errors="replace")
    assert "Test Liquor Corner" in text
