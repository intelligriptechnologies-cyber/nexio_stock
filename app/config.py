"""Application configuration loaded from environment variables (.env supported)."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # App
    app_env: Literal["development", "staging", "production", "test"] = "development"
    app_name: str = "barstock"
    app_version: str = "0.1.0"
    log_level: str = "INFO"

    # Security
    secret_key: str = Field(min_length=32)
    jwt_algorithm: str = "HS256"
    jwt_access_ttl_min: int = 720
    bcrypt_rounds: int = 12

    # Database
    database_url: str

    # CORS — JSON array of origins in env, e.g. ["http://localhost:5173"]
    cors_allow_origins: list[str] = Field(default_factory=list)
    # Background-task knobs (#7)
    low_stock_interval_min: int = 5

    # Daily human-readable operational log files. In production this
    # should point at a persistent mounted directory.
    log_files_dir: Path = Path("runtime/logs")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
