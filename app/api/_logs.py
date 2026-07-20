"""Shared helper for writing business-event log rows."""
from __future__ import annotations

import json
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.logging_config import get_logger
from app.models.log import AdminLog, InvoicingLog, StockinLog
from app.services.log_files import append_log_csv_rows, append_log_line, checkout_text, receiving_text

BusinessLog = InvoicingLog | StockinLog | AdminLog
log = get_logger(__name__)

_CHECKOUT_CSV_HEADER = [
    "logged_at",
    "event_type",
    "shop_id",
    "shop_name",
    "actor_user_id",
    "actor_name",
    "invoice_id",
    "invoice_number",
    "source",
    "product_id",
    "product_name_snapshot",
    "barcode",
    "quantity",
    "unit_price",
    "line_total",
    "invoice_total",
    "payment_mode",
    "payment_details",
]
_RECEIVING_CSV_HEADER = [
    "logged_at",
    "event_type",
    "shop_id",
    "shop_name",
    "actor_user_id",
    "actor_name",
    "lot_id",
    "vendor_id",
    "vendor_name",
    "vendor_gstin",
    "purchase_date",
    "vendor_invoice_number",
    "invoice_value",
    "reference",
    "notes",
    "product_id",
    "product_name_snapshot",
    "barcode",
    "quantity",
    "good_condition_quantity",
    "breakage_quantity",
    "current_price",
    "row_total",
]


def _snapshot_name(brand: str | None, size_label: str | None) -> str:
    parts = [part for part in (brand, size_label) if part]
    return " ".join(parts) if parts else "unknown product"


def _money(value: object) -> str:
    return "" if value in (None, "") else str(value)


def _payment_summary(payments: list[object]) -> str:
    modes: list[str] = []
    for payment in payments:
        if isinstance(payment, dict):
            mode = payment.get("mode")
            if isinstance(mode, str) and mode:
                modes.append(mode)
    if not modes:
        return "no payments listed"
    unique_modes = list(dict.fromkeys(modes))
    return unique_modes[0] if len(unique_modes) == 1 else " + ".join(unique_modes) + " split"


def _payment_details(payments: list[object]) -> str:
    return json.dumps(payments, ensure_ascii=False, sort_keys=True)


def _checkout_csv_rows(
    *,
    payload: dict,
    actor_id: int | None,
    actor_name: str | None,
    logged_at: datetime,
) -> list[dict[str, object]]:
    payments = payload.get("payments", [])
    payment_details = _payment_details(payments if isinstance(payments, list) else [])
    payment_mode = _payment_summary(payments if isinstance(payments, list) else [])
    base = {
        "logged_at": logged_at.astimezone().isoformat(timespec="seconds"),
        "event_type": "invoice.finalized",
        "shop_id": payload.get("shop_id"),
        "shop_name": payload.get("shop_name") or "",
        "actor_user_id": actor_id,
        "actor_name": actor_name or "",
        "invoice_id": payload.get("invoice_id"),
        "invoice_number": payload.get("invoice_number"),
        "source": payload.get("source") or "",
        "invoice_total": payload.get("total_amount"),
        "payment_mode": payment_mode,
        "payment_details": payment_details,
    }
    rows: list[dict[str, object]] = []
    for line in payload.get("lines", []):
        if not isinstance(line, dict):
            continue
        rows.append(
            {
                **base,
                "product_id": line.get("product_id"),
                "product_name_snapshot": line.get("product_name_snapshot")
                or _snapshot_name(
                    line.get("product_brand") if isinstance(line.get("product_brand"), str) else None,
                    line.get("product_size_label") if isinstance(line.get("product_size_label"), str) else None,
                ),
                "barcode": line.get("barcode") or "",
                "quantity": line.get("quantity"),
                "unit_price": _money(line.get("unit_price")),
                "line_total": _money(line.get("line_total")),
            }
        )
    return rows


