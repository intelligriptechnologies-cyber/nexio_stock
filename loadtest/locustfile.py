"""Locust load test for the Barstock UAT backend.

Simulates the 5 loadtest shops provisioned by `provision.py`:
  - CashierUser: logs in as one of the shop's 4 cashier_user accounts,
    repeatedly checks out carts of 1/2/3 items (weighted, mirroring the
    manual walkthrough: single item, 2-item cart, 3-item cart with split
    payment).
  - ReceiverUser: logs in as one of the shop's 2 receiver_user accounts,
    periodically posts a receiving lot to keep stock from running out.

Load shape steps concurrent users up over time (see StepLoadShape) so we
get a latency-vs-concurrency curve rather than a single flat number, per
LOADTEST_PLAN.md.

Usage:
    locust -f loadtest/locustfile.py --host <api_base> --headless \
        --csv loadtest/results/run1 --html loadtest/results/run1.html \
        --run-time 20m
"""
from __future__ import annotations

import json
import random
import time
import uuid
from pathlib import Path

from locust import HttpUser, LoadTestShape, between, task

CREDS_PATH = Path(__file__).parent / ".credentials.json"
_CREDS = json.loads(CREDS_PATH.read_text())
SHOPS = _CREDS["shops"]

# Cart-size weights: 1-item, 2-item, 3-item (roughly matches the manual
# walkthrough already validated locally).
CART_SIZES = [1, 1, 1, 2, 2, 3]


def _login(client, role: str, username: str, password: str, device_key: str) -> str | None:
    resp = client.post(
        "/auth/login",
        json={
            "role": role,
            "username": username,
            "password": password,
            "device_key": device_key,
        },
        name="/auth/login",
    )
    if resp.status_code != 200:
        return None
    return resp.json()["access_token"]


class CashierUser(HttpUser):
    weight = 4
    wait_time = between(1, 3)

    def on_start(self) -> None:
        shop = random.choice(SHOPS)
        cashier = random.choice(shop["cashiers"])
        self.shop = shop
        token = _login(
            self.client, "cashier_user", cashier["username"], cashier["password"], shop["device_key"]
        )
        if token is None:
            self.stop(force=True)
            return
        self.client.headers.update({"Authorization": f"Bearer {token}"})

    @task
    def checkout(self) -> None:
        products = self.shop["products"]
        n = random.choice(CART_SIZES)
        chosen = random.sample(products, k=min(n, len(products)))
        lines = [{"barcode": p["barcode"], "quantity": random.randint(1, 2)} for p in chosen]
        total = sum(float(p["price"]) * line["quantity"] for p, line in zip(chosen, lines))
        total = round(total, 2)

        if n == 3:
            # Split payment across cash + UPI, mirroring the manual test.
            cash_part = round(total / 2, 2)
            upi_part = round(total - cash_part, 2)
            payments = [
                {"mode": "cash", "amount": f"{cash_part:.2f}"},
                {"mode": "upi", "amount": f"{upi_part:.2f}"},
            ]
        else:
            payments = [{"mode": "cash", "amount": f"{total:.2f}"}]

        self.client.post(
            "/checkout/finalize",
            json={"lines": lines, "payments": payments},
            headers={"Idempotency-Key": str(uuid.uuid4())},
            name="/checkout/finalize",
        )


class ReceiverUser(HttpUser):
    weight = 1
    wait_time = between(20, 40)

    def on_start(self) -> None:
        shop = random.choice(SHOPS)
        receiver = random.choice(shop["receivers"])
        self.shop = shop
        token = _login(
            self.client, "receiver_user", receiver["username"], receiver["password"], shop["device_key"]
        )
        if token is None:
            self.stop(force=True)
            return
        self.client.headers.update({"Authorization": f"Bearer {token}"})

    @task
    def receive_lot(self) -> None:
        products = self.shop["products"]
        self.client.post(
            "/lots",
            json={
                "vendor_id": self.shop["vendor_id"],
                "purchase_date": time.strftime("%Y-%m-%d"),
                "vendor_invoice_number": f"LT-{uuid.uuid4().hex[:10]}",
                "invoice_value": "20000.00",
                "reference": "loadtest replenishment",
                "lines": [{"barcode": p["barcode"], "quantity": 200} for p in products],
            },
            name="/lots",
        )


class StepLoadShape(LoadTestShape):
    """Ramps concurrent users up in steps to find the point latency bends.

    Each step lasts `step_time` seconds and sets the total concurrent
    user count; Locust distributes CashierUser/ReceiverUser instances
    per their `weight` class attrs (4:1, matching the 4-cashier/
    2-receiver-per-shop provisioning skewed toward checkout traffic).
    """

    step_time = 180
    steps = [5, 10, 20, 30, 45, 60]
    spawn_rate = 5

    def tick(self):
        run_time = self.get_run_time()
        step_index = int(run_time // self.step_time)
        if step_index >= len(self.steps):
            return None
        return (self.steps[step_index], self.spawn_rate, [CashierUser, ReceiverUser])
