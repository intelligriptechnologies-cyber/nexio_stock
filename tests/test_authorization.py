"""Role-based authorization tests (D-25, R-21, R-2, R-3).

The acceptance criterion: a receiver_user calling a cashier-only endpoint
returns 403 (and vice versa), even when the request is sent directly
against the API. The owner account can perform both. Superadmin is
cross-shop and not subject to role split.

The receiver-only gate is exercised by the real POST /lots in
tests/test_lots.py. The cashier-only gate is still on a placeholder
(/__test__/cashier-only) until #4's /checkout lands.
"""
from __future__ import annotations

import pytest
from httpx import AsyncClient

# Receiver-only gate is exercised end-to-end by the real POST /lots
# in tests/test_lots.py (replaces the /__test__/receiver-only placeholder
# that was here for #1).


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_cashier_can_hit_cashier_only(cashier_client: AsyncClient) -> None:
    resp = await cashier_client.get("/__test__/cashier-only")
    assert resp.status_code == 200
    assert resp.json()["role"] == "cashier_user"


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_receiver_gets_403_on_cashier_only(receiver_client: AsyncClient) -> None:
    resp = await receiver_client.get("/__test__/cashier-only")
    assert resp.status_code == 403


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_owner_can_perform_both_roles(
    owner_client: AsyncClient, owner: object
) -> None:
    # Owner is a superset of receiver + cashier (D-26, R-3).
    # Receiver-only gate: POST /lots (real endpoint, #3) — owner can
    # create lots too.
    products = (
        await owner_client.get("/products")
    ).json()
    # Seed one product so the lot is valid.
    if not products:
        await owner_client.post(
            "/products",
            json={"barcode": "x", "brand": "X", "size_label": "1L", "price": "1.00"},
        )
    r1 = await owner_client.post(
        "/lots",
        json={"lines": [{"barcode": "x", "quantity": 1}]},
    )
    # Cashier-only gate: still on the placeholder until #4's /checkout.
    r2 = await owner_client.get("/__test__/cashier-only")
    assert r1.status_code == 201
    assert r2.status_code == 200


@pytest.mark.usefixtures("owner", "receiver", "cashier", "superadmin")
async def test_superadmin_gets_403_on_role_restricted_endpoints(
    superadmin_client: AsyncClient,
) -> None:
    # Superadmin is dev/ops, not day-to-day staff (D-13, D-25). They can't
    # impersonate a receiver/cashier via these role-locked endpoints.
    # Receiver-only gate: POST /lots rejects superadmin with 403.
    r1 = await superadmin_client.post(
        "/lots", json={"lines": [{"barcode": "x", "quantity": 1}]}
    )
    # Cashier-only gate: placeholder.
    r2 = await superadmin_client.get("/__test__/cashier-only")
    assert r1.status_code == 403
    assert r2.status_code == 403


# /staff is owner-only — verify the cross-role rejection there too.
@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_receiver_gets_403_on_owner_only_staff_endpoint(
    receiver_client: AsyncClient,
) -> None:
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
