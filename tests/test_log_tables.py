"""Log-table existence test (acceptance: invoicing_logs, stockin_logs, admin_logs)."""
from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


async def test_three_log_tables_exist(db_session: AsyncSession) -> None:
    rows = (
        await db_session.execute(
            text(
                "SELECT table_name FROM information_schema.tables "
                "WHERE table_name IN ('invoicing_logs', 'stockin_logs', 'admin_logs') "
                "ORDER BY table_name"
            )
        )
    ).all()
    assert [r[0] for r in rows] == ["admin_logs", "invoicing_logs", "stockin_logs"]


async def test_log_tables_have_required_columns(db_session: AsyncSession) -> None:
    """The audit-trail backbone (R-37): every log row has shop, actor, event, payload, ts."""
    for table in ("invoicing_logs", "stockin_logs", "admin_logs"):
        cols = (
            await db_session.execute(
                text(
                    "SELECT column_name FROM information_schema.columns "
                    "WHERE table_name = :t ORDER BY ordinal_position"
                ),
                {"t": table},
            )
        ).scalars().all()
        assert {"id", "shop_id", "actor_user_id", "event_type", "payload", "created_at"} <= set(
            cols
        ), f"missing required columns in {table}: {cols}"
