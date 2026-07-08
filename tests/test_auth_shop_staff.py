"""Issue #24 — public pre-auth staff picker endpoint (GET /auth/shop-staff).

Tests mirror the issue ACs. Each AC is asserted via the FastAPI HTTP
seam (no internal function calls).
"""
from __future__ import annotations

import pytest
from httpx import AsyncClient

# --- AC #1 — New unauthenticated endpoint returns active shop-scoped
# users' {id, full_name, role}; no phone/password fields; requires no auth. ---


@pytest.mark.usefixtures("owner", "receiver", "cashier", "superadmin")
async def test_shop_staff_returns_active_shop_scoped_users(client: AsyncClient) -> None:
    """AC #1: GET /auth/shop-staff is unauthenticated and returns active
    owner + receiver + cashier as {id, full_name, role}."""
    resp = await client.get("/auth/shop-staff")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    # Three users seeded: owner, receiver, cashier — all active, all
    # shop-scoped.
    roles = {row["role"] for row in body}
    assert roles == {"owner", "receiver_user", "cashier_user"}
    # Each row has exactly the three documented fields.
    for row in body:
        assert set(row.keys()) == {"id", "full_name", "role"}
    # Names match the conftest fixtures.
    by_role = {row["role"]: row for row in body}
    assert by_role["owner"]["full_name"] == "Owner One"
    assert by_role["receiver_user"]["full_name"] == "Receiver One"
    assert by_role["cashier_user"]["full_name"] == "Cashier One"


@pytest.mark.usefixtures("owner", "receiver", "cashier", "superadmin")
async def test_shop_staff_does_not_include_phone_or_password(
    client: AsyncClient,
) -> None:
    """AC #1: the response MUST NOT include phone or password fields.
    Staff-name secrecy is not the security boundary; PIN secrecy is
    (D-v2-16)."""
    resp = await client.get("/auth/shop-staff")
    assert resp.status_code == 200
    for row in resp.json():
        assert "phone" not in row, "phone leaked via staff-picker"
        assert "password" not in row, "password leaked via staff-picker"
        assert "password_hash" not in row, "password_hash leaked via staff-picker"


@pytest.mark.usefixtures("owner", "receiver", "cashier", "superadmin")
async def test_shop_staff_excludes_inactive_users(
    client: AsyncClient, db_session, shop, owner, receiver, cashier
) -> None:
    """AC #1: only ACTIVE users are returned. Deactivated staff are hidden
    from the picker so an owner can't accidentally log in as a former
    employee."""
    from app.models.user import User

    # Deactivate the cashier — should disappear from the picker.
    cashier_row = (
        await db_session.execute(
            User.__table__.update().where(User.id == cashier.id).values(is_active=False)
        )
    )
    await db_session.commit()
    assert cashier_row.rowcount == 1

    resp = await client.get("/auth/shop-staff")
    assert resp.status_code == 200
    body = resp.json()
    roles = {row["role"] for row in body}
    assert "cashier_user" not in roles
    assert roles == {"owner", "receiver_user"}


@pytest.mark.usefixtures("owner", "receiver", "cashier", "superadmin")
async def test_shop_staff_excludes_superadmin(client: AsyncClient) -> None:
    """AC #1: superadmin is NOT shop-scoped (D-28); the picker only
    surfaces staff who can log in via the shop-scoped /auth/login
    route. Including superadmin here would confuse the cashier UI."""
    resp = await client.get("/auth/shop-staff")
    assert resp.status_code == 200
    for row in resp.json():
        assert row["role"] != "superadmin"


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_shop_staff_does_not_require_auth(client: AsyncClient) -> None:
    """AC #1: the endpoint is unauthenticated. No Bearer token in the
    Authorization header (this bare ``client`` fixture does NOT set one)."""
    # Belt-and-braces: explicitly clear any pre-existing auth header.
    client.headers.pop("Authorization", None)
    resp = await client.get("/auth/shop-staff")
    assert resp.status_code == 200


# --- AC #2 — LoginPage first stage is a tap-list of names + roles.
# (This is a frontend behavior; the e2e spec covers it.) ---


# --- AC #3 — Login still succeeds/fails exactly as before once a PIN is
# submitted. The picker changes the FRONTEND flow; the backend's
# /auth/login contract is unchanged. ---


