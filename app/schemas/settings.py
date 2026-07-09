"""Per-shop application settings schemas."""
from __future__ import annotations

import re
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.schemas.shop import _GSTIN_RE

_HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
_HEX_COLOR_WITH_ALPHA_RE = re.compile(r"^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$")


class SettingsPublic(BaseModel):
    """Public view of a shop's settings. SMTP password is write-only."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    code: str
    app_display_name: str | None
    action_color: str
    active_tab_color: str
    sidebar_menu_inactive_text_color: str
    sidebar_menu_active_text_color: str
    email_enabled: bool
    smtp_host: str | None
    smtp_port: int | None
    smtp_username: str | None
    smtp_from_email: str | None
    smtp_from_name: str | None
    smtp_use_tls: bool
    gstin: str | None
    excise_duty_rate: Decimal | None
    low_stock_threshold_default: int | None


class SettingsUpdate(BaseModel):
    """Patchable per-shop settings. Only sent fields are persisted."""

    model_config = ConfigDict(extra="forbid")

    shop_id: int | None = Field(default=None)
    app_display_name: str | None = Field(default=None, min_length=1, max_length=80)
    action_color: str | None = Field(default=None)
    active_tab_color: str | None = Field(default=None)
    sidebar_menu_inactive_text_color: str | None = Field(default=None)
    sidebar_menu_active_text_color: str | None = Field(default=None)
    email_enabled: bool | None = None
    smtp_host: str | None = Field(default=None, max_length=255)
    smtp_port: int | None = Field(default=None, ge=1, le=65535)
    smtp_username: str | None = Field(default=None, max_length=255)
    smtp_password: str | None = Field(default=None, max_length=1024)
    smtp_from_email: EmailStr | None = None
    smtp_from_name: str | None = Field(default=None, max_length=255)
    smtp_use_tls: bool | None = None
    gstin: str | None = Field(default=None, max_length=15)
    excise_duty_rate: Decimal | None = Field(
        default=None,
        ge=Decimal("0"),
        le=Decimal("100"),
        max_digits=5,
        decimal_places=2,
    )
    low_stock_threshold_default: int | None = Field(default=None, ge=0)

    @field_validator("action_color", "active_tab_color")
    @classmethod
    def _action_color_shape(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = v.strip()
        if not _HEX_COLOR_RE.match(v):
            raise ValueError("color must be a hex color like #22c55e")
        return v.lower()

    @field_validator("sidebar_menu_inactive_text_color", "sidebar_menu_active_text_color")
    @classmethod
    def _menu_text_color_shape(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = v.strip()
        if not _HEX_COLOR_WITH_ALPHA_RE.match(v):
            raise ValueError("menu text colors must be hex colors like #535353cf or #ffffff")
        return v.lower()

    @field_validator("app_display_name", "smtp_host", "smtp_username", "smtp_from_name")
    @classmethod
    def _blank_string_to_none(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = v.strip()
        return v or None

    @field_validator("gstin")
    @classmethod
    def _gstin_shape(cls, v: str | None) -> str | None:
        if v is None:
            return v
        v = v.strip()
        if not _GSTIN_RE.match(v):
            raise ValueError("gstin must be 15 alphanumeric characters (uppercase)")
        return v
