"""Shared helper for writing business-event log rows.

`checkout.py`, `lots.py`, `products.py`, and `voids.py` each need to
append one row to a domain log table (`InvoicingLog`, `StockinLog`, or
`AdminLog` — see `app/models/log.py`) after a mutation. The three
tables share the same columns (`shop_id`, `actor_user_id`, `event_type`,
`payload`), so the write itself is one line — this module exists so
routers don't each re-derive that line.
"""
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.logging_config import get_logger
from app.models.log import AdminLog, InvoicingLog, StockinLog
from app.services.log_files import append_log_line, checkout_text, receiving_text

BusinessLog = InvoicingLog | StockinLog | AdminLog
log = get_logger(__name__)


def write_business_log(
    db: AsyncSession,
    log_cls: type[BusinessLog],
    *,
    event_type: str,
    payload: dict,
    actor_id: int | None,
    shop_id: int | None,
    actor_name: str | None = None,
) -> BusinessLog:
    """Stage one business-event log row on `db` (call site still commits).

    Returns the row so callers that need to read it back (e.g. its id)
    can do so without a second lookup.
    """
    row = log_cls(
        shop_id=shop_id,
        actor_user_id=actor_id,
        event_type=event_type,
        payload=payload,
    )
    db.add(row)
    try:
        if log_cls is InvoicingLog and event_type.startswith("invoice."):
            append_log_line(
                "checkout",
                shop_id=shop_id,
                text=checkout_text(
                    event_type=event_type,
                    payload=payload,
                    actor_id=actor_id,
                    actor_name=actor_name,
                ),
            )
        elif log_cls is StockinLog and event_type == "lot.received":
            append_log_line(
                "receiving",
                shop_id=shop_id,
                text=receiving_text(
                    payload=payload,
                    actor_id=actor_id,
                    actor_name=actor_name,
                ),
            )
    except OSError as exc:
        log.error(
            "log_file.write_failed",
            log_type=log_cls.__name__,
            shop_id=shop_id,
            event_type=event_type,
            error=str(exc),
        )
    return row


__all__ = ["write_business_log"]
