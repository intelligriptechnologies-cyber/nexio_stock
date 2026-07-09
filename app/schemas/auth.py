"""Auth + user schemas."""
from __future__ import annotations

import re
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.user import UserRole

_PHONE_RE = re.compile(r"^\+?[0-9]{7,15}$")


class SuperAdminLoginRequest(BaseModel):
    """Superadmin login shape — username + password, no shop (cross-shop)."""

    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=4, max_length=128)


class ShopLoginByPhone(BaseModel):
    """Shop login via phone (R-22) — the legacy path, still used by any
    client that hasn't migrated to the issue #24 picker flow."""

    model_config = ConfigDict(extra="forbid")

    phone: str = Field(min_length=7, max_length=20)
    password: str = Field(min_length=4, max_length=128)

    @field_validator("phone")
    @classmethod
    def _phone_format(cls, v: str) -> str:
        if not _PHONE_RE.match(v):
            raise ValueError("phone must be 7-15 digits, optional leading +")
        return v


class ShopLoginByStaffId(BaseModel):
    """Shop login via the picker flow (issue #24) — the ``id`` field
    returned by ``GET /auth/shop-staff``. The picker deliberately
    doesn't return phone (D-v2-16), so the PIN-pad stage authenticates
    with this instead."""

    model_config = ConfigDict(extra="forbid")

    staff_id: int = Field(ge=1)
    password: str = Field(min_length=4, max_length=128)


# Issue #36 — each shape's own required field makes "exactly one
# identifier" a type-level fact (and `extra="forbid"` means a body
# carrying fields from the other shape fails that shape's own
# validation) instead of two optional sibling fields juggled by hand
# in the route.
ShopLoginRequest = ShopLoginByPhone | ShopLoginByStaffId


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int  # seconds
    user: UserPublic


class UserPublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    shop_id: int | None
    role: UserRole
    username: str
    full_name: str
    phone: str
    is_active: bool
    created_at: datetime


class ShopStaffMember(BaseModel):
    """Public, pre-auth staff picker row (issue #24, D-v2-16).

    Returned by ``GET /auth/shop-staff`` so the login screen can render
    a tap-list of names before any credential is entered. Excludes
    phone + password_hash — staff-name secrecy is not the security
    boundary; PIN secrecy is (D-v2-16). Scoped to the one existing
    shop's active shop-scoped users; a multi-shop picker is explicitly
    out of scope until shop #2 is provisioned (D-v2-17).
    """

    id: int
    full_name: str
    role: UserRole


class StaffCreate(BaseModel):
    """Owner (or superadmin, D-64/D-65) creates a receiver_user or cashier_user (D-27, R-4)."""

    model_config = ConfigDict(extra="forbid")

    role: UserRole
    username: str = Field(min_length=3, max_length=64)
    full_name: str = Field(min_length=1, max_length=200)
    phone: str = Field(min_length=7, max_length=20)
    password: str = Field(min_length=4, max_length=128)
    # Superadmin-only (D-65): names the target shop. Owner must omit this.
    # Note: this is still not the shop-provisioning path (D-58) — the role
    # validator below still forbids creating an owner account here.
    shop_id: int | None = Field(default=None)

    @field_validator("role")
    @classmethod
    def _only_staff_roles(cls, v: UserRole) -> UserRole:
        # An owner cannot create another owner via this endpoint — owner
        # accounts are provisioned by superadmin. Nor a superadmin.
        if v not in (UserRole.RECEIVER_USER, UserRole.CASHIER_USER):
            raise ValueError("owner can only create receiver_user or cashier_user accounts")
        return v

    @field_validator("phone")
    @classmethod
    def _phone_format(cls, v: str) -> str:
        if not _PHONE_RE.match(v):
            raise ValueError("phone must be 7-15 digits, optional leading +")
        return v


class StaffPasswordReset(BaseModel):
    """Owner (or superadmin) resets a staff member's password/PIN (issue #17)."""

    model_config = ConfigDict(extra="forbid")

    password: str = Field(min_length=4, max_length=128)


class StaffUpdate(BaseModel):
    """Owner/superadmin updates mutable staff account state."""

    model_config = ConfigDict(extra="forbid")

    is_active: bool


class SuperAdminCreate(BaseModel):
    """Bootstrap superadmin (CLI-only, never exposed as a route)."""

    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=8, max_length=128)


TokenResponse.model_rebuild()
