"""Shop configuration schemas (#8: GST / excise line)."""
from __future__ import annotations

import re
from datetime import datetime
from decimal import Decimal
from ipaddress import ip_network

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.user import UserRole

_GSTIN_RE = re.compile(r"^[0-9A-Z]{15}$")  # Indian GSTIN: 15 alphanumerics.


def _normalize_allowed_login_cidrs(values: list[str]) -> list[str]:
    normalized: list[str] = []
    seen: set[str] = set()
    for raw in values:
        value = raw.strip()
        if not value:
            raise ValueError("allowed_login_cidrs entries must not be blank")
        try:
            network = ip_network(value, strict=False)
        except ValueError as exc:
            raise ValueError(f"invalid CIDR/IP: {value}") from exc
        canonical = str(network)
        if canonical in seen:
            continue
        seen.add(canonical)
        normalized.append(canonical)
    return normalized


class ShopPublic(BaseModel):
    """Public view of the shop - exposed via /shops/me."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    code: str
    gstin: str | None
    excise_duty_rate: Decimal | None
    low_stock_threshold_default: int | None
    allowed_login_cidrs: list[str]


class ShopSummary(BaseModel):
    """Minimal shop identity - superadmin's shop picker (D-64/D-65)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    code: str


class ShopCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=200)
    code: str = Field(min_length=1, max_length=50)
    low_stock_threshold_default: int | None = Field(default=None, ge=0)
    allowed_login_cidrs: list[str] = Field(default_factory=list)

    @field_validator("allowed_login_cidrs")
    @classmethod
    def _create_allowed_login_cidrs(cls, values: list[str]) -> list[str]:
        return _normalize_allowed_login_cidrs(values)


class ShopMaintenanceUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=200)
    code: str | None = Field(default=None, min_length=1, max_length=50)
    low_stock_threshold_default: int | None = Field(default=None, ge=0)
    gstin: str | None = Field(default=None, max_length=15)
    excise_duty_rate: Decimal | None = Field(default=None, ge=Decimal("0"), le=Decimal("100"))
    allowed_login_cidrs: list[str] | None = Field(default=None)

    @field_validator("gstin")
    @classmethod
    def _maintenance_gstin_shape(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = v.strip()
        if not _GSTIN_RE.match(v):
            raise ValueError("gstin must be 15 alphanumeric characters (uppercase)")
        return v

    @field_validator("allowed_login_cidrs")
    @classmethod
    def _maintenance_allowed_login_cidrs(cls, values: list[str] | None) -> list[str] | None:
        if values is None:
            return None
        return _normalize_allowed_login_cidrs(values)


class ShopUserCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: UserRole
    username: str | None = Field(default=None, max_length=64)
    full_name: str = Field(min_length=1, max_length=200)
    phone: str = Field(min_length=7, max_length=20)
    password: str = Field(min_length=4, max_length=128)

    @field_validator("role")
    @classmethod
    def _shop_user_role(cls, v: UserRole) -> UserRole:
        if v not in (UserRole.OWNER, UserRole.RECEIVER_USER, UserRole.CASHIER_USER):
            raise ValueError("role must be owner, receiver_user, or cashier_user")
        return v

    @field_validator("username")
    @classmethod
    def _username_trim(cls, v: str | None) -> str | None:
        if v is None:
            return v
        value = v.strip()
        return value or None


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


class DeviceBindingBase(BaseModel):
    model_config = ConfigDict(extra="forbid")

    device_key: str = Field(min_length=8, max_length=64)
    counter_name: str | None = Field(default=None, max_length=80)
    is_active: bool = True

    @field_validator("device_key")
    @classmethod
    def _trim_device_key(cls, v: str) -> str:
        value = v.strip()
        if not value:
            raise ValueError("device_key must not be blank")
        return value


class DeviceBindingCreate(DeviceBindingBase):
    """Create or rebind a device for a shop."""


class DeviceBindingUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    counter_name: str | None = Field(default=None, max_length=80)
    is_active: bool | None = None


class DeviceBindingPublic(DeviceBindingBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    shop_id: int
    created_at: datetime
    updated_at: datetime


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
    allowed_login_cidrs: list[str] | None = Field(default=None)
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

    @field_validator("allowed_login_cidrs")
    @classmethod
    def _update_allowed_login_cidrs(cls, values: list[str] | None) -> list[str] | None:
        if values is None:
            return None
        return _normalize_allowed_login_cidrs(values)
