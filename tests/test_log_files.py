"""Daily text log file APIs and live writes."""
from __future__ import annotations

import uuid
from datetime import date, timedelta
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


async def _create_lot(receiver_client: AsyncClient, barcode: str) -> None:
    resp = await receiver_client.post(
        "/lots",
        json={"reference": "DEL-1", "lines": [{"barcode": barcode, "quantity": 5}]},
    )
    assert resp.status_code == 201, resp.text


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


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_live_events_append_daily_english_files(
    log_files_dir: Path,
    owner_client: AsyncClient,
    receiver_client: AsyncClient,
    cashier_client: AsyncClient,
    shop,
) -> None:
    await _create_product(owner_client, "8909100000001", brand="Royal Stag")
    await _create_lot(receiver_client, "8909100000001")
    await _finalize(cashier_client, "8909100000001")
    signoff = await owner_client.post(
        "/dashboard/eod/sign-off", json={"business_date": date.today().isoformat()}
    )
    assert signoff.status_code == 201, signoff.text

    checkout = daily_log_path("checkout", shop_id=shop.id).read_text(encoding="utf-8")
    receiving = daily_log_path("receiving", shop_id=shop.id).read_text(encoding="utf-8")
    closing = daily_log_path("closing", shop_id=shop.id).read_text(encoding="utf-8")

    assert "Invoice event #1" in checkout
    assert "total Rs. 100.00" in checkout
    assert "payments: cash Rs. 100.00" in checkout
    assert "Receiver Receiver One" in receiving
    assert "Royal Stag 750ml" in receiving
    assert "EOD sign-off completed" in closing
    assert "invoice count 1" in closing


@pytest.mark.usefixtures("owner")
async def test_log_file_retention_defaults_updates_and_cleans_expired_files(
    log_files_dir: Path,
    owner_client: AsyncClient,
    shop,
) -> None:
    old_day = date.today() - timedelta(days=10)
    old_path = daily_log_path("checkout", shop_id=shop.id, day=old_day)
    old_path.parent.mkdir(parents=True, exist_ok=True)
    old_path.write_text("old\n", encoding="utf-8")
    fresh_path = daily_log_path("checkout", shop_id=shop.id)
    fresh_path.parent.mkdir(parents=True, exist_ok=True)
    fresh_path.write_text("fresh\n", encoding="utf-8")

    listed = await owner_client.get("/logs/files/checkout")
    assert listed.status_code == 200, listed.text
    body = listed.json()
    assert body["retention_days"] == 10
    assert [row["filename"] for row in body["files"]] == [fresh_path.name]
    assert not old_path.exists()

    patched = await owner_client.patch(
        "/logs/files/checkout/retention", json={"retention_days": 3}
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["retention_days"] == 3

    listed_again = await owner_client.get("/logs/files/checkout")
    assert listed_again.json()["retention_days"] == 3


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
