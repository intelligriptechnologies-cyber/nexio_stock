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

from app.models.log import AdminLog, InvoicingLog, StockinLog

BusinessLog = InvoicingLog | StockinLog | AdminLog


def write_business_log(
    db: AsyncSession,
    log_cls: type[BusinessLog],
    *,
    event_type: str,
    payload: dict,
    actor_id: int | None,
    shop_id: int | None,
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
    return row


__all__ = ["write_business_log"]
