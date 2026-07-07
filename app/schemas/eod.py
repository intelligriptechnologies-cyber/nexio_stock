"""EOD / dashboard schemas."""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.schemas.checkout import InvoicePublic


class SignOffRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    business_date: date = Field(description="Calendar date to sign off")
    notes: str | None = Field(default=None, max_length=500)
    # Superadmin-only (D-65): names the target shop. Owner must omit this.
    shop_id: int | None = Field(default=None)

    @field_validator("business_date")
    @classmethod
    def _not_far_past(cls, v: date) -> date:
        return v


class SignOffResponse(BaseModel):
    business_date: date
    signed_off_at: datetime
    signed_off_by_user_id: int
    invoices_signed_off: int


class PaymentModeTotal(BaseModel):
    mode: str
    amount: Decimal


class EodTotalsResponse(BaseModel):
    business_date: date
    signed_off: bool
    invoice_count: int
    revenue: Decimal
    voided_count: int
    reversal_count: int
    payments_by_mode: list[PaymentModeTotal]


class SignOffHistoryResponse(BaseModel):
    signoffs: list[SignOffResponse]


class PendingVoidResponse(BaseModel):
    invoices: list[InvoicePublic]

class LowStockItem(BaseModel):
    product_id: int
    barcode: str
    brand: str
    size_label: str
    current_stock: int
    effective_threshold: int


class LowStockResponse(BaseModel):
    items: list[LowStockItem]
    # When the list was last computed (UTC). Always set on a fresh
    # compute; lets the UI show "evaluated 3 minutes ago".
    evaluated_at: datetime


__all__ = [
    "EodTotalsResponse",
    "LowStockItem",
    "LowStockResponse",
    "PaymentModeTotal",
    "PendingVoidResponse",
    "SignOffHistoryResponse",
    "SignOffRequest",
    "SignOffResponse",
]
