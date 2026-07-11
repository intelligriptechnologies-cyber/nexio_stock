"""Daily plain-text operational log files."""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Any, Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models.log import LogFileRetentionSetting

LogFileType = Literal["checkout", "receiving", "closing", "exceptions"]

DEFAULT_RETENTION_DAYS = 10
SUPPORTED_LOG_TYPES: tuple[LogFileType, ...] = (
    "checkout",
    "receiving",
    "closing",
    "exceptions",
)

_TYPE_TO_FOLDER: dict[LogFileType, str] = {
    "checkout": "checkout",
    "receiving": "receiving",
    "closing": "closing",
    "exceptions": "exceptions",
}
_TYPE_TO_PREFIX: dict[LogFileType, str] = {
    "checkout": "checkout",
    "receiving": "receiving",
    "closing": "closing",
    "exceptions": "exceptions",
}
_FILENAME_RE = re.compile(r"^(checkout|receiving|closing|exceptions)-(\d{4}-\d{2}-\d{2})\.txt$")


@dataclass(frozen=True)
class LogFileInfo:
    filename: str
    relative_path: str
    size_bytes: int
    modified_at: datetime
    file_date: date
    age_days: int
    expires_in_days: int


def _root() -> Path:
    root = get_settings().log_files_dir
    if not root.is_absolute():
        root = Path.cwd() / root
    return root


def _scope_folder(*, shop_id: int | None, system: bool = False) -> str:
    if system or shop_id is None:
        return "system"
    return f"shop-{shop_id}"


def log_dir(log_type: LogFileType, *, shop_id: int | None, system: bool = False) -> Path:
    return _root() / _scope_folder(shop_id=shop_id, system=system) / _TYPE_TO_FOLDER[log_type]


def daily_log_path(
    log_type: LogFileType,
    *,
    shop_id: int | None,
    system: bool = False,
    day: date | None = None,
) -> Path:
    effective_day = day if day is not None else datetime.now(UTC).astimezone().date()
    filename = f"{_TYPE_TO_PREFIX[log_type]}-{effective_day.isoformat()}.txt"
    return log_dir(log_type, shop_id=shop_id, system=system) / filename


