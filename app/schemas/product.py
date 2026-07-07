"""Product + CSV import schemas."""
from __future__ import annotations

import re
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.product import Product

# Barcode is whatever is on the bottle (D-7). Generous bounds: UPC-A/EAN-13
# are 8-13 digits, but allow longer (Code 128) and shorter (5-7). Reject
# whitespace-only.
_BARCODE_RE = re.compile(r"^\S+$")
_SIZE_LABEL_RE = re.compile(r"^\S.{0,62}$")  # 1-63 non-whitespace-leading


class ProductCreate(BaseModel):
    """Owner (or superadmin, D-64/D-65) creates a single product (D-7, D-19, R-7)."""

    model_config = ConfigDict(extra="forbid")

    barcode: str = Field(min_length=1, max_length=64)
    brand: str = Field(min_length=1, max_length=200)
    size_label: str = Field(min_length=1, max_length=64)
    price: Decimal = Field(gt=Decimal("0"), max_digits=12, decimal_places=2)
    low_stock_threshold: int | None = Field(default=None, ge=0)
    # Superadmin-only (D-65): names the target shop, since superadmin has
    # no shop_id of its own. Owner/receiver/cashier must omit this — their
    # own shop_id is used implicitly.
    shop_id: int | None = Field(default=None)

    @field_validator("barcode")
    @classmethod
    def _barcode_no_ws(cls, v: str) -> str:
        if not _BARCODE_RE.match(v):
            raise ValueError("barcode cannot contain whitespace")
        return v

    @field_validator("size_label")
    @classmethod
    def _size_label_shape(cls, v: str) -> str:
        if not _SIZE_LABEL_RE.match(v):
            raise ValueError("size_label is required (1-64 chars)")
        return v


class ProductUpdate(BaseModel):
    """Partial update — owner edits price, brand, etc. without re-uploading."""

    model_config = ConfigDict(extra="forbid")

    brand: str | None = Field(default=None, min_length=1, max_length=200)
    size_label: str | None = Field(default=None, min_length=1, max_length=64)
    price: Decimal | None = Field(default=None, gt=Decimal("0"), max_digits=12, decimal_places=2)
    low_stock_threshold: int | None = Field(default=None, ge=0)
    is_active: bool | None = None


class ProductPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    shop_id: int
    barcode: str
    brand: str
    size_label: str
    price: Decimal
    low_stock_threshold: int | None
    is_active: bool
    created_at: datetime
    updated_at: datetime


# --- CSV import ---


class ProductImportRow(BaseModel):
    """One row of a bulk CSV import (R-42, D-61)."""

    row: int = Field(ge=1)  # 1-based row number for error reporting
    barcode: str = Field(min_length=1, max_length=64)
    brand: str = Field(min_length=1, max_length=200)
    size_label: str = Field(min_length=1, max_length=64)
    price: Decimal = Field(gt=Decimal("0"), max_digits=12, decimal_places=2)
    low_stock_threshold: int | None = Field(default=None, ge=0)

    @field_validator("barcode")
    @classmethod
    def _barcode_no_ws(cls, v: str) -> str:
        if not _BARCODE_RE.match(v):
            raise ValueError("barcode cannot contain whitespace")
        return v


class ProductImportError(BaseModel):
    row: int
    barcode: str | None
    error: str


class ProductImportResponse(BaseModel):
    created: int
    failed: int
    errors: list[ProductImportError]


# Helper — re-export the model for routers that need it.
__all__ = [
    "Product",
    "ProductCreate",
    "ProductImportError",
    "ProductImportResponse",
    "ProductImportRow",
    "ProductPublic",
    "ProductUpdate",
]
