"""Purchase-order API contracts."""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models.purchase_order import ExtractionStatus, PurchaseOrderStatus


class CasePackRulePublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    shop_id: int
    size_ml: int
    bottles_per_case: int


class CasePackRuleInput(BaseModel):
    size_ml: int = Field(gt=0, le=5000)
    bottles_per_case: int = Field(gt=0, le=1000)


class CasePackRulesUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    shop_id: int | None = None
    rules: list[CasePackRuleInput] = Field(min_length=1, max_length=100)

    @model_validator(mode="after")
    def unique_sizes(self):
        sizes = [rule.size_ml for rule in self.rules]
        if len(sizes) != len(set(sizes)):
            raise ValueError("case-pack sizes must be unique")
        return self


class PurchaseOrderLineUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: int | None = None
    source_item_name: str = Field(min_length=1, max_length=500)
    size_ml: int | None = Field(default=None, gt=0, le=5000)
    product_id: int | None = None
    cases: int = Field(ge=0, le=100_000)
    loose_bottles: int = Field(default=0, ge=0, le=100_000)
    case_rate: Decimal | None = Field(default=None, max_digits=14, decimal_places=2)
    mger: Decimal | None = Field(default=None, max_digits=14, decimal_places=2)
    amount: Decimal | None = Field(default=None, max_digits=14, decimal_places=2)
    sequence: int = Field(gt=0)


class PurchaseOrderDraftUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    osbcl_token: str | None = Field(default=None, max_length=100)
    order_date: date | None = None
    order_type: str | None = Field(default=None, max_length=50)
    retailer_name: str | None = Field(default=None, max_length=200)
    retailer_code: str | None = Field(default=None, max_length=100)
    vehicle_number: str | None = Field(default=None, max_length=50)
    total_cases: int | None = Field(default=None, ge=0)
    total_loose_bottles: int | None = Field(default=None, ge=0)
    mger_total: Decimal | None = None
    order_total: Decimal | None = None
    lines: list[PurchaseOrderLineUpdate] = Field(min_length=1, max_length=1000)


class PurchaseOrderCancel(BaseModel):
    reason: str = Field(min_length=3, max_length=1000)


class PurchaseOrderLinePublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    source_item_name: str
    size_ml: int | None
    product_id: int | None
    product_barcode: str | None
    product_brand: str | None
    product_size_label: str | None
    cases: int
    loose_bottles: int
    pack_size_snapshot: int | None
    ordered_bottles: int | None
    case_rate: Decimal | None
    mger: Decimal | None
    amount: Decimal | None
    sequence: int
    ocr_confidence: Decimal | None
    field_confidence: dict
    match_candidates: list
    delivered_bottles: int = 0
    accepted_bottles: int = 0
    broken_bottles: int = 0
    remaining_bottles: int = 0
    excess_bottles: int = 0


class PurchaseOrderPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    shop_id: int
    osbcl_token: str | None
    order_date: date | None
    order_type: str | None
    retailer_name: str | None
    retailer_code: str | None
    vehicle_number: str | None
    total_cases: int | None
    total_loose_bottles: int | None
    mger_total: Decimal | None
    order_total: Decimal | None
    source_filename: str
    source_sha256: str
    page_count: int
    extraction_status: ExtractionStatus
    extraction_confidence: Decimal | None
    review_flags: list
    status: PurchaseOrderStatus
    created_by_user_id: int
    confirmed_by_user_id: int | None
    cancelled_by_user_id: int | None
    confirmed_at: datetime | None
    cancelled_at: datetime | None
    cancellation_reason: str | None
    created_at: datetime
    updated_at: datetime
    lines: list[PurchaseOrderLinePublic]


class PurchaseOrderListResponse(BaseModel):
    purchase_orders: list[PurchaseOrderPublic]
