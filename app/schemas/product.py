"""Product + CSV import schemas."""
from __future__ import annotations

import re
from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, field_validator

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
    completes it (sets a price, issue #25). The quick-add endpoint is
    open to receiver_user, cashier_user, owner, and shop-scoped
    superadmin writes (D-v2-10 plus acting-shop scope).

    The frontend sends an ``Idempotency-Key`` header so a double-tap on
    "Add" is a no-op, not a duplicate-error (D-v2-12). The DB-level
    unique constraint on ``barcode`` (D-52) is the ultimate backstop
    against a same-barcode race between two staff (D-v2-9).
    """

    model_config = ConfigDict(extra="forbid")

    barcode: str = Field(min_length=1, max_length=64)
    brand: str = Field(min_length=1, max_length=200)
    size_label: str = Field(min_length=1, max_length=64)
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
    """Partial update — owner edits price, brand, threshold, etc. without re-uploading.

    The price/status coupling (D-v2-5: active rows have price>0,
    pending rows have price=NULL) is enforced by
    ``app.services.product_lifecycle.apply_status_transition`` from
    the ``update_product`` handler. The schema no longer carries a
    no-op cross-field validator — the invariant lives in the
    lifecycle module (architecture review Candidate D, 2026-07-08).
    """

    model_config = ConfigDict(extra="forbid")

    brand: str | None = Field(default=None, min_length=1, max_length=200)
    size_label: str | None = Field(default=None, min_length=1, max_length=64)
    price: Decimal | None = Field(default=None, gt=Decimal("0"), max_digits=12, decimal_places=2)
    low_stock_threshold: int | None = Field(default=None, ge=0)
    is_active: bool | None = None


class ProductPublic(BaseModel):
    """One product row returned by the catalog endpoints.

    ``current_stock`` is the per-shop derived stock for this product —
    populated by the list/lookup endpoints via
    ``app.services.stock.compute_derived_stock`` (issue #40, R-v3-4).
    Same computation the dashboard's low-stock list and checkout's
    oversell check use, so the value never diverges from the dashboard
    column for the same product.
    """

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
    # Superadmin-only UI hint: true only when the row is inactive and
    # has no blocking lot/invoice history, so the frontend can surface
    # the hard-delete affordance without a per-row lookup.
    can_permanently_delete: bool = False
    created_at: datetime
    updated_at: datetime
    # Issue #40 — derived stock at the listing shop. Always set by the
    # list/lookup endpoints; default 0 here so the schema also validates
    # in tests that construct ProductPublic directly from a bare row.
    current_stock: int = 0


class ProductActionConfirmation(BaseModel):
    """Typed confirmation gate for destructive product actions."""

    model_config = ConfigDict(extra="forbid")

    confirmation_text: str = Field(min_length=1, max_length=32)


class ProductDeleteResponse(BaseModel):
    """Response returned after a permanent product delete."""

    id: int
    shop_id: int
    barcode: str
    action: str


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


class PendingProductRow(BaseModel):
    """One row of the Pending Products list (issue #25, D-v2-8).

    Returned by ``GET /products/pending`` so the owner can see every
    brand-new product quick-added by a receiver/cashier that's still
    awaiting a price. The list itself IS the notification surface —
    no separate dismiss/acknowledge action (D-v2-8).

    The ``last_event_origin`` and ``last_event_actor_*`` fields come
    from the most recent ``product.pending_created`` log entry
    (D-v2-13); they tell the owner whether the item was quick-added
    during receiving or checkout so they can follow up.
    """

    id: int
    barcode: str
    brand: str
    size_label: str
    created_at: datetime
    updated_at: datetime
    last_event_origin: str | None  # "receiving" | "checkout" | None
    last_event_actor_id: int | None
    last_event_actor_name: str | None


class ProductActivate(BaseModel):
    """Owner completes a pending product by setting its price (issue #25).

    This is the dedicated activation action (vs the generic PATCH
    /products/{id} path). Setting ``price`` flips status to 'active'
    (D-v2-5) — completing the product IS the resolution; there is no
    separate dismiss step (D-v2-8). ``low_stock_threshold`` is
    optional here too, mirroring ProductCreate.
    """

    model_config = ConfigDict(extra="forbid")

    price: Decimal = Field(gt=Decimal("0"), max_digits=12, decimal_places=2)
    low_stock_threshold: int | None = Field(default=None, ge=0)


# Helper — re-export the model for routers that need it.
__all__ = [
    "PendingProductRow",
    "Product",
    "ProductActivate",
    "ProductCreate",
    "ProductImportError",
    "ProductImportResponse",
    "ProductImportRow",
    "ProductActionConfirmation",
    "ProductDeleteResponse",
    "ProductPublic",
    "ProductQuickAdd",
    "ProductUpdate",
]
