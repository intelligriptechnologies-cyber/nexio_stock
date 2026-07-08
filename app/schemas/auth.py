"""Auth + user schemas."""
from __future__ import annotations

import re
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.user import UserRole

_PHONE_RE = re.compile(r"^\+?[0-9]{7,15}$")


class LoginRequest(BaseModel):
    # Login identifier — superadmin uses username; shop users use phone
    # (R-22) OR, in the post-#24 picker flow, ``staff_id`` (the
    # ``id`` field returned by ``GET /auth/shop-staff``). The login
    # route dispatches on whichever is provided; ``phone`` is the
    # legacy path retained for clients that haven't migrated yet.
    # The client just sends whichever credential the role expects.
    username: str | None = Field(default=None, min_length=1, max_length=64)
    phone: str | None = Field(default=None, min_length=7, max_length=20)
    # Issue #24 — picker-based login. Exactly one of {phone, staff_id}
    # is required for shop login; both omitted falls through to the
    # "missing identifier" branch in the route handler.
    staff_id: int | None = Field(default=None, ge=1)
    password: str = Field(min_length=4, max_length=128)

    @field_validator("phone")
    @classmethod
    def _phone_format(cls, v: str | None) -> str | None:
        if v is None:
            return v
        if not _PHONE_RE.match(v):
            raise ValueError("phone must be 7-15 digits, optional leading +")
        return v


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


class SuperAdminCreate(BaseModel):
    """Bootstrap superadmin (CLI-only, never exposed as a route)."""

    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=8, max_length=128)


TokenResponse.model_rebuild()
