"""Shop configuration schemas (#8: GST / excise line)."""
from __future__ import annotations

import re
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field, field_validator

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

    @field_validator("gstin")
    @classmethod
    def _gstin_shape(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = v.strip()
        if not _GSTIN_RE.match(v):
            raise ValueError("gstin must be 15 alphanumeric characters (uppercase)")
        return v