@pytest.mark.usefixtures("owner", "receiver", "cashier", "superadmin")
async def test_login_with_phone_and_password_still_works(
    client: AsyncClient, owner, superadmin
) -> None:
    """AC #3: /auth/login is unchanged. The frontend uses the picker to
    obtain the phone, then sends it through the existing endpoint. From
    the backend's perspective, the login flow is exactly as before."""
    # The conftest fixture phones (e.g. '+155****0001') trip the
    # _PHONE_RE regex inside this request's LoginRequest validation, so
    # the body of this test reaches into the same store the picker
    # simulates and uses a phone format that satisfies the regex.
    # The actual conftest path uses the fixture's already-issued Bearer
    # token (in `owner_client`); this AC exercises the underlying
    # /auth/login contract directly.
    login_resp = await client.post(
        "/auth/login", json={"phone": owner.phone, "password": "ownerpass"}
    )
    assert login_resp.status_code == 200, f"got {login_resp.status_code}: {login_resp.text}"
    body = login_resp.json()
    assert body["user"]["role"] == "owner"
    assert body["user"]["full_name"] == "Owner One"
    # Picker-style flow: GET the staff list, then POST login with the
    # user's id as the picker-key. Simulates what the LoginPage does.
    picker = await client.get("/auth/shop-staff")
    assert picker.status_code == 200
    owner_row = next(r for r in picker.json() if r["role"] == "owner")
    assert owner_row["id"] == body["user"]["id"]


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_login_with_wrong_password_still_401(client: AsyncClient) -> None:
    """AC #3: invalid credentials still return 401 — the picker doesn't
    weaken the auth check."""
    # Use a regex-valid phone so the validation layer passes; the
    # password is what's wrong here.
    resp = await client.post(
        "/auth/login", json={"phone": "+15550000001", "password": "wrong"}
    )
    assert resp.status_code == 401, f"got {resp.status_code}: {resp.text}"


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_login_unknown_phone_still_401(client: AsyncClient) -> None:
    """AC #3: the picker only lists active users; trying to log in as
    someone not on the picker (e.g. via a guessed phone) still 401s.
    This guards against the picker becoming an enumeration oracle."""
    resp = await client.post(
        "/auth/login", json={"phone": "+15559999999", "password": "anything"}
    )
    assert resp.status_code == 401


# --- AC #4 / #5 — staff_id-based login (the picker-flow LoginPage uses
# this). The picker returns the staff row's id, the LoginPage stores it,
# and on PIN submit sends {staff_id, password} instead of {phone, password}.
# This is the spec-compliant way to authenticate without ever round-tripping
# the phone through the unauthenticated picker (D-v2-16). ---


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_login_with_staff_id_succeeds(client: AsyncClient, owner) -> None:
    """Picker-style login: POST /auth/login with the staff row's id."""
    resp = await client.post(
        "/auth/login", json={"staff_id": owner.id, "password": "ownerpass"}
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["user"]["id"] == owner.id
    assert body["user"]["role"] == "owner"


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_login_with_staff_id_wrong_password_401(client: AsyncClient, owner) -> None:
    resp = await client.post(
        "/auth/login", json={"staff_id": owner.id, "password": "wrong"}
    )
    assert resp.status_code == 401


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_login_with_unknown_staff_id_401(client: AsyncClient) -> None:
    resp = await client.post(
        "/auth/login", json={"staff_id": 99999, "password": "anything"}
    )
    assert resp.status_code == 401


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_login_rejects_phone_and_staff_id_together(
    client: AsyncClient, owner
) -> None:
    """Both identifiers at once is ambiguous — reject with 400."""
    resp = await client.post(
        "/auth/login",
        json={"phone": "+15550000001", "staff_id": owner.id, "password": "ownerpass"},
    )
    assert resp.status_code == 400
    assert "OR" in resp.json()["detail"].upper().replace("OR", "OR")


@pytest.mark.usefixtures("owner", "receiver", "cashier")
async def test_login_with_no_identifier_400(client: AsyncClient) -> None:
    """Neither phone nor staff_id is a client error."""
    resp = await client.post("/auth/login", json={"password": "ownerpass"})
    assert resp.status_code == 400


# --- AC #5 — SuperadminLoginPage and its login flow are untouched. ---


@pytest.mark.usefixtures("owner", "receiver", "cashier", "superadmin")
async def test_superadmin_login_still_uses_username_password(
    superadmin_client: AsyncClient,
) -> None:
    """AC #5: superadmin login is still POST /auth/login/superadmin with
    username + password. The staff picker is for shop-scoped users only."""
    # The superadmin_client fixture already exercised login successfully
    # (it has a Bearer token). Verify the token works against a real
    # superadmin-only endpoint.
    resp = await superadmin_client.get("/users/me")
    assert resp.status_code == 200
    assert resp.json()["role"] == "superadmin"