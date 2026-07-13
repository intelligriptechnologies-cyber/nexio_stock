"""Lot + LotLine schemas."""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.lot import Lot, LotLine
from app.schemas.vendor import VendorPublic


class LotLineCreate(BaseModel):
    """One scanned (or manually-typed) line in a lot."""

    model_config = ConfigDict(extra="forbid")

    barcode: str = Field(min_length=1, max_length=64, description="scanned or typed")
    quantity: int = Field(gt=0, le=100_000)
    good_condition_quantity: int | None = Field(default=None, ge=0, le=100_000)

    @model_validator(mode="after")
    def _condition_not_exceed_received(self) -> LotLineCreate:
        if self.good_condition_quantity is not None and self.good_condition_quantity > self.quantity:
            raise ValueError("good_condition_quantity cannot exceed quantity")
        return self


class LotLinePublic(BaseModel):
    """One line on a lot."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    product_id: int
    quantity: int
    good_condition_quantity: int
    breakage_quantity: int
    product_brand: str
    product_size_label: str


class LotCreate(BaseModel):
    """Receiver's full lot-receipt request."""

    model_config = ConfigDict(extra="forbid")

    vendor_id: int | None = Field(default=None)
    purchase_date: date | None = Field(default=None)
    vendor_invoice_number: str | None = Field(default=None, min_length=1, max_length=100)
    invoice_value: Decimal | None = Field(default=None, gt=Decimal("0"), max_digits=12, decimal_places=2)
    reference: str | None = Field(default=None, max_length=100)
    notes: str | None = Field(default=None, max_length=500)
    lines: list[LotLineCreate] = Field(min_length=1, max_length=500)
    # Superadmin-only: names the target shop, since superadmin has no shop_id.
    shop_id: int | None = Field(default=None)

    @model_validator(mode="after")
    def _unique_barcodes(self) -> LotCreate:
        seen: set[str] = set()
        for line in self.lines:
            if line.barcode in seen:
                raise ValueError(f"duplicate barcode in lines: {line.barcode}")
            seen.add(line.barcode)
        return self


class LotPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    shop_id: int
    vendor_id: int
    received_by_user_id: int
    purchase_date: date
    vendor_invoice_number: str
    invoice_value: Decimal
    reference: str | None
    notes: str | None
    received_at: datetime
    created_at: datetime
    vendor: VendorPublic
    lines: list[LotLinePublic]


class LotListResponse(BaseModel):
    lots: list[LotPublic]


__all__ = [
    "Lot",
    "LotCreate",
    "LotLine",
    "LotLineCreate",
    "LotLinePublic",
    "LotListResponse",
    "LotPublic",
]
