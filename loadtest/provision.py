"""One-time provisioning for the UAT load test.

Creates 5 isolated shops (loadtest-shop-1..5), each with:
  - 1 owner, 4 cashier_user, 2 receiver_user accounts
  - a device binding (one shared "virtual terminal" device_key per shop --
    login is device-bound but not session-exclusive, so all 6 staff can
    share it)
  - a vendor + a small product catalog
  - an initial stock receipt (so cashiers have something to sell)

Writes device_bindings directly via psql (fast, avoids a superadmin HTTP
flow entirely, per instruction: "we won't test superadmin"). Everything
else goes through the real HTTP API as the shop owner, same as a real
deployment would use.

Usage:
    DATABASE_PUBLIC_URL=postgresql://... \
    API_BASE=https://barstock-dev.nexiohyper.com \
    uv run python loadtest/provision.py
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import httpx

API_BASE = os.environ.get("API_BASE", "https://barstock-dev.nexiohyper.com")
DATABASE_PUBLIC_URL = os.environ["DATABASE_PUBLIC_URL"]
CREDS_PATH = Path(__file__).parent / ".credentials.json"

SHOP_COUNT = 5
CASHIERS_PER_SHOP = 4
RECEIVERS_PER_SHOP = 2

# Global phone-number range reserved for this load test -- must not
# collide with any existing user's phone in this database.
PHONE_BASE = 9700000000


def psql(sql: str) -> str:
    result = subprocess.run(
        ["docker", "exec", "-i", "barstock-db", "psql", DATABASE_PUBLIC_URL, "-t", "-A", "-c", sql],
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout.strip()


def async_db_url() -> str:
    # createshop uses the async engine (asyncpg driver).
    return DATABASE_PUBLIC_URL.replace("postgresql://", "postgresql+asyncpg://", 1)


# A git worktree checked out just for this load test has no .venv of its
# own; point the CLI invocation at a repo checkout that already has one
# (e.g. the main worktree) via BARSTOCK_CLI_CWD, defaulting to this file's
# own repo root for the common case of running in-place.
CLI_CWD = Path(os.environ.get("BARSTOCK_CLI_CWD", str(Path(__file__).parent.parent)))


def create_shop(code: str, name: str, owner_username: str, owner_phone: str, owner_password: str) -> None:
    env = {**os.environ, "DATABASE_URL": async_db_url()}
    result = subprocess.run(
        [
            "uv", "run", "barstock", "createshop",
            "--code", code,
            "--name", name,
            "--owner-username", owner_username,
            "--owner-phone", owner_phone,
            "--owner-password", owner_password,
        ],
        capture_output=True,
        text=True,
        env=env,
        cwd=CLI_CWD,
    )
    print(result.stdout)
    if result.returncode != 0:
        if "already exists" in result.stderr or "already exists" in result.stdout:
            print(f"  (shop {code} already provisioned, skipping)")
            return
        print(result.stderr, file=sys.stderr)
        raise SystemExit(f"createshop failed for {code}")


def bind_device(device_key: str, shop_code: str, counter_name: str) -> None:
    psql(
        f"""
        INSERT INTO device_bindings (device_key, shop_id, counter_name, is_active, created_at, updated_at)
        SELECT '{device_key}', id, '{counter_name}', true, now(), now() FROM shops WHERE code = '{shop_code}'
        ON CONFLICT (device_key) DO UPDATE SET shop_id = EXCLUDED.shop_id, is_active = true
        """
    )


def login_owner(username: str, password: str, device_key: str) -> str:
    resp = httpx.post(
        f"{API_BASE}/auth/login",
        json={"role": "owner", "username": username, "password": password, "device_key": device_key},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()["access_token"]


PRODUCTS = [
    {"barcode": "LT-11122", "brand": "Royal Challenge Whisky", "size_label": "750ml", "price": "420.00"},
    {"barcode": "LT-33344", "brand": "Signature Premier Grain Whisky", "size_label": "180ml", "price": "140.00"},
    {"barcode": "LT-55566", "brand": "Bacardi Limon Rum", "size_label": "750ml", "price": "680.00"},
    {"barcode": "LT-77788", "brand": "McDowell's No.1 Celebration Rum", "size_label": "375ml", "price": "180.00"},
    {"barcode": "LT-88888", "brand": "Kingfisher Premium Beer", "size_label": "650ml", "price": "150.00"},
    {"barcode": "LT-99999", "brand": "Old Monk Rum", "size_label": "750ml", "price": "350.00"},
]


def main() -> None:
    creds: dict = {"api_base": API_BASE, "shops": []}
    phone_counter = PHONE_BASE

    for i in range(1, SHOP_COUNT + 1):
        code = f"loadtest-shop-{i}"
        name = f"Loadtest Shop {i}"
        device_key = f"loadtest-shop-{i}-terminal"
        phone_counter += 1
        owner_username = f"lt{i}-owner"
        owner_phone = str(phone_counter)
        owner_password = f"LtOwner{i}!pass"

        print(f"=== {code} ===")
        create_shop(code, name, owner_username, owner_phone, owner_password)
        bind_device(device_key, code, "Counter 1")
        token = login_owner(owner_username, owner_password, device_key)
        headers = {"Authorization": f"Bearer {token}"}

        # Vendor (required for lot receiving) -- idempotent: reuse if a
        # vendor with this name already exists for the shop (resuming a
        # partially-completed run must not create a second one).
        existing_vendors = httpx.get(f"{API_BASE}/vendors", headers=headers, timeout=30)
        existing_vendors.raise_for_status()
        match = next(
            (v for v in existing_vendors.json() if v["name"] == f"Loadtest Vendor {i}"), None
        )
        if match is not None:
            vendor_id = match["id"]
            print(f"  vendor already exists (id={vendor_id}), reusing")
        else:
            vendor_resp = httpx.post(
                f"{API_BASE}/vendors",
                json={"name": f"Loadtest Vendor {i}"},
                headers=headers,
                timeout=30,
            )
            vendor_resp.raise_for_status()
            vendor_id = vendor_resp.json()["id"]

        # Catalog.
        for p in PRODUCTS:
            r = httpx.post(f"{API_BASE}/products", json=p, headers=headers, timeout=30)
            if r.status_code not in (201, 409):
                r.raise_for_status()

        # Staff.
        cashiers = []
        for c in range(1, CASHIERS_PER_SHOP + 1):
            phone_counter += 1
            username = f"lt{i}-cashier{c}"
            password = f"LtCash{i}{c}!pass"
            r = httpx.post(
                f"{API_BASE}/staff",
                json={
                    "role": "cashier_user",
                    "username": username,
                    "full_name": f"Loadtest Cashier {i}-{c}",
                    "phone": str(phone_counter),
                    "password": password,
                },
                headers=headers,
                timeout=30,
            )
            if r.status_code not in (201, 409):
                r.raise_for_status()
            cashiers.append({"username": username, "password": password})

        receivers = []
        for rix in range(1, RECEIVERS_PER_SHOP + 1):
            phone_counter += 1
            username = f"lt{i}-receiver{rix}"
            password = f"LtRecv{i}{rix}!pass"
            r = httpx.post(
                f"{API_BASE}/staff",
                json={
                    "role": "receiver_user",
                    "username": username,
                    "full_name": f"Loadtest Receiver {i}-{rix}",
                    "phone": str(phone_counter),
                    "password": password,
                },
                headers=headers,
                timeout=30,
            )
            if r.status_code not in (201, 409):
                r.raise_for_status()
            receivers.append({"username": username, "password": password})

        # Seed initial stock via the first receiver so it's a real
        # receiver-flow write, not the owner shortcutting it. Idempotent:
        # skip if this shop's catalog already shows stock (resuming a
        # partially-completed run must not double-seed).
        catalog_resp = httpx.get(f"{API_BASE}/products", params={"active_only": "true"}, headers=headers, timeout=30)
        catalog_resp.raise_for_status()
        already_stocked = any(p.get("current_stock", 0) > 0 for p in catalog_resp.json())
        if already_stocked:
            print("  initial stock already present, skipping lot receipt")
            creds["shops"].append(
                {
                    "code": code,
                    "device_key": device_key,
                    "owner": {"username": owner_username, "password": owner_password},
                    "cashiers": cashiers,
                    "receivers": receivers,
                    "vendor_id": vendor_id,
                    "products": PRODUCTS,
                }
            )
            print(f"  provisioned (resumed): {len(cashiers)} cashiers, {len(receivers)} receivers")
            continue
        r_resp = httpx.post(
            f"{API_BASE}/auth/login",
            json={
                "role": "receiver_user",
                "username": receivers[0]["username"],
                "password": receivers[0]["password"],
                "device_key": device_key,
            },
            timeout=30,
        )
        r_resp.raise_for_status()
        receiver_headers = {"Authorization": f"Bearer {r_resp.json()['access_token']}"}
        lot_resp = httpx.post(
            f"{API_BASE}/lots",
            json={
                "vendor_id": vendor_id,
                "purchase_date": "2026-07-01",
                "vendor_invoice_number": f"LT-INIT-{i}",
                "invoice_value": "50000.00",
                "reference": "loadtest initial stock",
                "lines": [{"barcode": p["barcode"], "quantity": 500} for p in PRODUCTS],
            },
            headers=receiver_headers,
            timeout=30,
        )
        lot_resp.raise_for_status()

        creds["shops"].append(
            {
                "code": code,
                "device_key": device_key,
                "owner": {"username": owner_username, "password": owner_password},
                "cashiers": cashiers,
                "receivers": receivers,
                "vendor_id": vendor_id,
                "products": PRODUCTS,
            }
        )
        print(f"  provisioned: {len(cashiers)} cashiers, {len(receivers)} receivers, "
              f"{len(PRODUCTS)} products, initial stock 500/unit")

    CREDS_PATH.write_text(json.dumps(creds, indent=2))
    print(f"\nWrote credentials to {CREDS_PATH}")


if __name__ == "__main__":
    main()
