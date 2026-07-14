"""Calendar helpers shared by services and API layers."""
from __future__ import annotations

from datetime import UTC, datetime
from datetime import date as date_cls


def today_local_date(now: datetime | None = None) -> date_cls:
    """Server-local calendar date used for business-day stamping."""
    moment = now if now is not None else datetime.now(UTC)
    return moment.astimezone().date()

