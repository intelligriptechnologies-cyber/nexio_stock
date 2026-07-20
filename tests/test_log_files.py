"""Daily text log file APIs and live writes."""
from __future__ import annotations

import csv
import os
import uuid
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import pytest
from httpx import AsyncClient

from app.config import get_settings
from app.services.log_files import append_log_line, daily_log_path


@pytest.fixture
def log_files_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setenv("LOG_FILES_DIR", str(tmp_path))
    get_settings.cache_clear()  # type: ignore[attr-defined]
    yield tmp_path
    get_settings.cache_clear()  # type: ignore[attr-defined]


async def _create_product(client: AsyncClient, barcode: str, brand: str = "Test") -> None:
    resp = await client.post(
        "/products",
        json={"barcode": barcode, "brand": brand, "size_label": "750ml", "price": "100.00"},
    )
    assert resp.status_code == 201, resp.text


async def _create_lot(
    receiver_client: AsyncClient, owner_client: AsyncClient, barcode: str
) -> None:
    resp = await receiver_client.post(
        "/lots",
        json={"reference": "DEL-1", "lines": [{"barcode": barcode, "quantity": 5}]},
    )
    assert resp.status_code == 201, resp.text
    inward_id = resp.json()["id"]
    approved = await owner_client.post(f"/lots/{inward_id}/approve")
    assert approved.status_code == 200, approved.text


async def _finalize(cashier_client: AsyncClient, barcode: str) -> None:
    resp = await cashier_client.post(
        "/checkout/finalize",
        headers={"Idempotency-Key": f"k-{uuid.uuid4().hex}"},
        json={
            "lines": [{"barcode": barcode, "quantity": 1}],
            "payments": [{"mode": "cash", "amount": "100.00"}],
        },
    )
    assert resp.status_code == 201, resp.text


