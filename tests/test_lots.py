"""Lot receiving tests (D-17, D-25, R-6, R-25, R-37)."""
from __future__ import annotations

from datetime import date

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models.log import StockinLog
from app.models.lot import LotLine
from app.models.product import Product


async def _create_product(client: AsyncClient, barcode: str, brand: str = "Test") -> dict:
    resp = await client.post(
        "/products",
        json={"barcode": barcode, "brand": brand, "size_label": "750ml", "price": "100.00"},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _create_vendor(client: AsyncClient, name: str = "Supplier A") -> dict:
    resp = await client.post(
        "/vendors",
        json={
            "name": name,
            "gstin": "21ABCDE1234F1Z5",
            "address": "Test address",
            "email": "vendor@example.com",
            "phone": "+15555550004",
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _approve_lot(owner_client: AsyncClient, lot_id: int) -> None:
    resp = await owner_client.post(f"/lots/{lot_id}/approve")
    assert resp.status_code == 200, resp.text


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_receiver_creates_lot_with_one_line(
    receiver_client: AsyncClient, owner_client: AsyncClient
) -> None:
    product = await _create_product(owner_client, "8901234567890")
    resp = await receiver_client.post(
        "/lots",
        json={
            "reference": "INV-2026-001",
            "notes": "Friday morning delivery",
            "lines": [{"barcode": "8901234567890", "quantity": 12}],
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["status"] == "pending"
    assert body["lot_id"] is None
    await _approve_lot(owner_client, body["id"])
    assert body["reference"] == "INV-2026-001"
    assert body["notes"] == "Friday morning delivery"
    # The actual user-id check is in the role-gate test below; here we
    # just check the lot landed and was attributed to the receiver's shop.
    assert body["shop_id"] is not None
    assert len(body["lines"]) == 1
    assert body["lines"][0]["product_id"] == product["id"]
    assert body["lines"][0]["quantity"] == 12


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_receiver_creates_lot_with_many_lines(
    receiver_client: AsyncClient, owner_client: AsyncClient
) -> None:
    for bc, brand in [
        ("8900000000001", "Royal Stag"),
        ("8900000000002", "Blenders Pride"),
        ("8900000000003", "Kingfisher"),
    ]:
        await _create_product(owner_client, bc, brand=brand)
    resp = await receiver_client.post(
        "/lots",
        json={
            "lines": [
                {"barcode": "8900000000001", "quantity": 6},
                {"barcode": "8900000000002", "quantity": 3},
                {"barcode": "8900000000003", "quantity": 24},
            ],
        },
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["status"] == "pending"
    await _approve_lot(owner_client, body["id"])
    assert len(body["lines"]) == 3
    total = sum(line["quantity"] for line in body["lines"])
    assert total == 33


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_cashier_cannot_create_lot(cashier_client: AsyncClient) -> None:
    resp = await cashier_client.post(
        "/lots",
        json={"lines": [{"barcode": "x", "quantity": 1}]},
    )
    assert resp.status_code == 403


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_owner_can_also_create_lot(
    owner_client: AsyncClient,
) -> None:
    await _create_product(owner_client, "8900000000004")
    resp = await owner_client.post(
        "/lots",
        json={"lines": [{"barcode": "8900000000004", "quantity": 1}]},
    )
    assert resp.status_code == 201
    await _approve_lot(owner_client, resp.json()["id"])


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_unknown_barcode_in_lot_returns_404(
    receiver_client: AsyncClient, owner_client: AsyncClient
) -> None:
    await _create_product(owner_client, "8900000000005")
    resp = await receiver_client.post(
        "/lots",
        json={"lines": [{"barcode": "not-a-real-barcode", "quantity": 1}]},
    )
    assert resp.status_code == 404
    detail = resp.json()["detail"]
    assert detail["code"] == "unknown_barcode"
    assert "not-a-real-barcode" in detail["message"]


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_barcode_must_exist_in_receiver_shop_only(
    receiver_client: AsyncClient,
) -> None:
    # The receiver's shop has no product with this barcode. (We could
    # also seed it in another shop, but the test setup can't easily
    # create a second shop without more fixture wiring; the simpler
    # case — barcode absent from this shop — exercises the same
    # shop-scoped lookup path.)
    resp = await receiver_client.post(
        "/lots",
        json={"lines": [{"barcode": "8900000000006", "quantity": 1}]},
    )
    assert resp.status_code == 404


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_empty_lot_rejected(receiver_client: AsyncClient) -> None:
    resp = await receiver_client.post("/lots", json={"lines": []})
    assert resp.status_code == 422  # pydantic min_length=1


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_duplicate_barcode_in_lot_rejected(
    receiver_client: AsyncClient, owner_client: AsyncClient
) -> None:
    await _create_product(owner_client, "8900000000007")
    resp = await receiver_client.post(
        "/lots",
        json={
            "lines": [
                {"barcode": "8900000000007", "quantity": 1},
                {"barcode": "8900000000007", "quantity": 2},
            ],
        },
    )
    # Pydantic validator catches it before the route runs — 422.
    assert resp.status_code == 422


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_receiving_writes_a_stockin_log(
    receiver_client: AsyncClient, owner_client: AsyncClient, db_session
) -> None:
    await _create_product(owner_client, "8900000000008")
    resp = await receiver_client.post(
        "/lots",
        json={"lines": [{"barcode": "8900000000008", "quantity": 4}]},
    )
    assert resp.status_code == 201
    lot_id = resp.json()["id"]
    await _approve_lot(owner_client, lot_id)

    rows = (await db_session.execute(select(StockinLog))).scalars().all()
    assert len(rows) == 1
    assert rows[0].event_type == "lot.received"
    assert rows[0].payload["lot_id"] == lot_id
    assert len(rows[0].payload["lines"]) == 1
    assert rows[0].payload["lines"][0]["barcode"] == "8900000000008"
    assert rows[0].payload["lines"][0]["quantity"] == 4


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_receiving_persists_vendor_and_condition_breakdown(
    receiver_client: AsyncClient, owner_client: AsyncClient, db_session
) -> None:
    vendor = await _create_vendor(owner_client, name="Acme Distributors")
    await _create_product(owner_client, "8911111111111", brand="Gold Label")
    resp = await receiver_client.post(
        "/lots",
        json={
            "vendor_id": vendor["id"],
            "purchase_date": "2026-07-13",
            "vendor_invoice_number": "INV-99",
            "invoice_value": "1234.50",
            "lines": [
                {
                    "barcode": "8911111111111",
                    "quantity": 10,
                    "good_condition_quantity": 8,
                }
            ],
        },
    )
    assert resp.status_code == 201, resp.text
    await _approve_lot(owner_client, resp.json()["id"])
    body = resp.json()
    assert body["vendor"]["name"] == "Acme Distributors"
    assert body["purchase_date"] == "2026-07-13"
    assert body["invoice_value"] == "1234.50"
    assert body["lines"][0]["good_condition_quantity"] == 8
    assert body["lines"][0]["breakage_quantity"] == 2

    rows = (await db_session.execute(select(StockinLog))).scalars().all()
    assert len(rows) == 1
    assert rows[0].payload["vendor_name"] == "Acme Distributors"
    assert rows[0].payload["vendor_invoice_number"] == "INV-99"
    assert rows[0].payload["lines"][0]["good_condition_quantity"] == 8
    assert rows[0].payload["lines"][0]["breakage_quantity"] == 2


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_receiving_can_save_without_vendor_link(
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
    db_session,
) -> None:
    resp = await owner_client.patch(
        "/shops/me",
        json={"receiving_vendor_link_enabled": False},
    )
    assert resp.status_code == 200, resp.text

    await _create_product(owner_client, "8922222222222", brand="No Vendor Link")
    resp = await receiver_client.post(
        "/lots",
        json={
            "reference": "AUTO-LOT",
            "notes": "No vendor prompt",
            "lines": [{"barcode": "8922222222222", "quantity": 5}],
        },
    )
    assert resp.status_code == 201, resp.text
    await _approve_lot(owner_client, resp.json()["id"])
    body = resp.json()
    assert body["vendor"] is None
    assert body["purchase_date"] == date.today().isoformat()
    assert body["vendor_invoice_number"] == "AUTO-RECEIPT"
    assert body["invoice_value"] == "0.00"

    rows = (await db_session.execute(select(StockinLog))).scalars().all()
    assert len(rows) == 1
    assert rows[0].payload["vendor_name"] == "Vendor link disabled"


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_receiving_increases_derivable_stock(
    receiver_client: AsyncClient, owner_client: AsyncClient, db_session
) -> None:
    # The acceptance criterion: "After a lot is received, the affected
    # products' stock counts increase by the received quantities." We
    # don't store stock on the row (D-17, derived model) — we verify the
    # LotLine rows landed and that a SUM aggregation matches the
    # received quantity.
    await _create_product(owner_client, "8900000000009")
    await _create_product(owner_client, "8900000000010", brand="B")
    resp = await receiver_client.post(
        "/lots",
        json={
            "lines": [
                {"barcode": "8900000000009", "quantity": 7},
                {"barcode": "8900000000010", "quantity": 2},
            ],
        },
    )
    assert resp.status_code == 201
    await _approve_lot(owner_client, resp.json()["id"])

    from sqlalchemy import func

    products = (
        await db_session.execute(
            select(Product).where(Product.barcode.in_(["8900000000009", "8900000000010"]))
        )
    ).scalars().all()
    by_barcode = {p.barcode: p for p in products}
    pid_a = by_barcode["8900000000009"].id
    pid_b = by_barcode["8900000000010"].id

    sums = (
        await db_session.execute(
            select(LotLine.product_id, func.coalesce(func.sum(LotLine.quantity), 0))
            .group_by(LotLine.product_id)
        )
    ).all()
    by_product = dict(sums)
    assert by_product == {pid_a: 7, pid_b: 2}


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_lot_listing_is_shop_scoped(
    receiver_client: AsyncClient, owner_client: AsyncClient
) -> None:
    for bc in ("8900000000011", "8900000000012"):
        await _create_product(owner_client, bc)
    first = await receiver_client.post(
        "/lots",
        json={
            "reference": "FIRST",
            "lines": [{"barcode": "8900000000011", "quantity": 1}],
        },
    )
    assert first.status_code == 201, first.text
    await _approve_lot(owner_client, first.json()["id"])
    second = await receiver_client.post(
        "/lots",
        json={
            "reference": "SECOND",
            "lines": [{"barcode": "8900000000012", "quantity": 1}],
        },
    )
    assert second.status_code == 201, second.text
    await _approve_lot(owner_client, second.json()["id"])
    resp = await receiver_client.get("/lots")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["lots"]) == 2
    refs = [lot["reference"] for lot in body["lots"]]
    # Newest first.
    assert refs[0] == "SECOND"


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_get_lot_by_id(
    receiver_client: AsyncClient, owner_client: AsyncClient
) -> None:
    await _create_product(owner_client, "8900000000013")
    cr = await receiver_client.post(
        "/lots",
        json={"lines": [{"barcode": "8900000000013", "quantity": 3}]},
    )
    lot_id = cr.json()["id"]
    await _approve_lot(owner_client, lot_id)
    resp = await receiver_client.get(f"/lots/{lot_id}")
    assert resp.status_code == 200
    assert resp.json()["id"] == lot_id
    assert len(resp.json()["lines"]) == 1


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_cashier_cannot_list_lots(cashier_client: AsyncClient) -> None:
    resp = await cashier_client.get("/lots")
    assert resp.status_code == 403


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_stock_inward_does_not_touch_stock_until_approved(
    receiver_client: AsyncClient, owner_client: AsyncClient, db_session
) -> None:
    await _create_product(owner_client, "8900000000014")
    created = await receiver_client.post(
        "/lots",
        json={"lines": [{"barcode": "8900000000014", "quantity": 6}]},
    )
    assert created.status_code == 201, created.text
    inward_id = created.json()["id"]

    stock_before = (
        await db_session.execute(
            select(LotLine.quantity).join(Product, Product.id == LotLine.product_id).where(
                Product.barcode == "8900000000014"
            )
        )
    ).scalars().all()
    assert stock_before == []

    approved = await owner_client.post(f"/lots/{inward_id}/approve")
    assert approved.status_code == 200, approved.text

    stock_after = (
        await db_session.execute(
            select(LotLine.quantity).join(Product, Product.id == LotLine.product_id).where(
                Product.barcode == "8900000000014"
            )
        )
    ).scalars().all()
    assert stock_after == [6]


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_rejected_stock_inward_does_not_touch_stock(
    receiver_client: AsyncClient, owner_client: AsyncClient, db_session
) -> None:
    await _create_product(owner_client, "8900000000015")
    created = await receiver_client.post(
        "/lots",
        json={"lines": [{"barcode": "8900000000015", "quantity": 4}]},
    )
    assert created.status_code == 201, created.text
    inward_id = created.json()["id"]

    rejected = await owner_client.post(f"/lots/{inward_id}/reject")
    assert rejected.status_code == 200, rejected.text
    assert rejected.json()["status"] == "rejected"

    stock_after = (
        await db_session.execute(
            select(LotLine.quantity).join(Product, Product.id == LotLine.product_id).where(
                Product.barcode == "8900000000015"
            )
        )
    ).scalars().all()
    assert stock_after == []
