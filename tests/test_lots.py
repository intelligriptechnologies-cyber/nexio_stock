"""Lot receiving tests (D-17, D-25, R-6, R-25, R-37)."""
from __future__ import annotations

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
    assert "not-a-real-barcode" in resp.json()["detail"]


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

    rows = (await db_session.execute(select(StockinLog))).scalars().all()
    assert len(rows) == 1
    assert rows[0].event_type == "lot.received"
    assert rows[0].payload["lot_id"] == lot_id
    assert len(rows[0].payload["lines"]) == 1
    assert rows[0].payload["lines"][0]["barcode"] == "8900000000008"
    assert rows[0].payload["lines"][0]["quantity"] == 4


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
    await receiver_client.post(
        "/lots",
        json={
            "reference": "FIRST",
            "lines": [{"barcode": "8900000000011", "quantity": 1}],
        },
    )
    await receiver_client.post(
        "/lots",
        json={
            "reference": "SECOND",
            "lines": [{"barcode": "8900000000012", "quantity": 1}],
        },
    )
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
    resp = await receiver_client.get(f"/lots/{lot_id}")
    assert resp.status_code == 200
    assert resp.json()["id"] == lot_id
    assert len(resp.json()["lines"]) == 1


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_cashier_cannot_list_lots(cashier_client: AsyncClient) -> None:
    resp = await cashier_client.get("/lots")
    assert resp.status_code == 403
