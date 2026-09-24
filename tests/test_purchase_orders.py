"""OSBCL import, permissions, and approved-receipt reconciliation."""
from __future__ import annotations

from decimal import Decimal

import pymupdf
import pytest
from httpx import AsyncClient

from app.config import get_settings
from app.services.osbcl_parser import ParsedLine, ParsedOrder


def _parsed_order() -> ParsedOrder:
    return ParsedOrder(
        osbcl_token="OD-KHO(T)/9/2026-2027",
        order_date="2026-09-19",
        order_type="Liquor",
        retailer_code="2534",
        total_cases=1,
        total_loose_bottles=0,
        mger_total=Decimal("50.00"),
        order_total=Decimal("80.00"),
        confidence=0.99,
        lines=[
            ParsedLine(
                source_item_name="Test Whisky(750)",
                size_ml=750,
                cases=1,
                loose_bottles=0,
                case_rate=Decimal("80.00"),
                mger=Decimal("50.00"),
                amount=Decimal("80.00"),
                sequence=1,
                confidence=0.99,
            )
        ],
    )


def _pdf_bytes() -> bytes:
    document = pymupdf.open()
    document.new_page()
    data = document.tobytes()
    document.close()
    return data


@pytest.mark.usefixtures("owner", "receiver")
async def test_import_confirm_partial_and_audited_over_receipt(
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
    tmp_path,
    monkeypatch,
) -> None:
    monkeypatch.setattr(get_settings(), "po_storage_root", tmp_path)
    monkeypatch.setattr("app.api.purchase_orders.parse_osbcl_pdf", lambda _path: _parsed_order())

    product_response = await owner_client.post(
        "/products",
        json={"barcode": "8900000000750", "brand": "Test Whisky", "size_label": "750ml", "price": "100.00"},
    )
    assert product_response.status_code == 201, product_response.text
    vendor_response = await owner_client.get("/vendors")
    vendor_id = vendor_response.json()[0]["id"]

    imported = await receiver_client.post(
        "/purchase-orders/import",
        files={"file": ("order.pdf", _pdf_bytes(), "application/pdf")},
    )
    assert imported.status_code == 201, imported.text
    order = imported.json()
    assert order["status"] == "draft"
    assert order["lines"][0]["product_id"] == product_response.json()["id"]
    assert order["lines"][0]["ordered_bottles"] == 8

    duplicate = await receiver_client.post(
        "/purchase-orders/import",
        files={"file": ("renamed.pdf", _pdf_bytes(), "application/pdf")},
    )
    assert duplicate.status_code == 409
    assert (await receiver_client.post(f"/purchase-orders/{order['id']}/confirm")).status_code == 403
    confirmed = await owner_client.post(f"/purchase-orders/{order['id']}/confirm")
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["status"] == "open"

    original = await receiver_client.get(f"/purchase-orders/{order['id']}/original")
    assert original.status_code == 200
    assert original.content.startswith(b"%PDF-")

    async def receive(quantity: int, *, reason: str | None = None) -> int:
        response = await receiver_client.post(
            "/lots",
            json={
                "vendor_id": vendor_id,
                "purchase_date": "2026-09-23",
                "vendor_invoice_number": f"INV-{quantity}-{reason or 'normal'}",
                "invoice_value": f"{quantity * 10:.2f}",
                "purchase_order_id": order["id"],
                "over_receipt_reason": reason,
                "lines": [{
                    "barcode": "8900000000750",
                    "quantity": quantity,
                    "good_condition_quantity": quantity,
                    "unit_cost": "10.00",
                    "purchase_order_line_id": order["lines"][0]["id"],
                }],
            },
        )
        assert response.status_code == 201, response.text
        return response.json()["id"]

    partial_id = await receive(4)
    assert (await owner_client.post(f"/lots/{partial_id}/approve")).status_code == 200
    partial = await owner_client.get(f"/purchase-orders/{order['id']}")
    assert partial.json()["status"] == "partially_received"
    assert partial.json()["lines"][0]["remaining_bottles"] == 4

    unaudited_excess_id = await receive(5)
    unaudited_approval = await owner_client.post(f"/lots/{unaudited_excess_id}/approve")
    assert unaudited_approval.status_code == 409
    assert "audit reason" in unaudited_approval.text

    excess_id = await receive(5, reason="One replacement bottle authorised by OSBCL")
    assert (await owner_client.post(f"/lots/{excess_id}/approve")).status_code == 200
    fulfilled = await owner_client.get(f"/purchase-orders/{order['id']}")
    line = fulfilled.json()["lines"][0]
    assert fulfilled.json()["status"] == "fulfilled"
    assert line["delivered_bottles"] == 9
    assert line["accepted_bottles"] == 9
    assert line["broken_bottles"] == 0
    assert line["remaining_bottles"] == 0
    assert line["excess_bottles"] == 1
