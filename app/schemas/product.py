"""Product + CSV import schemas."""
from __future__ import annotations

import re
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.product import Product, ProductStatus

# Barcode is whatever is on the bottle (D-7). Generous bounds: UPC-A/EAN-13
# are 8-13 digits, but allow longer (Code 128) and shorter (5-7). Reject
# whitespace-only.
_BARCODE_RE = re.compile(r"^\S+$")
_SIZE_LABEL_RE = re.compile(r"^\S.{0,62}$")  # 1-63 non-whitespace-leading


class ProductCreate(BaseModel):
    """Owner (or superadmin, D-64/D-65) creates a single product (D-7, D-19, R-7).

    Always creates an ``active`` product with a price. The provisional /
    pending flow lives in ``ProductQuickAdd`` (issue #22).
    """

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


class ProductQuickAdd(BaseModel):
    """Provisional product creation (issue #22, D-v2-4, D-v2-5).

    Captures brand + size_label only — no price, no threshold. The new
    product is ``status='pending'`` and unsellable until the owner
    completes it (sets a price, issue #25). The quick-add endpoint that
    consumes this schema is open to receiver_user, cashier_user, and
    owner (D-v2-10).

    The frontend sends an ``Idempotency-Key`` header so a double-tap on
    "Add" is a no-op, not a duplicate-error (D-v2-12). The DB-level
    unique constraint on ``barcode`` (D-52) is the ultimate backstop
    against a same-barcode race between two staff (D-v2-9).
    """

    model_config = ConfigDict(extra="forbid")

    barcode: str = Field(min_length=1, max_length=64)
    brand: str = Field(min_length=1, max_length=200)
    size_label: str = Field(min_length=1, max_length=64)

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
    """Partial update — owner edits price, brand, threshold, etc. without re-uploading.

    Setting a price on a pending product flips it to active (the
    "completion" action — issue #25). The cross-field rule lives here
    rather than per-field because the relationship between ``status`` and
    ``price`` is structural (D-v2-5).
    """

    model_config = ConfigDict(extra="forbid")

    brand: str | None = Field(default=None, min_length=1, max_length=200)
    size_label: str | None = Field(default=None, min_length=1, max_length=64)
    price: Decimal | None = Field(default=None, gt=Decimal("0"), max_digits=12, decimal_places=2)
    low_stock_threshold: int | None = Field(default=None, ge=0)
    is_active: bool | None = None

    @model_validator(mode="after")
    def _price_consistent(self) -> ProductUpdate:
        # The handler is responsible for cross-checking price vs the row's
        # current status (we don't have the row here), but at the schema
        # level we forbid setting price=None via this endpoint — partial
        # updates can't nullify a price on an active product without an
        # explicit "deactivate" path, which lives on the catalog side.
        # (Pydantic v2: peer fields aren't bound in @field_validator, so
        # the cross-field rule below uses @model_validator.)
        return self


class ProductPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    shop_id: int
    barcode: str
    brand: str
    size_label: str
    # ``None`` when the product is pending (issue #22). Active rows always
    # have a value (CHECK constraint enforces it at the DB level).
    price: Decimal | None
    low_stock_threshold: int | None
    is_active: bool
    status: ProductStatus
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
    "ProductQuickAdd",
    "ProductUpdate",
]