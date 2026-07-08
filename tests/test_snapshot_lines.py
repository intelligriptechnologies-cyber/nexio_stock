"""Issue #38 — snapshot product name/brand onto invoice & lot lines.

Three contracts under test:

  1. A line created after the migration carries the snapshot brand +
     size from the live ``Product`` at creation time.
  2. Renaming a product afterward does NOT change the already-created
     line's displayed brand or size — the snapshot is immutable.
  3. Pre-migration rows (NULL snapshot columns) are resolved via a live
     ``Product`` join at read time, so the API response still surfaces
     the brand + size instead of NULL/empty.
"""
from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select, update

from app.models.invoice import Invoice, InvoiceLine
from app.models.lot import LotLine
from app.models.product import Product


# --- helpers (re-use the established pattern from test_eod.py) ---


async def _seed_product(
    client: AsyncClient,
    barcode: str,
    *,
    price: str = "100.00",
    brand: str = "Old Brand",
    size_label: str = "750ml",
) -> dict:
    resp = await client.post(
        "/products",
        json={
            "barcode": barcode,
            "brand": brand,
            "size_label": size_label,
            "price": price,
        },
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


# --- snapshot is captured at write time ---


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_invoice_line_snapshot_captured_at_sale(
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
    cashier_client: AsyncClient,
) -> None:
    await _seed_product(
        owner_client, "8903000000038", brand="SnapshotBrand", size_label="650ml"
    )
    await _seed_lot(receiver_client, items=[("8903000000038", 5)])
    inv = await _finalize(
        cashier_client, barcode="8903000000038", quantity=1, amount="100.00"
    )

    line = inv["lines"][0]
    assert line["product_brand"] == "SnapshotBrand"
    assert line["product_size_label"] == "650ml"


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_lot_line_snapshot_captured_at_receive(
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
) -> None:
    await _seed_product(
        owner_client, "8903000000039", brand="LotBrand", size_label="180ml"
    )
    resp = await receiver_client.post(
        "/lots",
        json={"lines": [{"barcode": "8903000000039", "quantity": 3}]},
    )
    assert resp.status_code == 201, resp.text
    lot = resp.json()

    line = lot["lines"][0]
    assert line["product_brand"] == "LotBrand"
    assert line["product_size_label"] == "180ml"


# --- snapshot is immutable across product renames (D-v3-4) ---


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_invoice_line_snapshot_survives_product_rename(
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
    cashier_client: AsyncClient,
    db_session,
) -> None:
    """A product rename after a sale must not retroactively change the
    invoice line's display name (D-v3-4 / R-34 audit-trail invariant)."""
    await _seed_product(
        owner_client, "8903000000040", brand="OriginalName", size_label="750ml"
    )
    await _seed_lot(receiver_client, items=[("8903000000040", 5)])
    inv = await _finalize(
        cashier_client, barcode="8903000000040", quantity=1, amount="100.00"
    )
    line_id = inv["lines"][0]["id"]

    # Rename the product directly in the DB (bypassing the API's
    # update path — we want to test the *snapshot*'s behaviour, not
    # whether the rename API exists).
    await db_session.execute(
        update(Product).where(Product.barcode == "8903000000040").values(brand="RenamedAway")
    )
    await db_session.commit()

    # Read the invoice again — the line still shows the original brand.
    fetched = await owner_client.get(f"/invoices/{inv['id']}")
    assert fetched.status_code == 200, fetched.text
    body = fetched.json()
    fetched_line = next(ln for ln in body["lines"] if ln["id"] == line_id)
    assert fetched_line["product_brand"] == "OriginalName"


# --- pre-migration row fallback via live Product join ---


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_pre_migration_invoice_line_resolves_via_live_join(
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
    cashier_client: AsyncClient,
    db_session,
) -> None:
    """A line that pre-dates the snapshot migration (NULL snapshot
    columns) still resolves brand + size via a live ``Product`` join
    — never NULL on the wire."""
    await _seed_product(
        owner_client, "8903000000041", brand="LiveFallbackBrand", size_label="330ml"
    )
    await _seed_lot(receiver_client, items=[("8903000000041", 5)])
    inv = await _finalize(
        cashier_client, barcode="8903000000041", quantity=1, amount="100.00"
    )

    # Simulate a pre-migration row by NULLing out the snapshot columns
    # directly. The API layer must backfill on read.
    await db_session.execute(
        update(InvoiceLine)
        .where(InvoiceLine.invoice_id == inv["id"])
        .values(product_brand=None, product_size_label=None)
    )
    await db_session.commit()

    fetched = await owner_client.get(f"/invoices/{inv['id']}")
    assert fetched.status_code == 200
    line = fetched.json()["lines"][0]
    assert line["product_brand"] == "LiveFallbackBrand"
    assert line["product_size_label"] == "330ml"


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_pre_migration_lot_line_resolves_via_live_join(
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
    db_session,
) -> None:
    """Same fallback contract for the lot line read paths."""
    await _seed_product(
        owner_client, "8903000000042", brand="LotFallback", size_label="500ml"
    )
    resp = await receiver_client.post(
        "/lots",
        json={"lines": [{"barcode": "8903000000042", "quantity": 2}]},
    )
    assert resp.status_code == 201
    lot_id = resp.json()["id"]

    await db_session.execute(
        update(LotLine)
        .where(LotLine.lot_id == lot_id)
        .values(product_brand=None, product_size_label=None)
    )
    await db_session.commit()

    fetched = await owner_client.get(f"/lots/{lot_id}")
    assert fetched.status_code == 200
    line = fetched.json()["lines"][0]
    assert line["product_brand"] == "LotFallback"
    assert line["product_size_label"] == "500ml"


# --- the receipt popup / invoice preview paths are now brand+size, not product_id ---


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_invoice_pdf_renders_brand_and_size(
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
    cashier_client: AsyncClient,
) -> None:
    await _seed_product(
        owner_client, "8903000000043", brand="PdfBrand", size_label="1L"
    )
    await _seed_lot(receiver_client, items=[("8903000000043", 5)])
    inv = await _finalize(
        cashier_client, barcode="8903000000043", quantity=1, amount="100.00"
    )

    pdf = await owner_client.get(f"/invoices/{inv['id']}/pdf")
    assert pdf.status_code == 200
    body = pdf.content.decode("latin-1", errors="ignore")
    assert "PdfBrand" in body, "PDF should include the product brand"
    assert "1L" in body, "PDF should include the size label"
    # Raw product_id should NOT appear as a product label — the cell
    # used to read "#<id>" before the fix.
    assert f"#{inv['lines'][0]['product_id']}" not in body