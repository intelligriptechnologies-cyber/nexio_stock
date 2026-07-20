from __future__ import annotations

import os

import pytest
from httpx import ASGITransport, AsyncClient

from app.config import get_settings
from app.main import create_app


def _configure_test_env() -> None:
    os.environ["APP_ENV"] = "test"
    os.environ["DATABASE_URL"] = "postgresql+asyncpg://test:test@127.0.0.1:5432/test_db"
    os.environ["SECRET_KEY"] = "x" * 32


@pytest.fixture(autouse=True)
async def _truncate_tables() -> None:
    return None


@pytest.mark.asyncio
async def test_preflight_allows_only_explicitly_configured_origins() -> None:
    get_settings.cache_clear()  # type: ignore[attr-defined]
    _configure_test_env()
    os.environ["CORS_ALLOW_ORIGINS"] = (
        '["https://frontend-prod-5a1e.up.railway.app","https://stock.nexiohyper.com"]'
    )

    app = create_app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        allowed = await client.options(
            "/auth/login/superadmin",
            headers={
                "Origin": "https://stock.nexiohyper.com",
                "Access-Control-Request-Method": "POST",
            },
        )
        rejected = await client.options(
            "/auth/login/superadmin",
            headers={
                "Origin": "https://unknown.nexiohyper.com",
                "Access-Control-Request-Method": "POST",
            },
        )

    assert allowed.status_code == 200
    assert allowed.headers["access-control-allow-origin"] == "https://stock.nexiohyper.com"
    assert rejected.status_code == 400
    assert "access-control-allow-origin" not in rejected.headers


def test_create_app_uses_only_env_configured_cors_origins() -> None:
    get_settings.cache_clear()  # type: ignore[attr-defined]
    _configure_test_env()
    os.environ["CORS_ALLOW_ORIGINS"] = '["https://stock.nexiohyper.com"]'

    app = create_app()

    assert app.state.cors_allow_origins == ("https://stock.nexiohyper.com",)
