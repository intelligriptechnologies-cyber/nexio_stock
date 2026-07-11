"""Offline-session API schemas."""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

from app.models.offline_session import OfflineSessionState
from app.schemas.checkout import CheckoutLine, PaymentInput


class OfflineCatalogItem(BaseModel):
    id: int
    barcode: str
    brand: str
    size_label: str
    price: Decimal
    current_stock: int


class OfflineSessionStartRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    shop_id: int | None = Field(default=None)


class OfflineSessionPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    shop_id: int
    cashier_user_id: int
    state: OfflineSessionState
    baseline_business_date: date
    server_last_invoice_number: int
    receipt_counter: int
    receipt_count: int
    gross_total: Decimal
    expires_at: datetime
    max_expires_at: datetime
    extension_count: int
    sync_attempts: int
    sync_result: dict | None
    failure_reason: dict | None
    discard_reason: str | None
    started_at: datetime
    state_changed_at: datetime
    synced_at: datetime | None
    discarded_at: datetime | None
    expired_at: datetime | None


class OfflineSessionStartResponse(BaseModel):
    session: OfflineSessionPublic
    offline_token: str
    catalog: list[OfflineCatalogItem]


class OfflineSessionActiveResponse(BaseModel):
    session: OfflineSessionPublic | None


class OfflineSessionExtendResponse(BaseModel):
    session: OfflineSessionPublic
    offline_token: str


class OfflineReceiptIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    temp_receipt_id: str = Field(min_length=1, max_length=80)
    idempotency_key: str = Field(min_length=1, max_length=80)
    lines: list[CheckoutLine] = Field(min_length=1, max_length=200)
    payments: list[PaymentInput] = Field(min_length=1, max_length=10)
    note: str | None = Field(default=None, max_length=200)
    created_at: datetime | None = None


class OfflineSessionSyncRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    receipts: list[OfflineReceiptIn] = Field(min_length=1, max_length=500)


class OfflineReceiptSyncMapping(BaseModel):
    temp_receipt_id: str
    invoice_id: int
    invoice_number: int


class OfflineSessionSyncResponse(BaseModel):
    session: OfflineSessionPublic
    mappings: list[OfflineReceiptSyncMapping]
    is_replay: bool = False


class OfflineSessionDiscardRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str = Field(min_length=3, max_length=500)


__all__ = [
    "OfflineCatalogItem",
    "OfflineReceiptIn",
    "OfflineReceiptSyncMapping",
    "OfflineSessionActiveResponse",
    "OfflineSessionDiscardRequest",
    "OfflineSessionExtendResponse",
    "OfflineSessionPublic",
    "OfflineSessionStartRequest",
    "OfflineSessionStartResponse",
    "OfflineSessionSyncRequest",
    "OfflineSessionSyncResponse",
]