def _write_log_fixture(path: Path, *, content: str, modified_at: datetime) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    ts = modified_at.timestamp()
    os.utime(path, (ts, ts))


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_live_events_append_daily_english_files(
    log_files_dir: Path,
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
    cashier_client: AsyncClient,
    shop,
) -> None:
    await _create_product(owner_client, "8909100000001", brand="Royal Stag")
    await _create_lot(receiver_client, owner_client, "8909100000001")
    await _finalize(cashier_client, "8909100000001")
    signoff = await owner_client.post(
        "/dashboard/eod/sign-off", json={"business_date": date.today().isoformat()}
    )
    assert signoff.status_code == 201, signoff.text

    checkout = daily_log_path(
        "checkout", shop_id=shop.id, log_scope_key=shop.log_scope_key
    ).read_text(encoding="utf-8")
    receiving = daily_log_path(
        "receiving", shop_id=shop.id, log_scope_key=shop.log_scope_key
    ).read_text(encoding="utf-8")
    closing = daily_log_path(
        "closing", shop_id=shop.id, log_scope_key=shop.log_scope_key
    ).read_text(encoding="utf-8")
    checkout_csv_path = daily_log_path(
        "checkout", shop_id=shop.id, log_scope_key=shop.log_scope_key, extension="csv"
    )
    receiving_csv_path = daily_log_path(
        "receiving", shop_id=shop.id, log_scope_key=shop.log_scope_key, extension="csv"
    )
    checkout_csv = checkout_csv_path.read_text(encoding="utf-8")
    receiving_csv = receiving_csv_path.read_text(encoding="utf-8")

    assert "Checkout finalized for" in checkout
    assert "invoice #1" in checkout
    assert "total Rs. 100.00" in checkout
    assert "payment mode cash" in checkout
    assert "payments: cash Rs. 100.00" in checkout
    assert "Receiving lot #" in receiving
    assert "Owner One" in receiving
    assert "Royal Stag 750ml x 5" in receiving
    assert "row total Rs. 500.00" in receiving
    assert "EOD sign-off completed" in closing
    assert "invoice count 1" in closing
    assert checkout_csv_path.exists()
    assert receiving_csv_path.exists()
    assert "invoice_id" in checkout_csv.splitlines()[0]
    assert "product_name_snapshot" in receiving_csv.splitlines()[0]
    assert "vendor_name" in receiving_csv.splitlines()[0]
    assert "good_condition_quantity" in receiving_csv.splitlines()[0]
    checkout_rows = list(csv.DictReader(checkout_csv.splitlines()))
    receiving_rows = list(csv.DictReader(receiving_csv.splitlines()))
    assert len(checkout_rows) == 1
    assert len(receiving_rows) == 1
    assert checkout_rows[0]["barcode"] == "8909100000001"
    assert checkout_rows[0]["product_name_snapshot"] == "Royal Stag 750ml"
    assert checkout_rows[0]["shop_name"] == shop.name
    assert checkout_rows[0]["actor_name"] == "Cashier One"
    assert checkout_rows[0]["payment_mode"] == "cash"
    assert checkout_rows[0]["payment_details"].startswith("[")
    assert receiving_rows[0]["barcode"] == "8909100000001"
    assert receiving_rows[0]["product_name_snapshot"] == "Royal Stag 750ml"
    assert receiving_rows[0]["shop_name"] == shop.name
    assert receiving_rows[0]["actor_name"] == "Owner One"
    assert receiving_rows[0]["vendor_name"]
    assert receiving_rows[0]["purchase_date"]
    assert receiving_rows[0]["vendor_invoice_number"]
    assert receiving_rows[0]["current_price"] == "100.00"
    assert receiving_rows[0]["row_total"] == "500.00"


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_checkout_and_receiving_csv_rows_follow_line_items(
    log_files_dir: Path,
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
    cashier_client: AsyncClient,
    shop,
) -> None:
    await _create_product(owner_client, "8909200000001", brand="Royal Stag")
    await _create_product(owner_client, "8909200000002", brand="Blenders Pride")
    lot = await receiver_client.post(
        "/lots",
        json={
            "reference": "DEL-2",
            "notes": "Bulk receiving",
            "lines": [
                {"barcode": "8909200000001", "quantity": 4},
                {"barcode": "8909200000002", "quantity": 2},
            ],
        },
    )
    assert lot.status_code == 201, lot.text
    inward_id = lot.json()["id"]
    approved = await owner_client.post(f"/lots/{inward_id}/approve")
    assert approved.status_code == 200, approved.text
    assert (
        await cashier_client.post(
            "/checkout/finalize",
            headers={"Idempotency-Key": f"k-{uuid.uuid4().hex}"},
            json={
                "lines": [
                    {"barcode": "8909200000001", "quantity": 1},
                    {"barcode": "8909200000002", "quantity": 2},
                ],
                "payments": [
                    {"mode": "cash", "amount": "100.00"},
                    {"mode": "upi", "amount": "200.00"},
                ],
            },
        )
    ).status_code == 201

    checkout_csv = daily_log_path(
        "checkout", shop_id=shop.id, log_scope_key=shop.log_scope_key, extension="csv"
    ).read_text(encoding="utf-8")
    receiving_csv = daily_log_path(
        "receiving", shop_id=shop.id, log_scope_key=shop.log_scope_key, extension="csv"
    ).read_text(encoding="utf-8")

    checkout_rows = list(csv.DictReader(checkout_csv.splitlines()))
    receiving_rows = list(csv.DictReader(receiving_csv.splitlines()))
    assert len(checkout_rows) == 2
    assert len(receiving_rows) == 2

    checkout_barcodes = {row["barcode"] for row in checkout_rows}
    assert checkout_barcodes == {"8909200000001", "8909200000002"}
    assert all(row["invoice_total"] == "300.00" for row in checkout_rows)
    assert all(row["payment_mode"] == "cash + upi split" for row in checkout_rows)
    assert all("\"mode\": \"cash\"" in row["payment_details"] for row in checkout_rows)
    assert all("\"mode\": \"upi\"" in row["payment_details"] for row in checkout_rows)
    assert all(row["shop_name"] == shop.name for row in checkout_rows)

    receiving_barcodes = {row["barcode"] for row in receiving_rows}
    assert receiving_barcodes == {"8909200000001", "8909200000002"}
    assert all(row["reference"] == "DEL-2" for row in receiving_rows)
    assert all(row["notes"] == "Bulk receiving" for row in receiving_rows)
    assert all(row["current_price"] == "100.00" for row in receiving_rows)
    assert {row["row_total"] for row in receiving_rows} == {"400.00", "200.00"}
    assert all(row["good_condition_quantity"] for row in receiving_rows)
    assert all(row["breakage_quantity"] for row in receiving_rows)