def append_log_line(
    log_type: LogFileType,
    *,
    shop_id: int | None,
    text: str,
    system: bool = False,
    at: datetime | None = None,
) -> Path:
    moment = at if at is not None else datetime.now(UTC)
    path = daily_log_path(
        log_type,
        shop_id=shop_id,
        system=system,
        day=moment.astimezone().date(),
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    line = f"[{moment.astimezone().isoformat(timespec='seconds')}] {text.strip()}\n"
    with path.open("a", encoding="utf-8") as fh:
        fh.write(line)
    return path


async def get_retention_days(
    db: AsyncSession, *, log_type: LogFileType, shop_id: int | None
) -> int:
    row = (
        await db.execute(
            select(LogFileRetentionSetting).where(
                LogFileRetentionSetting.shop_id.is_(None)
                if shop_id is None
                else LogFileRetentionSetting.shop_id == shop_id,
                LogFileRetentionSetting.log_type == log_type,
            )
        )
    ).scalar_one_or_none()
    return row.retention_days if row is not None else DEFAULT_RETENTION_DAYS


async def set_retention_days(
    db: AsyncSession, *, log_type: LogFileType, shop_id: int | None, retention_days: int
) -> int:
    row = (
        await db.execute(
            select(LogFileRetentionSetting).where(
                LogFileRetentionSetting.shop_id.is_(None)
                if shop_id is None
                else LogFileRetentionSetting.shop_id == shop_id,
                LogFileRetentionSetting.log_type == log_type,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        row = LogFileRetentionSetting(
            shop_id=shop_id,
            log_type=log_type,
            retention_days=retention_days,
        )
        db.add(row)
    else:
        row.retention_days = retention_days
    await db.commit()
    return retention_days


def _file_date(filename: str) -> date | None:
    match = _FILENAME_RE.match(filename)
    if not match:
        return None
    try:
        return date.fromisoformat(match.group(2))
    except ValueError:
        return None


def _today() -> date:
    return datetime.now(UTC).astimezone().date()


def cleanup_expired_files(
    log_type: LogFileType,
    *,
    shop_id: int | None,
    retention_days: int,
    include_system: bool = False,
) -> None:
    dirs = [log_dir(log_type, shop_id=shop_id, system=shop_id is None)]
    if include_system and shop_id is not None:
        dirs.append(log_dir(log_type, shop_id=None, system=True))
    today = _today()
    for folder in dirs:
        if not folder.exists():
            continue
        for path in folder.glob(f"{_TYPE_TO_PREFIX[log_type]}-*.txt"):
            file_date = _file_date(path.name)
            if file_date is None:
                continue
            if (today - file_date).days >= retention_days:
                path.unlink(missing_ok=True)


def cleanup_all_expired_files(log_type: LogFileType, *, retention_days: int) -> None:
    root = _root()
    if not root.exists():
        return
    today = _today()
    for path in root.glob(f"**/{_TYPE_TO_FOLDER[log_type]}/{_TYPE_TO_PREFIX[log_type]}-*.txt"):
        file_date = _file_date(path.name)
        if file_date is None:
            continue
        if (today - file_date).days >= retention_days:
            path.unlink(missing_ok=True)


def list_log_files(
    log_type: LogFileType,
    *,
    shop_id: int | None,
    retention_days: int,
    include_all_scopes: bool = False,
) -> list[LogFileInfo]:
    root = _root()
    if include_all_scopes:
        candidates = root.glob(f"**/{_TYPE_TO_FOLDER[log_type]}/{_TYPE_TO_PREFIX[log_type]}-*.txt")
    else:
        folder = log_dir(log_type, shop_id=shop_id, system=shop_id is None)
        candidates = folder.glob(f"{_TYPE_TO_PREFIX[log_type]}-*.txt")
    today = _today()
    files: list[LogFileInfo] = []
    for path in candidates:
        if not path.is_file():
            continue
        file_date = _file_date(path.name)
        if file_date is None:
            continue
        stat = path.stat()
        age_days = max(0, (today - file_date).days)
        files.append(
            LogFileInfo(
                filename=path.name,
                relative_path=path.relative_to(root).as_posix(),
                size_bytes=stat.st_size,
                modified_at=datetime.fromtimestamp(stat.st_mtime, tz=UTC),
                file_date=file_date,
                age_days=age_days,
                expires_in_days=max(0, retention_days - age_days),
            )
        )
    return sorted(files, key=lambda item: (item.file_date, item.relative_path), reverse=True)


def resolve_download_path(
    log_type: LogFileType,
    *,
    filename: str,
    shop_id: int | None,
    include_all_scopes: bool = False,
) -> Path | None:
    if _file_date(filename) is None or not filename.startswith(f"{_TYPE_TO_PREFIX[log_type]}-"):
        return None
    root = _root().resolve()
    if include_all_scopes:
        matches = list(root.glob(f"**/{_TYPE_TO_FOLDER[log_type]}/{filename}"))
        if not matches:
            return None
        path = matches[0].resolve()
    else:
        path = log_dir(log_type, shop_id=shop_id, system=shop_id is None) / filename
        path = path.resolve()
    try:
        path.relative_to(root)
    except ValueError:
        return None
    return path if path.exists() and path.is_file() else None


def _fmt_money(value: Any) -> str:
    return f"Rs. {value}"


def _fmt_actor(actor_id: int | None, actor_name: str | None = None) -> str:
    if actor_name:
        return f"{actor_name} (user #{actor_id})" if actor_id is not None else actor_name
    return f"user #{actor_id}" if actor_id is not None else "system"


def checkout_text(
    *,
    event_type: str,
    payload: dict[str, Any],
    actor_id: int | None,
    actor_name: str | None = None,
) -> str:
    actor = _fmt_actor(actor_id, actor_name)
    invoice_number = payload.get("invoice_number", "unknown")
    invoice_id = payload.get("invoice_id", "unknown")
    source = payload.get("source")
    prefix = "Offline sync created invoice" if source == "offline_session_sync" else "Invoice event"
    if event_type == "invoice.finalized":
        payments = ", ".join(
            f"{p.get('mode', 'unknown')} {_fmt_money(p.get('amount', '0.00'))}"
            for p in payload.get("payments", [])
            if isinstance(p, dict)
        ) or "no payments listed"
        lines = ", ".join(
            (
                f"product #{line.get('product_id')} x {line.get('quantity')} "
                f"at {_fmt_money(line.get('unit_price', '0.00'))}"
            )
            for line in payload.get("lines", [])
            if isinstance(line, dict)
        ) or "no lines listed"
        return (
            f"{prefix} #{invoice_number} (id {invoice_id}) by {actor}; "
            f"total {_fmt_money(payload.get('total_amount', '0.00'))}; "
            f"payments: {payments}; lines: {lines}."
        )
    if event_type.startswith("invoice.void"):
        action = event_type.removeprefix("invoice.").replace("_", " ")
        reason = payload.get("reason") or "no reason provided"
        return (
            f"Void event '{action}' for invoice #{invoice_number} (id {invoice_id}) "
            f"by {actor}; status {payload.get('from_status')} -> {payload.get('to_status')}; "
            f"reason: {reason}."
        )
    if event_type == "invoice.edited":
        return f"Invoice #{invoice_number} was edited by {actor}; before/after details are in the audit database."
    return f"{event_type} for invoice #{invoice_number} by {actor}."


def receiving_text(
    *, payload: dict[str, Any], actor_id: int | None, actor_name: str | None = None
) -> str:
    actor = _fmt_actor(actor_id, actor_name)
    lines = ", ".join(
        (
            f"{line.get('brand', 'product')} {line.get('size_label', '')} "
            f"(barcode {line.get('barcode')}) quantity {line.get('quantity')}"
        ).strip()
        for line in payload.get("lines", [])
        if isinstance(line, dict)
    ) or "no lines listed"
    reference = payload.get("reference") or "no reference"
    return f"Receiver {actor} recorded lot #{payload.get('lot_id')} ({reference}); products received: {lines}."


def closing_text(
    *,
    business_date: date,
    signer_id: int | None,
    signer_name: str | None,
    invoice_count: int,
    revenue: Any,
    payments_by_mode: dict[str, Any],
    voided_count: int,
    reversal_count: int,
    invoices_signed_off: int,
) -> str:
    payments = ", ".join(
        f"{mode} {_fmt_money(amount)}" for mode, amount in sorted(payments_by_mode.items())
    ) or "no payments"
    return (
        f"EOD sign-off completed for {business_date.isoformat()} by "
        f"{_fmt_actor(signer_id, signer_name)}; invoice count {invoice_count}; "
        f"revenue {_fmt_money(revenue)}; payment split: {payments}; "
        f"voided invoices {voided_count}; reversal invoices {reversal_count}; "
        f"archived/signed off {invoices_signed_off} invoices."
    )


def exception_text(
    *,
    method: str,
    path: str,
    user_id: int | None,
    shop_id: int | None,
    exc: BaseException,
    traceback_text: str,
) -> str:
    return (
        f"Unhandled exception during {method} {path}; "
        f"user={user_id if user_id is not None else 'unknown'}; "
        f"shop={shop_id if shop_id is not None else 'unknown'}; "
        f"{type(exc).__name__}: {exc}\n{traceback_text.rstrip()}"
    )


__all__ = [
    "DEFAULT_RETENTION_DAYS",
    "SUPPORTED_LOG_TYPES",
    "LogFileInfo",
    "LogFileType",
    "append_log_line",
    "checkout_text",
    "cleanup_all_expired_files",
    "cleanup_expired_files",
    "closing_text",
    "exception_text",
    "get_retention_days",
    "list_log_files",
    "receiving_text",
    "resolve_download_path",
    "set_retention_days",
]
