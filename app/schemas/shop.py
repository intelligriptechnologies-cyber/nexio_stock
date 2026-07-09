"""Shop configuration schemas (#8: GST / excise line)."""
from __future__ import annotations

import re
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.user import UserRole

_GSTIN_RE = re.compile(r"^[0-9A-Z]{15}$")  # Indian GSTIN: 15 alphanumerics.


class ShopPublic(BaseModel):
    """Public view of the shop — exposed via /shops/me."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    code: str
    gstin: str | None
    excise_duty_rate: Decimal | None
    low_stock_threshold_default: int | None


class ShopSummary(BaseModel):
    """Minimal shop identity — superadmin's shop picker (D-64/D-65)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    code: str


class ShopCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=200)
    code: str = Field(min_length=1, max_length=50)
    low_stock_threshold_default: int | None = Field(default=None, ge=0)


class ShopMaintenanceUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=200)
    code: str | None = Field(default=None, min_length=1, max_length=50)
    low_stock_threshold_default: int | None = Field(default=None, ge=0)
    gstin: str | None = Field(default=None, max_length=15)
    excise_duty_rate: Decimal | None = Field(default=None, ge=Decimal("0"), le=Decimal("100"))

    @field_validator("gstin")
    @classmethod
    def _maintenance_gstin_shape(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = v.strip()
        if not _GSTIN_RE.match(v):
            raise ValueError("gstin must be 15 alphanumeric characters (uppercase)")
        return v


class ShopUserCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: UserRole
    username: str = Field(min_length=3, max_length=64)
    full_name: str = Field(min_length=1, max_length=200)
    phone: str = Field(min_length=7, max_length=20)
    password: str = Field(min_length=4, max_length=128)

    @field_validator("role")
    @classmethod
    def _shop_user_role(cls, v: UserRole) -> UserRole:
        if v not in (UserRole.OWNER, UserRole.RECEIVER_USER, UserRole.CASHIER_USER):
            raise ValueError("role must be owner, receiver_user, or cashier_user")
        return v


class ShopUserUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    is_active: bool


class ShopUserPasswordReset(BaseModel):
    model_config = ConfigDict(extra="forbid")

    password: str = Field(min_length=4, max_length=128)


class ProductCopyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_shop_id: int = Field(ge=1)


class SkippedProduct(BaseModel):
    barcode: str
    reason: str


class ProductCopyResponse(BaseModel):
    copied: int
    skipped: int
    skipped_products: list[SkippedProduct]


class ShopUpdate(BaseModel):
    """Owner updates shop-level config. All fields optional; only the
    ones the client sends are written."""

    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=200)
    gstin: str | None = Field(default=None, max_length=15)
    excise_duty_rate: Decimal | None = Field(
        default=None,
        ge=Decimal("0"),
        le=Decimal("100"),
        max_digits=5,
        decimal_places=2,
        description=(
            "Configurable placeholder. Do NOT hardcode a value; the "
            "exact rate must be confirmed against Odisha State Excise "
            "Department rules before being relied on for filings."
        ),
    )
    low_stock_threshold_default: int | None = Field(default=None, ge=0)
    # Superadmin-only (D-65): names the target shop. Owner must omit this.
    shop_id: int | None = Field(default=None)

    @field_validator("gstin")
    @classmethod
    def _gstin_shape(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = v.strip()
        if not _GSTIN_RE.match(v):
            raise ValueError("gstin must be 15 alphanumeric characters (uppercase)")
        return v
