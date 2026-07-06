"""Lot + LotLine schemas."""
from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.lot import Lot, LotLine


class LotLineCreate(BaseModel):
    """One scanned (or manually-typed) line in a lot."""

    model_config = ConfigDict(extra="forbid")

    barcode: str = Field(min_length=1, max_length=64, description="scanned or typed")
    quantity: int = Field(gt=0, le=100_000)


class LotLinePublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    product_id: int
    quantity: int


class LotCreate(BaseModel):
    """Receiver's full lot-receipt request."""

    model_config = ConfigDict(extra="forbid")

    reference: str | None = Field(default=None, max_length=100)
    notes: str | None = Field(default=None, max_length=500)
    lines: list[LotLineCreate] = Field(min_length=1, max_length=500)

    @model_validator(mode="after")
    def _unique_barcodes(self) -> LotCreate:
        # The DB has a UNIQUE(lot_id, product_id) constraint that would
        # reject a duplicate line; we surface that as a clean 400 from
        # the route rather than a 500. The check is over `barcode`
        # because the API takes barcodes, not product_ids.
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
    received_by_user_id: int
    reference: str | None
    notes: str | None
    received_at: datetime
    created_at: datetime
    lines: list[LotLinePublic]


class LotListResponse(BaseModel):
    lots: list[LotPublic]


# Re-export models.
__all__ = [
    "Lot",
    "LotCreate",
    "LotLine",
    "LotLineCreate",
    "LotLinePublic",
    "LotListResponse",
    "LotPublic",
]
