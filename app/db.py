"""Async SQLAlchemy 2.0 engine + session factory.

Convention: the FastAPI dependency `get_db()` hands out an `AsyncSession`
bound to a per-request transaction. Callers don't manage commit/rollback
themselves; the dependency does it. This makes the concurrency-sensitive
stock-decrement path in #4 easy to reason about.
"""
from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.config import get_settings


class Base(DeclarativeBase):
    """All ORM models inherit from this."""


_engine: AsyncEngine | None = None
_sessionmaker: async_sessionmaker[AsyncSession] | None = None


def get_engine() -> AsyncEngine:
    global _engine
    if _engine is None:
        settings = get_settings()
        if settings.app_env == "test":
            # NullPool in tests so each session gets a fresh connection —
            # a connection with a failed/aborted transaction in the pool
            # surfaces as PendingRollbackError on the next request.
            from sqlalchemy.pool import NullPool

            _engine = create_async_engine(
                settings.database_url, echo=False, poolclass=NullPool
            )
        else:
            _engine = create_async_engine(
                settings.database_url,
                echo=False,
                pool_pre_ping=True,
                pool_size=10,
                max_overflow=20,
            )
    return _engine


def get_sessionmaker() -> async_sessionmaker[AsyncSession]:
    global _sessionmaker
    if _sessionmaker is None:
        _sessionmaker = async_sessionmaker(
            bind=get_engine(),
            expire_on_commit=False,
            autoflush=False,
        )
    return _sessionmaker


def reset_engine() -> None:
    """Used by tests to force a new engine against a test schema URL.

    The async engine may be bound to a closed event loop by the time this
    is called (pytest-asyncio runs each test on a fresh loop), so we drop
    the references without trying to dispose. The engine's underlying
    connections are cleaned up when the loop closes.
    """
    global _engine, _sessionmaker
    _engine = None
    _sessionmaker = None


async def get_db() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency. Yields a session; routes commit/rollback explicitly.

    We deliberately do NOT wrap the session in `async with session.begin():`
    here. That pattern doesn't recover cleanly when a route catches a
    SQLAlchemy error (e.g. IntegrityError on duplicate insert) and raises
    its own HTTPException — the begin() context sees the wrapped exception,
    tries to roll back an already-broken transaction, and leaves the
    session in an invalid state. With autobegin enabled, the session opens
    a transaction lazily on first execute, and routes that mutate should
    call `await db.commit()` themselves.

    On the way out, we always roll back any leftover transaction (no-op if
    the route already committed) and close the session. This is critical
    for tests that use NullPool — a leftover transaction leaves the
    connection in a state the next requester has to clean up.
    """
    sessionmaker = get_sessionmaker()
    async with sessionmaker() as session:
        try:
            yield session
        finally:
            # Best-effort cleanup. Swallow any error — the route is
            # already raising; we don't want to mask it. Most importantly,
            # if the session is already DEACTIVE (a previous IntegrityError
            # rolled it back), don't try to rollback again, that raises
            # PendingRollbackError and obscures the original 409/4xx.
            try:
                if session.is_active:
                    await session.rollback()
            except Exception:
                pass


@asynccontextmanager
async def unit_of_work(db: AsyncSession) -> AsyncIterator[None]:
    """Commit on success, roll back before the exception propagates.

    Routes that mutate via a service call and want a domain error
    translated to HTTP wrap just that call:

        try:
            async with unit_of_work(db):
                result = await some_service_call(db, ...)
        except SomeDomainError as exc:
            raise map_error_to_http(
                exc, code_to_status=..., log_event="..."
            ) from exc

    The rollback happens here, inside the context manager, before the
    domain exception re-propagates to the caller's except block --
    matching `get_db`'s note above that a route must roll back before
    translating a SQLAlchemy-surfaced error, or the session is left in
    an unusable state. Translation itself stays with the caller; this
    only owns the commit/rollback boundary.
    """
    try:
        yield
    except Exception:
        await db.rollback()
        raise
    else:
        await db.commit()


async def init_db() -> None:
    """Create all tables. Used by tests only — production uses Alembic."""
    # Import models so they register with Base.metadata.
    from app import models  # noqa: F401

    engine = get_engine()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


# Convenience for ad-hoc scripts.
__all__ = [
    "Base",
    "get_db",
    "get_engine",
    "get_sessionmaker",
    "init_db",
    "reset_engine",
    "unit_of_work",
]


# Quiet an unused-typing warning while keeping the import for IDE hints.
_: Any = None