@pytest.mark.usefixtures("owner")
async def test_log_file_retention_defaults_updates_and_cleans_expired_files(
    log_files_dir: Path,
    owner_client: AsyncClient,
    shop,
) -> None:
    old_day = date.today() - timedelta(days=10)
    old_path = daily_log_path(
        "checkout", shop_id=shop.id, log_scope_key=shop.log_scope_key, day=old_day
    )
    old_csv = daily_log_path(
        "checkout", shop_id=shop.id, log_scope_key=shop.log_scope_key, day=old_day, extension="csv"
    )
    old_path.parent.mkdir(parents=True, exist_ok=True)
    old_path.write_text("old\n", encoding="utf-8")
    old_csv.write_text("old csv\n", encoding="utf-8")
    fresh_path = daily_log_path("checkout", shop_id=shop.id, log_scope_key=shop.log_scope_key)
    fresh_csv = daily_log_path(
        "checkout", shop_id=shop.id, log_scope_key=shop.log_scope_key, extension="csv"
    )
    fresh_path.parent.mkdir(parents=True, exist_ok=True)
    fresh_path.write_text("fresh\n", encoding="utf-8")
    fresh_csv.write_text("fresh csv\n", encoding="utf-8")

    listed = await owner_client.get("/logs/files/checkout")
    assert listed.status_code == 200, listed.text
    body = listed.json()
    assert body["retention_days"] == 10
    assert {row["filename"] for row in body["files"]} == {fresh_csv.name, fresh_path.name}
    assert not old_path.exists()
    assert not old_csv.exists()

    patched = await owner_client.patch(
        "/logs/files/checkout/retention", json={"retention_days": 3}
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["retention_days"] == 3

    listed_again = await owner_client.get("/logs/files/checkout")
    assert listed_again.json()["retention_days"] == 3

    csv_download = await owner_client.get(
        f"/logs/files/checkout/{fresh_csv.name}/download"
    )
    assert csv_download.status_code == 200, csv_download.text
    assert csv_download.headers["content-type"].startswith("text/csv")
    assert "fresh csv" in csv_download.text


@pytest.mark.usefixtures("owner", "superadmin")
async def test_exception_logs_are_superadmin_only_and_downloadable(
    log_files_dir: Path,
    owner_client: AsyncClient,
    superadmin_client: AsyncClient,
) -> None:
    append_log_line(
        "exceptions",
        shop_id=None,
        system=True,
        text="Unhandled exception during GET /boom; RuntimeError: boom",
    )

    owner_list = await owner_client.get("/logs/files/exceptions")
    assert owner_list.status_code == 403

    listed = await superadmin_client.get("/logs/files/exceptions")
    assert listed.status_code == 200, listed.text
    files = listed.json()["files"]
    assert len(files) == 1
    assert files[0]["filename"].startswith("exceptions-")

    downloaded = await superadmin_client.get(
        f"/logs/files/exceptions/{files[0]['filename']}/download"
    )
    assert downloaded.status_code == 200, downloaded.text
    assert "RuntimeError: boom" in downloaded.text


@pytest.mark.usefixtures("owner", "superadmin")
async def test_shop_log_listing_filters_stale_legacy_files_and_migrates_eligible_ones(
    log_files_dir: Path,
    db_session,
    owner_client: AsyncClient,
    superadmin_client: AsyncClient,
    shop,
) -> None:
    shop.created_at = datetime(2026, 7, 19, 9, 0, tzinfo=UTC)
    await db_session.commit()
    await db_session.refresh(shop)

    stale_day = date(2026, 7, 14)
    eligible_day = date(2026, 7, 20)
    stale_txt = daily_log_path("checkout", shop_id=shop.id, day=stale_day)
    stale_csv = daily_log_path("checkout", shop_id=shop.id, day=stale_day, extension="csv")
    eligible_txt = daily_log_path("checkout", shop_id=shop.id, day=eligible_day)
    eligible_csv = daily_log_path("checkout", shop_id=shop.id, day=eligible_day, extension="csv")

    _write_log_fixture(
        stale_txt,
        content="stale legacy text\n",
        modified_at=datetime(2026, 7, 14, 10, 0, tzinfo=UTC),
    )
    _write_log_fixture(
        stale_csv,
        content="header\nstale-row\n",
        modified_at=datetime(2026, 7, 14, 10, 0, tzinfo=UTC),
    )
    _write_log_fixture(
        eligible_txt,
        content="eligible legacy text\n",
        modified_at=datetime(2026, 7, 20, 10, 0, tzinfo=UTC),
    )
    _write_log_fixture(
        eligible_csv,
        content="header\neligible-row\n",
        modified_at=datetime(2026, 7, 20, 10, 0, tzinfo=UTC),
    )
    orphan = log_files_dir / "shop-999" / "checkout" / "checkout-2026-07-20.txt"
    _write_log_fixture(
        orphan,
        content="orphan\n",
        modified_at=datetime(2026, 7, 20, 10, 0, tzinfo=UTC),
    )

    owner_list = await owner_client.get("/logs/files/checkout")
    assert owner_list.status_code == 200, owner_list.text
    owner_files = {row["filename"] for row in owner_list.json()["files"]}
    assert owner_files == {eligible_txt.name, eligible_csv.name}

    superadmin_scoped = await superadmin_client.get("/logs/files/checkout", params={"shop_id": shop.id})
    assert superadmin_scoped.status_code == 200, superadmin_scoped.text
    assert {row["filename"] for row in superadmin_scoped.json()["files"]} == owner_files

    superadmin_unscoped = await superadmin_client.get("/logs/files/checkout")
    assert superadmin_unscoped.status_code == 200, superadmin_unscoped.text
    assert {row["filename"] for row in superadmin_unscoped.json()["files"]} == owner_files

    scoped_txt = daily_log_path(
        "checkout", shop_id=shop.id, log_scope_key=shop.log_scope_key, day=eligible_day
    )
    scoped_csv = daily_log_path(
        "checkout",
        shop_id=shop.id,
        log_scope_key=shop.log_scope_key,
        day=eligible_day,
        extension="csv",
    )
    assert scoped_txt.exists()
    assert scoped_csv.exists()
    assert not eligible_txt.exists()
    assert not eligible_csv.exists()
    assert stale_txt.exists()
    assert stale_csv.exists()

    eligible_download = await owner_client.get(
        f"/logs/files/checkout/{scoped_txt.name}/download"
    )
    assert eligible_download.status_code == 200, eligible_download.text
    assert "eligible legacy text" in eligible_download.text

    stale_download = await owner_client.get(
        f"/logs/files/checkout/{stale_txt.name}/download"
    )
    assert stale_download.status_code == 404, stale_download.text


@pytest.mark.usefixtures("owner")
async def test_shop_log_retention_cleans_scoped_and_migrated_legacy_files_only(
    log_files_dir: Path,
    db_session,
    owner_client: AsyncClient,
    shop,
) -> None:
    shop.created_at = datetime(2026, 7, 19, 9, 0, tzinfo=UTC)
    await db_session.commit()
    await db_session.refresh(shop)

    expired_day = date.today() - timedelta(days=10)
    expired_legacy = daily_log_path("checkout", shop_id=shop.id, day=expired_day)
    stale_ineligible = daily_log_path("checkout", shop_id=shop.id, day=expired_day, extension="csv")

    _write_log_fixture(
        expired_legacy,
        content="expired eligible legacy\n",
        modified_at=datetime.now(UTC),
    )
    _write_log_fixture(
        stale_ineligible,
        content="header\nstale-ineligible\n",
        modified_at=datetime(2026, 7, 14, 10, 0, tzinfo=UTC),
    )

    listed = await owner_client.get("/logs/files/checkout")
    assert listed.status_code == 200, listed.text
    assert expired_legacy.name not in {row["filename"] for row in listed.json()["files"]}
    assert not daily_log_path(
        "checkout",
        shop_id=shop.id,
        log_scope_key=shop.log_scope_key,
        day=expired_day,
    ).exists()
    assert stale_ineligible.exists()
