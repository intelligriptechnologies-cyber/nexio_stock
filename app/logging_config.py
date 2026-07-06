"""Structured logging setup (R-38, D-48). One JSON line per record to stdout.

Two layers:
- structlog for the app's own log calls (info, warning, error, ...).
- stdlib logging compatibility so libraries (uvicorn, sqlalchemy, alembic) are
  also formatted as JSON.

Business event logs go to durable tables (invoicing_logs / stockin_logs /
admin_logs) — never to stdout. Stdout is operational/diagnostic only.
"""
from __future__ import annotations

import logging
import sys
from typing import Any

import structlog


def configure_logging(level: str = "INFO") -> None:
    """Idempotent. Call once at process start (app + uvicorn lifespan)."""
    log_level = getattr(logging, level.upper(), logging.INFO)

    # Shared processors — applied to every record (app + stdlib).
    shared_processors: list[Any] = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
    ]

    structlog.configure(
        processors=[
            *shared_processors,
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        wrapper_class=structlog.make_filtering_bound_logger(log_level),
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )

    formatter = structlog.stdlib.ProcessorFormatter(
        # foreign_pre_chain applies shared_processors to stdlib records
        # (uvicorn, sqlalchemy) before the final renderer.
        foreign_pre_chain=shared_processors,
        processors=[
            structlog.stdlib.ProcessorFormatter.remove_processors_meta,
            structlog.processors.JSONRenderer(),
        ],
    )

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(formatter)

    root = logging.getLogger()
    # Replace any existing handlers (uvicorn installs its own) so JSON wins.
    root.handlers = [handler]
    root.setLevel(log_level)

    # Quiet the chatty defaults a touch — still INFO, just don't dump
    # every SELECT statement.
    for noisy in ("sqlalchemy.engine", "sqlalchemy.pool"):
        logging.getLogger(noisy).setLevel(max(log_level, logging.WARNING))


def get_logger(name: str | None = None) -> structlog.stdlib.BoundLogger:
    return structlog.get_logger(name)
