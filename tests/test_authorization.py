"""Role-based authorization tests (D-25, R-21, R-2, R-3).

The acceptance criterion: a receiver_user calling a cashier-only endpoint
returns 403 (and vice versa), even when the request is sent directly
against the API. The owner account can perform both. Superadmin is
cross-shop and not subject to role split.

Both role gates are now exercised by real endpoints in #3 and #4:
  - receiver-only: POST /lots (see tests/test_lots.py)
  - cashier-only:  POST /checkout/finalize (see tests/test_checkout.py)
This file keeps the owner-as-superset and cross-role 403 checks for
the owner-only /staff endpoint.
"""
from __future__ import annotations

import pytest
from httpx import AsyncClient

# Receiver-only gate is exercised end-to-end by the real POST /lots
# in tests/test_lots.py (replaces the /__test__/receiver-only placeholder
# that was here for #1).


# Cross-role receiver-vs-cashier tests live next to the real endpoints:
#   - POST /lots  in tests/test_lots.py
#   - POST /checkout/finalize in tests/test_checkout.py


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_receiver_gets_403_on_owner_only_staff_endpoint(
    receiver_client: AsyncClient,
) -> None:
    # /staff is owner-only — receiver must be rejected.
    resp = await receiver_client.get("/staff")
    assert resp.status_code == 403


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_cashier_gets_403_on_owner_only_staff_endpoint(
    cashier_client: AsyncClient,
) -> None:
    resp = await cashier_client.get("/staff")
    assert resp.status_code == 403


@pytest.mark.usefixtures("owner", "receiver", "cashier", "superadmin")
async def test_superadmin_can_list_all_staff(superadmin_client: AsyncClient) -> None:
    # R-5: superadmin sees all shop data for support/debugging.
    resp = await superadmin_client.get("/staff")
    assert resp.status_code == 200
    body = resp.json()
    # superadmin + owner + receiver + cashier = 4
    assert len(body) == 4
