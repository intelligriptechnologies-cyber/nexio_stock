"""Health/readiness probe — used by hosting platform + tests."""
from __future__ import annotations

from fastapi import APIRouter
from sqlalchemy import text

from app.api.deps import DbSession

router = APIRouter(tags=["health"])


@router.get("/healthz", summary="Liveness")
async def liveness() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/readyz", summary="Readiness (verifies DB connectivity)")
async def readiness(db: DbSession) -> dict[str, str]:
    await db.execute(text("SELECT 1"))
    return {"status": "ready"}
