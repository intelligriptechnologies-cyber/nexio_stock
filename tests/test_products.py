"""Product catalog + CSV import tests (D-7, D-19, D-52, D-61, R-7, R-10, R-27, R-42)."""
from __future__ import annotations

import pytest
from httpx import AsyncClient

SAMPLE_PRODUCT = {
    "barcode": "8901234567890",
    "brand": "Royal Stag",
    "size_label": "750ml",
    "price": "350.00",
}


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_owner_creates_product(owner_client: AsyncClient) -> None:
    resp = await owner_client.post("/products", json=SAMPLE_PRODUCT)
    assert resp.status_code == 201
    body = resp.json()
    assert body["barcode"] == SAMPLE_PRODUCT["barcode"]
    assert body["brand"] == SAMPLE_PRODUCT["brand"]
    assert body["size_label"] == SAMPLE_PRODUCT["size_label"]
    assert body["price"] == "350.00"
    assert body["is_active"] is True
    assert body["low_stock_threshold"] is None


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_receiver_cannot_create_product(receiver_client: AsyncClient) -> None:
    resp = await receiver_client.post("/products", json=SAMPLE_PRODUCT)
    assert resp.status_code == 403


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_cashier_cannot_create_product(cashier_client: AsyncClient) -> None:
    resp = await cashier_client.post("/products", json=SAMPLE_PRODUCT)
    assert resp.status_code == 403


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_duplicate_barcode_rejected_with_409(
    owner_client: AsyncClient, owner
) -> None:
    # First create succeeds.
    first = await owner_client.post("/products", json=SAMPLE_PRODUCT)
    assert first.status_code == 201
    # Second with the same barcode fails.
    second = await owner_client.post("/products", json=SAMPLE_PRODUCT)
    assert second.status_code == 409
    assert "already exists" in second.json()["detail"]


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_each_bottle_size_is_a_separate_product(owner_client: AsyncClient) -> None:
    # Per D-19, 180ml and 750ml of the same brand are two products with
    # different barcodes and prices — no parent/child.
    small = {**SAMPLE_PRODUCT, "barcode": "8901111111111", "size_label": "180ml", "price": "90.00"}
    big = {**SAMPLE_PRODUCT, "barcode": "8902222222222", "size_label": "750ml", "price": "350.00"}
    r1 = await owner_client.post("/products", json=small)
    r2 = await owner_client.post("/products", json=big)
    assert r1.status_code == 201
    assert r2.status_code == 201
    assert r1.json()["id"] != r2.json()["id"]
    assert r1.json()["barcode"] != r2.json()["barcode"]


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_lookup_by_barcode_succeeds_for_cashier(
    cashier_client: AsyncClient, owner_client: AsyncClient
) -> None:
    # Owner creates the product; cashier looks it up (manual-entry fallback,
    # R-10 / R-27).
    cr = await owner_client.post("/products", json=SAMPLE_PRODUCT)
    assert cr.status_code == 201
    # The cashier client's Authorization header is set by the
    # cashier_client fixture, but the lookup is via query param
    # (?barcode=...) so headers are independent of body.
    resp = await cashier_client.get(
        "/products/lookup", params={"barcode": SAMPLE_PRODUCT["barcode"]}
    )
    assert resp.status_code == 200
    assert resp.json()["barcode"] == SAMPLE_PRODUCT["barcode"]


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_lookup_returns_404_for_unknown_barcode(cashier_client: AsyncClient) -> None:
    resp = await cashier_client.get("/products/lookup", params={"barcode": "nope"})
    assert resp.status_code == 404


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_manual_barcode_entry_falls_back_through_lookup(
    cashier_client: AsyncClient, owner_client: AsyncClient
) -> None:
    # The cashier can "scan" by manually typing the barcode (R-10, R-27);
    # /products/lookup accepts the same string either way.
    await owner_client.post("/products", json=SAMPLE_PRODUCT)
    resp = await cashier_client.get(
        "/products/lookup", params={"barcode": SAMPLE_PRODUCT["barcode"]}
    )
    assert resp.status_code == 200


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_list_filters_to_own_shop(owner_client: AsyncClient, superadmin_client: AsyncClient) -> None:
    await owner_client.post("/products", json=SAMPLE_PRODUCT)
    r1 = await owner_client.get("/products")
    assert r1.status_code == 200
    assert len(r1.json()) == 1
    # superadmin sees across shops.
    r2 = await superadmin_client.get("/products")
    assert r2.status_code == 200
    assert len(r2.json()) == 1  # only one product in the system


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_owner_updates_price_and_threshold(owner_client: AsyncClient) -> None:
    cr = await owner_client.post("/products", json=SAMPLE_PRODUCT)
    product_id = cr.json()["id"]
    resp = await owner_client.patch(
        f"/products/{product_id}",
        json={"price": "400.00", "low_stock_threshold": 5},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["price"] == "400.00"
    assert body["low_stock_threshold"] == 5


# --- CSV import ---


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_csv_import_happy_path(owner_client: AsyncClient) -> None:
    csv_body = (
        "barcode,brand,size_label,price\n"
        "8901234567890,Royal Stag,750ml,350.00\n"
        "8909876543210,Blenders Pride,1000ml,450.00\n"
    )
    resp = await owner_client.post(
        "/products/import-csv",
        files={"file": ("products.csv", csv_body.encode("utf-8"), "text/csv")},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["created"] == 2
    assert body["failed"] == 0
    assert body["errors"] == []


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_csv_import_per_row_errors_are_surfaced(owner_client: AsyncClient) -> None:
    csv_body = (
        "barcode,brand,size_label,price\n"
        "8900000000001,Good Whisky,750ml,300.00\n"  # ok
        ",Bad Row,750ml,100.00\n"  # missing barcode
        "8900000000002,Another,750ml,not-a-number\n"  # bad price
        "8900000000001,Duplicate,750ml,500.00\n"  # collides with row 1
        "8900000000003,Negative Price,750ml,-10.00\n"  # bad price
    )
    resp = await owner_client.post(
        "/products/import-csv",
        files={"file": ("products.csv", csv_body.encode("utf-8"), "text/csv")},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["created"] == 1
    assert body["failed"] == 4
    assert len(body["errors"]) == 4
    # All error rows are listed with the right row numbers (header is row 1).
    rows_with_errors = sorted(e["row"] for e in body["errors"])
    assert rows_with_errors == [3, 4, 5, 6]
    # The duplicate row reports the collision.
    dup_err = next(e for e in body["errors"] if e["row"] == 5)
    assert "already exists" in dup_err["error"]


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_csv_import_with_low_stock_threshold_column(owner_client: AsyncClient) -> None:
    csv_body = (
        "barcode,brand,size_label,price,low_stock_threshold\n"
        "8900000000007,Kingfisher Lager,650ml,180.00,12\n"
    )
    resp = await owner_client.post(
        "/products/import-csv",
        files={"file": ("products.csv", csv_body.encode("utf-8"), "text/csv")},
    )
    assert resp.status_code == 200
    assert resp.json()["created"] == 1
    # Verify the threshold landed.
    # No GET-by-id endpoint; verify the threshold landed via /products/lookup.
    lookup = await owner_client.get(
        "/products/lookup", params={"barcode": "8900000000007"}
    )
    assert lookup.status_code == 200
    assert lookup.json()["low_stock_threshold"] == 12


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_csv_import_rejects_missing_columns(owner_client: AsyncClient) -> None:
    csv_body = "brand,size_label,price\nRoyal Stag,750ml,350.00\n"
    resp = await owner_client.post(
        "/products/import-csv",
        files={"file": ("products.csv", csv_body.encode("utf-8"), "text/csv")},
    )
    assert resp.status_code == 400
    assert "barcode" in resp.json()["detail"]


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_csv_import_rejects_cashier(cashier_client: AsyncClient) -> None:
    csv_body = "barcode,brand,size_label,price\n8901234567890,X,750ml,100.00\n"
    resp = await cashier_client.post(
        "/products/import-csv",
        files={"file": ("products.csv", csv_body.encode("utf-8"), "text/csv")},
    )
    assert resp.status_code == 403


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_csv_import_handles_utf8_bom(owner_client: AsyncClient) -> None:
    # Excel exports CSVs with a BOM; we tolerate it.
    csv_body = "\ufeff" + (
        "barcode,brand,size_label,price\n"
        "8900000000008,Bom Brand,750ml,250.00\n"
    )
    resp = await owner_client.post(
        "/products/import-csv",
        files={"file": ("products.csv", csv_body.encode("utf-8"), "text/csv")},
    )
    assert resp.status_code == 200
    assert resp.json()["created"] == 1
