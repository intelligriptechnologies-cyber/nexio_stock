"""Checkout + invoice + payment schemas."""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.invoice import (
    Invoice,
    InvoiceLine,
    InvoiceStatus,
    Payment,
    PaymentMode,
)


class CheckoutLine(BaseModel):
    """One cart line in the finalize request. The cashier submits the
    barcodes + quantities; the server is the source of truth on price."""

    model_config = ConfigDict(extra="forbid")

    barcode: str = Field(min_length=1, max_length=64)
    quantity: int = Field(gt=0, le=100_000)


class PaymentInput(BaseModel):
    """One payment line. One or more per invoice (D-59, R-40)."""

    model_config = ConfigDict(extra="forbid")

    mode: PaymentMode
    amount: Decimal = Field(gt=Decimal("0"), max_digits=12, decimal_places=2)


class CheckoutFinalizeRequest(BaseModel):
    """The body of POST /checkout/finalize.

    The client must also send an `Idempotency-Key` header — the service
    layer enforces it; the route reads it from the request.
    """

    model_config = ConfigDict(extra="forbid")

    lines: list[CheckoutLine] = Field(min_length=1, max_length=200)
    payments: list[PaymentInput] = Field(min_length=1, max_length=10)
    note: str | None = Field(default=None, max_length=200)
    # Superadmin-only (D-65): names the target shop. Owner/cashier must
    # omit this — their own shop_id is used implicitly.
    shop_id: int | None = Field(default=None)

    @model_validator(mode="after")
    def _payments_nonempty_amount(self) -> CheckoutFinalizeRequest:
        total = sum((p.amount for p in self.payments), Decimal("0"))
        if total <= 0:
            raise ValueError("payments must sum to a positive amount")
        return self


class InvoiceLinePublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    product_id: int
    quantity: int
    unit_price: Decimal
    line_total: Decimal


class PaymentPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    mode: PaymentMode
    amount: Decimal


class InvoicePublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    shop_id: int
    cashier_user_id: int
    invoice_number: int
    status: InvoiceStatus
    total_amount: Decimal
    note: str | None
    finalized_at: datetime
    eod_signed_off: bool
    lines: list[InvoiceLinePublic]
    payments: list[PaymentPublic]


class CheckoutFinalizeResponse(BaseModel):
    invoice: InvoicePublic
    is_replay: bool  # True when an existing Idempotency-Key was matched


# Re-exports.
__all__ = [
    "CheckoutFinalizeRequest",
    "CheckoutFinalizeResponse",
    "CheckoutLine",
    "Invoice",
    "InvoiceLine",
    "InvoiceLinePublic",
    "InvoicePublic",
    "InvoiceStatus",
    "Payment",
    "PaymentInput",
    "PaymentMode",
    "PaymentPublic",
]
