"""Shared pytest fixtures.

We need a real Postgres for tests because the concurrency-sensitive paths
in later slices (`SELECT ... FOR UPDATE`) don't work on SQLite. Each test
session creates a temporary database, runs migrations against it, and drops
it at the end. Per-test isolation is via table truncation in a fixture.
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid
from collections.abc import AsyncIterator
from pathlib import Path

import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

# Configure env BEFORE importing the app so settings pick up the test DSN.
TEST_DB_BASE = os.environ.get(
    "TEST_DATABASE_URL_BASE",
    "postgresql+asyncpg://barstock:barstock@127.0.0.1:5432",
)
# Ensure the test-only routes are mounted (see app.api._test_only).
os.environ.setdefault("APP_ENV", "test")

# pytest-asyncio's conftest loading runs on the host loop where cwd may not
# be on sys.path. Pin the project root so `from app.* import ...` works at
# import time.
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

# Defer the app imports to first use so the path tweak above is in effect.
from app.models.shop import Shop  # noqa: E402
from app.models.user import User, UserRole  # noqa: E402
from app.security.passwords import hash_password  # noqa: E402


def _make_test_dsn() -> str:
    db_name = f"barstock_test_{uuid.uuid4().hex[:8]}"
    return f"{TEST_DB_BASE}/{db_name}"


@pytest_asyncio.fixture(scope="session")
async def test_db_dsn() -> AsyncIterator[str]:
    """Create a throwaway database for the test session, run migrations, drop after."""
    # Imports inside the fixture to ensure they happen after env setup.
    from app.config import get_settings
    from app.db import reset_engine

    dsn = _make_test_dsn()
    admin_dsn = TEST_DB_BASE + "/postgres"

    # Override settings BEFORE the app/engine is touched.
    get_settings.cache_clear()  # type: ignore[attr-defined]
    os.environ["DATABASE_URL"] = dsn
    # Re-cache settings so the engine picks up the new DSN.
    get_settings.cache_clear()  # type: ignore[attr-defined]
    reset_engine()

    # Create the test DB using a separate connection to the admin DB.
    import asyncpg

    admin = await asyncpg.connect(admin_dsn.replace("postgresql+asyncpg", "postgresql"))
    try:
        await admin.execute(f'CREATE DATABASE "{dsn.split("/")[-1]}"')
    finally:
        await admin.close()

    # Run migrations in a subprocess so we don't fight pytest-asyncio's
    # already-running event loop (alembic's async env.py uses asyncio.run).
    import subprocess
    import sys as _sys

    def _run_alembic() -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [_sys.executable, "-m", "alembic", "upgrade", "head"],
            cwd=str(_PROJECT_ROOT),
            env={**os.environ, "DATABASE_URL": dsn},
            capture_output=True,
            text=True,
        )

    result = await asyncio.to_thread(_run_alembic)
    if result.returncode != 0:
        raise RuntimeError(
            f"alembic upgrade failed (exit {result.returncode})\n"
            f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
        )

    yield dsn

    # Drop the test DB.
    admin = await asyncpg.connect(admin_dsn.replace("postgresql+asyncpg", "postgresql"))
    try:
        # Disconnect any stragglers, then drop.
        await admin.execute(
            f"""
            SELECT pg_terminate_backend(pid)
            FROM pg_stat_activity
            WHERE datname = '{dsn.split("/")[-1]}' AND pid <> pg_backend_pid()
            """
        )
        await admin.execute(f'DROP DATABASE IF EXISTS "{dsn.split("/")[-1]}"')
    finally:
        await admin.close()

    reset_engine()


@pytest_asyncio.fixture(autouse=True)
async def _truncate_tables(test_db_dsn: str) -> AsyncIterator[None]:
    """Wipe data between tests (preserves schema). Order matters for FKs."""
    from app.db import get_sessionmaker

    Session = get_sessionmaker()
    async with Session() as session, session.begin():
        # Products first (FK to shops), then log tables (FK to users),
        # then users, then shops.
        await session.execute(
            text(
                "TRUNCATE TABLE eod_signoffs, idempotency_keys, payments, invoice_lines, invoices, lot_lines, lots, products, invoicing_logs, stockin_logs, "
                "users, shops RESTART IDENTITY CASCADE"
            )
        )
    yield


@pytest_asyncio.fixture
async def db_session(test_db_dsn: str) -> AsyncIterator[AsyncSession]:
    """Bare session — the fixture consumer owns commit/rollback.

    The full transaction pattern (`async with session.begin(): yield`) is a
    footgun here: pytest-asyncio resolves teardowns in reverse order, so
    the engine-reset in `client`'s teardown can run *before* the
    transaction commits, losing the fixture's writes silently. So we give
    the consumer a plain session and let them commit explicitly.
    """
    from app.db import get_sessionmaker

    Session = get_sessionmaker()
    async with Session() as session:
        yield session


@pytest_asyncio.fixture
async def client(test_db_dsn: str) -> AsyncIterator[AsyncClient]:
    from app.main import app

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac

    # Drop the engine so connections don't bleed across pytest-asyncio's
    # per-test event loops. Subsequent fixtures (e.g. db_session) recreate
    # the engine lazily on next use.
    from app.db import reset_engine

    reset_engine()
    # Re-prime the cached settings so the next fixture sees the test DSN.
    os.environ["DATABASE_URL"] = test_db_dsn
    from app.config import get_settings

    get_settings.cache_clear()  # type: ignore[attr-defined]


# ---------------------------------------------------------------------------
# Domain fixtures: a shop, an owner, a receiver, a cashier, a superadmin,
# and pre-logged-in clients for each role. Each `*_client` fixture sets
# the Authorization header on the client so tests don't have to.
# ---------------------------------------------------------------------------


async def _make_shop(
    session: AsyncSession, code: str = "shop1", name: str = "Shop One"
) -> Shop:
    shop = Shop(code=code, name=name)
    session.add(shop)
    await session.flush()
    await session.commit()
    return shop


async def _make_user(
    session: AsyncSession,
    *,
    shop_id: int | None,
    role: UserRole,
    username: str,
    phone: str,
    password: str = "testpass",
    full_name: str | None = None,
) -> User:
    user = User(
        shop_id=shop_id,
        role=role,
        username=username,
        full_name=full_name or username.title(),
        phone=phone,
        password_hash=hash_password(password),
        is_active=True,
    )
    session.add(user)
    await session.flush()
    await session.commit()
    return user


@pytest_asyncio.fixture
async def shop(db_session: AsyncSession) -> Shop:
    return await _make_shop(db_session)


@pytest_asyncio.fixture
async def owner(db_session: AsyncSession, shop: Shop) -> User:
    return await _make_user(
        db_session,
        shop_id=shop.id,
        role=UserRole.OWNER,
        username="owner1",
        phone="+15555550001",
        password="ownerpass",
        full_name="Owner One",
    )


@pytest_asyncio.fixture
async def receiver(db_session: AsyncSession, shop: Shop) -> User:
    return await _make_user(
        db_session,
        shop_id=shop.id,
        role=UserRole.RECEIVER_USER,
        username="receiver1",
        phone="+15555550002",
        password="recvpass",
        full_name="Receiver One",
    )


@pytest_asyncio.fixture
async def cashier(db_session: AsyncSession, shop: Shop) -> User:
    return await _make_user(
        db_session,
        shop_id=shop.id,
        role=UserRole.CASHIER_USER,
        username="cashier1",
        phone="+15555550003",
        password="cashpass",
        full_name="Cashier One",
    )


@pytest_asyncio.fixture
async def superadmin(db_session: AsyncSession) -> User:
    return await _make_user(
        db_session,
        shop_id=None,
        role=UserRole.SUPERADMIN,
        username="root",
        phone="0000000000",
        password="rootpass1",
        full_name="Root",
    )


async def _make_logged_in_client(
    app, *, path: str, payload: dict
) -> AsyncClient:
    """Create a fresh AsyncClient pre-populated with a Bearer token.

    Each *role* fixture returns its own AsyncClient so tests can request
    multiple role clients in the same test without them stomping on each
    other's Authorization header.
    """
    transport = ASGITransport(app=app)
    ac = AsyncClient(transport=transport, base_url="http://test")
    resp = await ac.post(path, json=payload)
    assert resp.status_code == 200, f"login failed: {resp.status_code} {resp.text}"
    ac.headers["Authorization"] = f"Bearer {resp.json()['access_token']}"
    return ac


@pytest_asyncio.fixture
async def owner_client(owner: User) -> AsyncClient:
    from app.main import app

    return await _make_logged_in_client(
        app,
        path="/auth/login",
        payload={"phone": owner.phone, "password": "ownerpass"},
    )


@pytest_asyncio.fixture
async def receiver_client(receiver: User) -> AsyncClient:
    from app.main import app

    return await _make_logged_in_client(
        app,
        path="/auth/login",
        payload={"phone": receiver.phone, "password": "recvpass"},
    )


@pytest_asyncio.fixture
async def cashier_client(cashier: User) -> AsyncClient:
    from app.main import app

    return await _make_logged_in_client(
        app,
        path="/auth/login",
        payload={"phone": cashier.phone, "password": "cashpass"},
    )


@pytest_asyncio.fixture
async def superadmin_client(superadmin: User) -> AsyncClient:
    from app.main import app

    return await _make_logged_in_client(
        app,
        path="/auth/login/superadmin",
        payload={"username": superadmin.username, "password": "rootpass1"},
    )
