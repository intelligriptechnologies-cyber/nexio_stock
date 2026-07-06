"""FastAPI app factory + lifespan."""
from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import _test_only, auth, checkout, health, lots, products, staff, users, voids
from app.config import get_settings
from app.db import get_engine
from app.logging_config import configure_logging, get_logger


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    configure_logging(settings.log_level)
    log = get_logger("app.startup")
    log.info(
        "startup",
        env=settings.app_env,
        app_name=settings.app_name,
        version=settings.app_version,
    )
    # Touch the engine so any DSN problem surfaces here, not on first request.
    engine = get_engine()
    log.info("db.engine_ready", url=str(engine.url).split("@")[-1])  # log host only
    yield
    log.info("shutdown")


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="Barstock API",
        version=settings.app_version,
        description=(
            "Barstock — single-counter liquor shop inventory & billing. "
            "OpenAPI spec: /openapi.json, Swagger UI: /docs."
        ),
        lifespan=lifespan,
    )
    if settings.cors_allow_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_allow_origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    app.include_router(health.router)
    app.include_router(auth.router)
    app.include_router(staff.router)
    app.include_router(users.router)
    app.include_router(products.router)
    app.include_router(lots.router)
    app.include_router(checkout.router)
    app.include_router(voids.router)

    # Test-only routes — used by tests to exercise role gates end-to-end.
    # Removed in #3 (when /lots lands) and #4 (when /checkout lands).
    if settings.app_env == "test":
        app.include_router(_test_only.router)

    return app


app = create_app()