def _receiving_csv_rows(
    *,
    payload: dict,
    actor_id: int | None,
    actor_name: str | None,
    logged_at: datetime,
) -> list[dict[str, object]]:
    base = {
        "logged_at": logged_at.astimezone().isoformat(timespec="seconds"),
        "event_type": "lot.received",
        "shop_id": payload.get("shop_id"),
        "shop_name": payload.get("shop_name") or "",
        "actor_user_id": actor_id,
        "actor_name": actor_name or "",
        "lot_id": payload.get("lot_id"),
        "vendor_id": payload.get("vendor_id"),
        "vendor_name": payload.get("vendor_name") or "",
        "vendor_gstin": payload.get("vendor_gstin") or "",
        "purchase_date": payload.get("purchase_date") or "",
        "vendor_invoice_number": payload.get("vendor_invoice_number") or "",
        "invoice_value": payload.get("invoice_value") or "",
        "reference": payload.get("reference") or "",
        "notes": payload.get("notes") or "",
    }
    rows: list[dict[str, object]] = []
    for line in payload.get("lines", []):
        if not isinstance(line, dict):
            continue
        rows.append(
            {
                **base,
                "product_id": line.get("product_id"),
                "product_name_snapshot": line.get("product_name_snapshot")
                or _snapshot_name(
                    line.get("product_brand") if isinstance(line.get("product_brand"), str) else None,
                    line.get("product_size_label") if isinstance(line.get("product_size_label"), str) else None,
                ),
                "barcode": line.get("barcode") or "",
                "quantity": line.get("quantity"),
                "good_condition_quantity": line.get("good_condition_quantity"),
                "breakage_quantity": line.get("breakage_quantity"),
                "current_price": _money(line.get("current_price")),
                "row_total": _money(line.get("row_total")),
            }
        )
    return rows


def write_business_log(
    db: AsyncSession,
    log_cls: type[BusinessLog],
    *,
    event_type: str,
    payload: dict,
    actor_id: int | None,
    shop_id: int | None,
    actor_name: str | None = None,
    shop_log_scope_key: str | None = None,
    shop_created_at: datetime | None = None,
) -> BusinessLog:
    """Stage one business-event log row on `db` (call site still commits)."""

    row = log_cls(
        shop_id=shop_id,
        actor_user_id=actor_id,
        event_type=event_type,
        payload=payload,
    )
    db.add(row)
    logged_at = datetime.now(UTC)
    if log_cls is InvoicingLog and event_type.startswith("invoice."):
        try:
            append_log_line(
                "checkout",
                shop_id=shop_id,
                at=logged_at,
                log_scope_key=shop_log_scope_key,
                shop_created_at=shop_created_at,
                text=checkout_text(
                    event_type=event_type,
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
                format="txt",
            )
        if event_type == "invoice.finalized":
            try:
                append_log_csv_rows(
                    "checkout",
                    shop_id=shop_id,
                    at=logged_at,
                    log_scope_key=shop_log_scope_key,
                    shop_created_at=shop_created_at,
                    header=_CHECKOUT_CSV_HEADER,
                    rows=_checkout_csv_rows(
                        payload=payload,
                        actor_id=actor_id,
                        actor_name=actor_name,
                        logged_at=logged_at,
                    ),
                )
            except OSError as exc:
                log.error(
                    "log_file.write_failed",
                    log_type=log_cls.__name__,
                    shop_id=shop_id,
                    event_type=event_type,
                    error=str(exc),
                    format="csv",
                )
    elif log_cls is StockinLog and event_type == "lot.received":
        try:
            append_log_line(
                "receiving",
                shop_id=shop_id,
                at=logged_at,
                log_scope_key=shop_log_scope_key,
                shop_created_at=shop_created_at,
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
                format="txt",
            )
        try:
            append_log_csv_rows(
                "receiving",
                shop_id=shop_id,
                at=logged_at,
                log_scope_key=shop_log_scope_key,
                shop_created_at=shop_created_at,
                header=_RECEIVING_CSV_HEADER,
                rows=_receiving_csv_rows(
                    payload=payload,
                    actor_id=actor_id,
                    actor_name=actor_name,
                    logged_at=logged_at,
                ),
            )
        except OSError as exc:
            log.error(
                "log_file.write_failed",
                log_type=log_cls.__name__,
                shop_id=shop_id,
                event_type=event_type,
                error=str(exc),
                format="csv",
            )
    return row


__all__ = ["write_business_log"]
