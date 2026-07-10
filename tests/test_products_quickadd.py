"""Issue #22 — Product pending status + quick-add (receiving).

Tests mirror the acceptance criteria in the issue body. Each AC is
asserted via the FastAPI HTTP seam (no internal function calls).
"""
from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select, text

from app.db import get_sessionmaker
from app.models.log import StockinLog
from app.models.product import Product, ProductStatus

# --- AC #1 — Product.status exists, price nullable for pending, existing
# rows migrate to active. Checked at the schema level via a DB query. ---


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_status_column_exists_with_pending_and_active_values() -> None:
    """AC #1: ``products.status`` column exists with both values accepted."""
    Session = get_sessionmaker()
    async with Session() as session:
        # The schema migration installs both literal forms (CHECK
        # constraint accepts them). A bare SELECT to information_schema
        # confirms the column shape.
        cols = (
            await session.execute(
                text(
                    "SELECT column_name, data_type, is_nullable, column_default "
                    "FROM information_schema.columns "
                    "WHERE table_name = 'products' AND column_name = 'status'"
                )
            )
        ).one()
        assert cols.column_name == "status"
        assert cols.is_nullable == "NO"
        assert "active" in (cols.column_default or "")


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_price_is_nullable_for_pending_rows(
    owner_client: AsyncClient,
) -> None:
    """AC #1: price can be NULL for a pending product (CHECK allows it)."""
    r = await owner_client.post(
        "/products/quick-add",
        json={"barcode": "8900000000099", "brand": "Pending Brand", "size_label": "750ml"},
        headers={"Idempotency-Key": "qa-1"},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["status"] == "pending"
    assert body["price"] is None

    Session = get_sessionmaker()
    async with Session() as session:
        row = (
            await session.execute(select(Product).where(Product.id == body["id"]))
        ).scalar_one()
        assert row.price is None
        assert row.status == ProductStatus.PENDING


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_existing_active_product_migrates_cleanly(
    owner_client: AsyncClient,
) -> None:
    """AC #1: an existing active product with a price still works post-migration."""
    r = await owner_client.post(
        "/products",
        json={
            "barcode": "8901234567000",
            "brand": "Royal Stag",
            "size_label": "750ml",
            "price": "350.00",
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["status"] == "active"
    assert body["price"] == "350.00"


# --- AC #2 — quick-add endpoint creates a pending Product from
# {barcode, brand, size_label} only. ---


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_owner_quick_add_creates_pending_product(
    owner_client: AsyncClient,
) -> None:
    r = await owner_client.post(
        "/products/quick-add",
        json={"barcode": "8900000000101", "brand": "Blenders Pride", "size_label": "1000ml"},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["status"] == "pending"
    assert body["price"] is None
    assert body["low_stock_threshold"] is None
    assert body["barcode"] == "8900000000101"
    assert body["brand"] == "Blenders Pride"
    assert body["size_label"] == "1000ml"


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_receiver_quick_add_creates_pending_product(
    receiver_client: AsyncClient,
) -> None:
    """D-v2-10: receiver can also use quick-add (it's the primary receiver flow)."""
    r = await receiver_client.post(
        "/products/quick-add",
        json={"barcode": "8900000000102", "brand": "New Brand", "size_label": "750ml"},
    )
    assert r.status_code == 201, r.text
    assert r.json()["status"] == "pending"


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_cashier_quick_add_creates_pending_product(
    cashier_client: AsyncClient,
) -> None:
    """D-v2-10: cashier can also use quick-add."""
    r = await cashier_client.post(
        "/products/quick-add",
        json={"barcode": "8900000000103", "brand": "New Brand", "size_label": "750ml"},
    )
    assert r.status_code == 201, r.text
    assert r.json()["status"] == "pending"


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_superadmin_quick_add_requires_shop_id(superadmin_client: AsyncClient) -> None:
    r = await superadmin_client.post(
        "/products/quick-add",
        json={"barcode": "8900000000104", "brand": "X", "size_label": "750ml"},
    )
    assert r.status_code == 400
    assert r.json()["detail"] == "Select a shop before adding this product."


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_superadmin_quick_add_with_shop_id_creates_pending_product(
    superadmin_client: AsyncClient,
    shop,
) -> None:
    r = await superadmin_client.post(
        "/products/quick-add",
        json={
            "barcode": "8900000000104",
            "brand": "Super Brand",
            "size_label": "750ml",
            "shop_id": shop.id,
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["status"] == "pending"
    assert body["shop_id"] == shop.id


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_quick_add_rejects_extra_fields(
    owner_client: AsyncClient,
) -> None:
    """``extra='forbid'`` on the schema — frontend can't sneak a price through."""
    r = await owner_client.post(
        "/products/quick-add",
        json={
            "barcode": "8900000000105",
            "brand": "X",
            "size_label": "750ml",
            "price": "100.00",  # forbidden — quick-add is price-less
        },
    )
    assert r.status_code == 422


# --- AC #3 — pending product can be received into a Lot, quantity counts as stock. ---


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_pending_product_can_be_received_into_lot(
    receiver_client: AsyncClient, owner_client: AsyncClient, db_session
) -> None:
    """D-v2-6: the received quantity of a pending product counts as real stock
    immediately (no Lot rejection, no special-cased bypass)."""
    # 1. Quick-add a new product → pending
    qa = await owner_client.post(
        "/products/quick-add",
        json={"barcode": "8900000000110", "brand": "Pending Brand", "size_label": "750ml"},
        headers={"Idempotency-Key": "qa-pending-receive-1"},
    )
    assert qa.status_code == 201, qa.text
    pending_id = qa.json()["id"]

    # 2. Receiver creates a Lot referencing the pending barcode — no 404.
    lot_resp = await receiver_client.post(
        "/lots",
        json={"lines": [{"barcode": "8900000000110", "quantity": 12}]},
    )
    assert lot_resp.status_code == 201, lot_resp.text
    lot_body = lot_resp.json()
    assert len(lot_body["lines"]) == 1
    assert lot_body["lines"][0]["product_id"] == pending_id
    assert lot_body["lines"][0]["quantity"] == 12

    # 3. Verify the pending product is still pending (receiving does not flip status).
    Session = get_sessionmaker()
    async with Session() as session:
        row = (
            await session.execute(select(Product).where(Product.id == pending_id))
        ).scalar_one()
        assert row.status == ProductStatus.PENDING
        assert row.price is None


# --- AC #4 — Quick-add is idempotent per barcode; same-barcode race is
# rejected cleanly (not 500), UI gets a friendly conflict message. ---


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_quick_add_same_key_retry_409s(
    owner_client: AsyncClient,
) -> None:
    """Architecture review Candidate C (2026-07-08): the in-memory
    idempotency cache was deleted. A same-key retry now falls through
    to the DB UNIQUE(barcode) constraint and returns 409, same as
    any other same-barcode race. This is the deletion-test passing:
    removing the cache observably changes nothing for the live UI
    (which always regenerates a random key per submit) — same-key
    replay is now caught by the same race path as a true barcode
    collision.
    """
    key = f"qa-idem-{uuid.uuid4().hex[:8]}"
    payload = {"barcode": "8900000000120", "brand": "Idem Brand", "size_label": "750ml"}
    first = await owner_client.post(
        "/products/quick-add", json=payload, headers={"Idempotency-Key": key}
    )
    assert first.status_code == 201, first.text
    first_id = first.json()["id"]

    # Same key + same barcode -> the global UNIQUE(barcode) constraint
    # rejects the second insert with 409 (same as the
    # test_quick_add_duplicate_barcode_returns_409_with_friendly_message
    # test, which is the real dedupe path).
    second = await owner_client.post(
        "/products/quick-add", json=payload, headers={"Idempotency-Key": key}
    )
    assert second.status_code == 409, second.text
    assert "already exists" in second.json()["detail"]

    # And the original product is unchanged.
    lookup = await owner_client.get(
        "/products/lookup", params={"barcode": "8900000000120"}
    )
    assert lookup.status_code == 200
    assert lookup.json()["id"] == first_id


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_quick_add_duplicate_barcode_returns_409_with_friendly_message(
    owner_client: AsyncClient, receiver_client: AsyncClient
) -> None:
    """D-v2-9 + AC #4: two staff quick-adding the same barcode race — the second
    gets a 409 (not a 500) with a friendly detail string the UI can render
    as 'Someone already added this — refreshing'."""
    payload = {"barcode": "8900000000121", "brand": "Race Brand", "size_label": "750ml"}
    first = await owner_client.post("/products/quick-add", json=payload)
    assert first.status_code == 201, first.text

    # Different idempotency key (different actor's tab — same barcode).
    second = await receiver_client.post(
        "/products/quick-add",
        json=payload,
        headers={"Idempotency-Key": "qa-race-2"},
    )
    assert second.status_code == 409, second.text
    assert "already exists" in second.json()["detail"]


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_quick_add_conflict_with_existing_active_product(
    owner_client: AsyncClient,
) -> None:
    """D-v2-9: trying to quick-add a barcode that's already an active product
    returns 409, not 500. The CHECK constraint shouldn't fire (existing row
    has price), but the unique-barcode constraint does."""
    # 1. Create an active product normally.
    create = await owner_client.post(
        "/products",
        json={
            "barcode": "8900000000122",
            "brand": "Active Brand",
            "size_label": "750ml",
            "price": "200.00",
        },
    )
    assert create.status_code == 201

    # 2. Quick-add the same barcode — should 409, not 500.
    dup = await owner_client.post(
        "/products/quick-add",
        json={"barcode": "8900000000122", "brand": "Dup", "size_label": "750ml"},
    )
    assert dup.status_code == 409, dup.text
    assert "already exists" in dup.json()["detail"]


# --- AC #6 — stockin_logs gets a product.pending_created entry when triggered from receiving. ---


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_quick_add_writes_stockin_log_entry(
    owner_client: AsyncClient,
) -> None:
    """AC #6: default origin (receiving, since #22 scope) writes to stockin_logs
    with event_type='product.pending_created'."""
    r = await owner_client.post(
        "/products/quick-add",
        json={"barcode": "8900000000130", "brand": "Logged Brand", "size_label": "750ml"},
        headers={"X-Quick-Add-Origin": "receiving"},
    )
    assert r.status_code == 201, r.text
    product_id = r.json()["id"]

    Session = get_sessionmaker()
    async with Session() as session:
        log_rows = (
            await session.execute(
                select(StockinLog).where(
                    StockinLog.event_type == "product.pending_created",
                    StockinLog.shop_id.is_not(None),
                )
            )
        ).scalars().all()
        matching = [
            row for row in log_rows if row.payload.get("product_id") == product_id
        ]
        assert len(matching) == 1
        payload = matching[0].payload
        assert payload["barcode"] == "8900000000130"
        assert payload["brand"] == "Logged Brand"
        assert payload["size_label"] == "750ml"
        assert payload["origin"] == "receiving"


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_quick_add_receiving_is_default_log_destination(
    owner_client: AsyncClient,
) -> None:
    """When the X-Quick-Add-Origin header is omitted, default to 'receiving'."""
    r = await owner_client.post(
        "/products/quick-add",
        json={"barcode": "8900000000131", "brand": "Default Origin", "size_label": "750ml"},
    )
    assert r.status_code == 201, r.text
    product_id = r.json()["id"]

    Session = get_sessionmaker()
    async with Session() as session:
        row = (
            await session.execute(
                select(StockinLog).where(
                    StockinLog.event_type == "product.pending_created",
                )
            )
        ).scalars().one()
        assert row.payload["product_id"] == product_id
        assert row.payload["origin"] == "receiving"


# --- Additional behavior tests (not in ACs but in scope). ---


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_lookup_returns_pending_product_for_receiver(
    receiver_client: AsyncClient, owner_client: AsyncClient
) -> None:
    """A pending product MUST be resolvable via /products/lookup — the
    receiver needs to scan it into a Lot (D-v2-6). The frontend can then
    see ``status='pending'`` and either show 'Add to lot' or 'Pending'."""
    qa = await owner_client.post(
        "/products/quick-add",
        json={"barcode": "8900000000140", "brand": "Lookup", "size_label": "750ml"},
    )
    assert qa.status_code == 201

    lookup = await receiver_client.get(
        "/products/lookup", params={"barcode": "8900000000140"}
    )
    assert lookup.status_code == 200, lookup.text
    body = lookup.json()
    assert body["status"] == "pending"
    assert body["price"] is None


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_pending_product_not_in_active_only_list(
    owner_client: AsyncClient,
) -> None:
    """Pending products ARE in the default (active_only=true) list — the
    frontend catalog cache should include them so the receiver can scan
    them after quick-add. They're only hidden when is_active=False."""
    await owner_client.post(
        "/products/quick-add",
        json={"barcode": "8900000000141", "brand": "X", "size_label": "750ml"},
    )
    r = await owner_client.get("/products")
    assert r.status_code == 200
    barcodes = [p["barcode"] for p in r.json()]
    assert "8900000000141" in barcodes
