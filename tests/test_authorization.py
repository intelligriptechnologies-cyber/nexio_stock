"""Role-based authorization tests (D-25, R-21, R-2, R-3).

The acceptance criterion: a receiver_user calling a cashier-only endpoint
returns 403 (and vice versa), even when the request is sent directly
against the API. The owner account can perform both. Superadmin is
cross-shop and not subject to role split.

We exercise two placeholder test-only endpoints (`/__test__/receiver-only`
and `/__test__/cashier-only`, mounted only when APP_ENV=test). They'll be
replaced by real endpoints in #3 (`/lots`) and #4 (`/checkout`).
"""
from __future__ import annotations

import pytest
from httpx import AsyncClient


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_receiver_can_hit_receiver_only(receiver_client: AsyncClient) -> None:
    resp = await receiver_client.get("/__test__/receiver-only")
    assert resp.status_code == 200
    assert resp.json()["role"] == "receiver_user"


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_cashier_gets_403_on_receiver_only(cashier_client: AsyncClient) -> None:
    resp = await cashier_client.get("/__test__/receiver-only")
    assert resp.status_code == 403


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
async def test_owner_can_perform_both_roles(owner_client: AsyncClient) -> None:
    # Owner is a superset of receiver + cashier (D-26, R-3).
    r1 = await owner_client.get("/__test__/receiver-only")
    r2 = await owner_client.get("/__test__/cashier-only")
    assert r1.status_code == 200
    assert r2.status_code == 200


@pytest.mark.usefixtures("owner", "receiver", "cashier", "superadmin")
async def test_superadmin_gets_403_on_role_restricted_endpoints(
    superadmin_client: AsyncClient,
) -> None:
    # Superadmin is dev/ops, not day-to-day staff (D-13, D-25). They can't
    # impersonate a receiver/cashier via these role-locked endpoints.
    r1 = await superadmin_client.get("/__test__/receiver-only")
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
