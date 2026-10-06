"""Safe, append-only operational events for purchase-order PDF imports.

This is deliberately a file log rather than a database table: it remains
available when an import fails before a transaction can be committed.  Never
put document bytes, OCR output, filenames, or parsed order contents here.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.config import get_settings

IMPORT_AUDIT_FIELDS = (
    "at",
    "attempt_id",
    "event",
    "stage",
    "http_status",
    "user_id",
    "shop_id",
    "file_size_bytes",
    "page_count",
    "elapsed_ms",
    "stage_durations_ms",
    "error_type",
    "traceback",
)


def _audit_root() -> Path:
    root = get_settings().log_files_dir
    if not root.is_absolute():
        root = Path.cwd() / root
    return root / "imports"


def append_import_audit(**event: Any) -> Path:
    """Append a structured event using only the explicit safe field allowlist."""
    moment = datetime.now(UTC)
    payload = {key: event.get(key) for key in IMPORT_AUDIT_FIELDS if event.get(key) is not None}
    payload["at"] = moment.isoformat(timespec="milliseconds")
    path = _audit_root() / f"imports-{moment.astimezone().date().isoformat()}.jsonl"
    # Observability must never turn an otherwise valid import into a failure.
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(payload, separators=(",", ":"), sort_keys=True) + "\n")
    except OSError:
        pass
    return path
