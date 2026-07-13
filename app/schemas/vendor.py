"""Vendor schemas."""
from __future__ import annotations

import re
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

_GSTIN_RE = re.compile(r"^[0-9A-Z]{15}$")


class VendorBase(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=200)
    gstin: str | None = Field(default=None, max_length=15)
    address: str | None = Field(default=None, max_length=500)
    email: str | None = Field(default=None, max_length=255)
    phone: str | None = Field(default=None, max_length=20)

    @field_validator("name", "address", "email", "phone")
    @classmethod
    def _strip_text(cls, value: str | None) -> str | None:
        if value is None:
            return value
        stripped = value.strip()
        return stripped or None

    @field_validator("gstin")
    @classmethod
    def _gstin_shape(cls, value: str | None) -> str | None:
        if value is None:
            return value
        value = value.strip()
        if not _GSTIN_RE.match(value):
            raise ValueError("gstin must be 15 uppercase alphanumeric characters")
        return value


class VendorCreate(VendorBase):
    shop_id: int | None = Field(default=None)


class VendorUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=200)
    gstin: str | None = Field(default=None, max_length=15)
    address: str | None = Field(default=None, max_length=500)
    email: str | None = Field(default=None, max_length=255)
    phone: str | None = Field(default=None, max_length=20)
    is_active: bool | None = None
    shop_id: int | None = Field(default=None)

    @field_validator("name", "address", "email", "phone")
    @classmethod
    def _strip_text(cls, value: str | None) -> str | None:
        if value is None:
            return value
        stripped = value.strip()
        return stripped or None

    @field_validator("gstin")
    @classmethod
    def _gstin_shape(cls, value: str | None) -> str | None:
        if value is None:
            return value
        value = value.strip()
        if not _GSTIN_RE.match(value):
            raise ValueError("gstin must be 15 uppercase alphanumeric characters")
        return value


class VendorPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    shop_id: int
    name: str
    gstin: str | None
    address: str | None
    email: str | None
    phone: str | None
    is_active: bool
    created_at: datetime
    updated_at: datetime
