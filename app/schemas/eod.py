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


# --- Issue #41: Dashboard cross-shop stock overview ---


class StockOverviewShopRow(BaseModel):
    """Stock for one product in one shop. The cross-shop overview is
    a list of these grouped by shop on the frontend."""

    product_id: int
    barcode: str
    brand: str
    size_label: str
    current_stock: int
    is_active: bool


class StockOverviewShopGroup(BaseModel):
    """One shop's worth of stock rows. The shop's name rides along so
    the frontend doesn't need a second round-trip to label each group."""

    shop_id: int
    shop_name: str
    items: list[StockOverviewShopRow]


class StockOverviewResponse(BaseModel):
    """Aggregated stock across every shop the caller is authorized to
    see (R-v3-5, D-v3-5). Independent of the per-shop low-stock list
    (D-v3-5: a new dedicated endpoint, not an all_shops flag bolted
    onto /dashboard/low-stock)."""

    shops: list[StockOverviewShopGroup]
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
    "StockOverviewResponse",
    "StockOverviewShopGroup",
    "StockOverviewShopRow",
]
