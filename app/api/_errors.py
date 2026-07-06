"""Shared error helpers for the API routers.

Two patterns repeat in the routers:

1. `is_unique_violation(exc)` — asyncpg surfaces a UNIQUE-violation as
   `sqlalchemy.dialects.postgresql.asyncpg.AsyncAdapt_asyncpg_dbapi.IntegrityError`
   (not the `sqlalchemy.exc.IntegrityError` the docs suggest, in this
   SQLAlchemy/asyncpg combo). Some code paths wrap it into
   `sqlalchemy.exc.IntegrityError`; others don't. Walk the __cause__
   chain to make the predicate robust to both shapes.

2. `map_error_to_http(exc, code_to_status, fallback_status=500)` —
   a tiny helper that maps our domain-error objects to
   `fastapi.HTTPException` with consistent body shape. Each router
   has its own `*Error` class; the mapping is per-router, so this
   helper takes the mapping as a parameter rather than baking in
   any specific error class.
"""
from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy.dialects.postgresql.asyncpg import AsyncAdapt_asyncpg_dbapi
from sqlalchemy.exc import IntegrityError


def is_unique_violation(exc: BaseException) -> bool:
    """True if `exc` (or any exception in its __cause__ chain) is a
    Postgres UNIQUE constraint violation.

    SQLAlchemy 2.0 async + asyncpg can surface this as any of:
      - sqlalchemy.exc.IntegrityError
      - sqlalchemy.dialects.postgresql.asyncpg.AsyncAdapt_asyncpg_dbapi.IntegrityError
      - asyncpg.exceptions.UniqueViolationError (via __cause__)
    """
    seen: set[int] = set()
    cur: BaseException | None = exc
    while cur is not None and id(cur) not in seen:
        seen.add(id(cur))
        if type(cur).__name__ == "UniqueViolationError":
            return True
        if isinstance(cur, (IntegrityError, AsyncAdapt_asyncpg_dbapi.IntegrityError)):
            return True
        cur = cur.__cause__
    return False


def map_error_to_http(
    exc: BaseException,
    *,
    code_to_status: dict[str, int],
    fallback_status: int = 500,
) -> HTTPException:
    """Build an HTTPException from a domain error.

    The body shape is `{"code": <code>, "message": <message>}` so the
    frontend can switch on `code` without parsing prose.

    `code_to_status` is `{error_code: http_status}` — a per-router
    mapping. Codes not in the map fall back to `fallback_status`
    (default 500).
    """
    code = getattr(exc, "code", None) or type(exc).__name__
    status_code = code_to_status.get(str(code), fallback_status)
    message = getattr(exc, "message", str(exc))
    return HTTPException(
        status_code=status_code,
        detail={"code": str(code), "message": message},
    )


__all__ = ["is_unique_violation", "map_error_to_http"]
