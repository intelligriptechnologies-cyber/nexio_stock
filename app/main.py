"""FastAPI app factory + lifespan."""
from __future__ import annotations

import asyncio
import contextlib
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select

from app.api import (
    _test_only,
    auth,
    checkout,
    dashboard,
    health,
    inventory,  # issue #43
    lots,
    products,
    shops,
    staff,
    users,
    voids,
)
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

    # Background low-stock evaluator (D-34, R-15, #7). The task wakes
    # every LOW_STOCK_INTERVAL_MIN minutes, walks the shop list, and
    # logs how many products are at or below threshold. Skipped in
    # tests to keep the test suite deterministic.
    bg_task: asyncio.Task[None] | None = None
    if settings.app_env != "test":
        bg_task = asyncio.create_task(_low_stock_loop())

    try:
        yield
    finally:
        if bg_task is not None:
            bg_task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await bg_task
        log.info("shutdown")


async def _low_stock_loop() -> None:
    """Periodic low-stock evaluator. Logs a single info line per
    iteration with the count of products at or below threshold."""
    from app.config import get_settings
    from app.db import get_sessionmaker
    from app.models.shop import Shop
    from app.services.low_stock import compute_low_stock

    settings = get_settings()
    interval_s = max(60, settings.low_stock_interval_min * 60)
    log = get_logger("app.low_stock")
    log.info("low_stock.loop_started", interval_s=interval_s)

    while True:
        try:
            await asyncio.sleep(interval_s)
            session_factory = get_sessionmaker()
            async with session_factory() as session, session.begin():
                shops = (
                    await session.execute(select(Shop.id))
                ).scalars().all()
                total = 0
                for shop_id in shops:
                    rows = await compute_low_stock(session, shop_id=shop_id)
                    if rows:
                        log.info(
                            "low_stock.evaluated",
                            shop_id=shop_id,
                            count=len(rows),
                            most_urgent={
                                "barcode": rows[0].product.barcode,
                                "current_stock": rows[0].current_stock,
                                "effective_threshold": rows[0].effective_threshold,
                            },
                        )
                    total += len(rows)
                if total == 0:
                    log.info("low_stock.evaluated", total=0)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            log.error("low_stock.loop_error", error=str(exc))
            # Don't tight-loop on errors; the sleep at the top gives
            # a natural backoff.


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
    app.include_router(inventory.router)  # issue #43
    app.include_router(checkout.router)
    app.include_router(voids.router)
    app.include_router(dashboard.router)
    app.include_router(shops.router)

    # Test-only routes — used by tests to exercise role gates end-to-end.
    # Removed in #3 (when /lots lands) and #4 (when /checkout lands).
    if settings.app_env == "test":
        app.include_router(_test_only.router)

    return app


app = create_app()
