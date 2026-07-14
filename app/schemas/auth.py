"""Auth + user schemas."""
from __future__ import annotations

import re
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic import EmailStr, model_validator

from app.models.user import UserRole
from app.schemas.shop import _GSTIN_RE

_PHONE_RE = re.compile(r"^\+?[0-9]{7,15}$")
_PAN_RE = re.compile(r"^[A-Z]{5}[0-9]{4}[A-Z]$")


class SuperAdminLoginRequest(BaseModel):
    """Superadmin login shape — username + password, no shop (cross-shop)."""

    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=4, max_length=128)


class ShopLoginByUsername(BaseModel):
    """Shop login via username + role + password.

    ``device_key`` is retained for backward compatibility with older
    clients, but the backend no longer uses it to gate login.
    """

    model_config = ConfigDict(extra="forbid")

    role: UserRole
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=4, max_length=128)
    device_key: str = Field(min_length=8, max_length=64)

    @field_validator("role")
    @classmethod
    def _shop_role(cls, v: UserRole) -> UserRole:
        if v not in (UserRole.OWNER, UserRole.RECEIVER_USER, UserRole.CASHIER_USER):
            raise ValueError("role must be owner, receiver_user, or cashier_user")
        return v

    @field_validator("username", "device_key")
    @classmethod
    def _trim_login_identifiers(cls, v: str) -> str:
        value = v.strip()
        if not value:
            raise ValueError("value must not be blank")
        return value


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


# Shop login still accepts the legacy device_key field for compatibility.
ShopLoginRequest = ShopLoginByUsername


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
    email: EmailStr | None
    date_of_birth: date | None
    pan: str | None
    gstin: str | None
    is_active: bool
    created_at: datetime


class UserProfileUpdate(BaseModel):
    """Mutable profile fields for the current authenticated user."""

    model_config = ConfigDict(extra="forbid")

    email: EmailStr | None = None
    phone: str | None = Field(default=None, min_length=7, max_length=20)
    date_of_birth: date | None = None
    pan: str | None = Field(default=None, max_length=10)
    gstin: str | None = Field(default=None, max_length=15)

    @field_validator("phone")
    @classmethod
    def _phone_shape(cls, v: str | None) -> str | None:
        if v is None:
            return v
        value = v.strip()
        if not _PHONE_RE.match(value):
            raise ValueError("phone must be 7-15 digits, optional leading +")
        return value

    @field_validator("pan")
    @classmethod
    def _pan_shape(cls, v: str | None) -> str | None:
        if v is None:
            return v
        value = v.strip().upper()
        if not _PAN_RE.match(value):
            raise ValueError("pan must be 10 uppercase alphanumeric characters")
        return value

    @field_validator("gstin")
    @classmethod
    def _gstin_shape(cls, v: str | None) -> str | None:
        if v is None:
            return v
        value = v.strip().upper()
        if not _GSTIN_RE.match(value):
            raise ValueError("gstin must be 15 uppercase alphanumeric characters")
        return value


class UserPasswordUpdate(BaseModel):
    """Current-password verified password/PIN change request."""

    model_config = ConfigDict(extra="forbid")

    current_password: str = Field(min_length=4, max_length=128)
    new_password: str = Field(min_length=4, max_length=128)
    confirm_password: str = Field(min_length=4, max_length=128)

    @model_validator(mode="after")
    def _passwords_match(self) -> "UserPasswordUpdate":
        if self.new_password != self.confirm_password:
            raise ValueError("new password and confirm password must match")
        return self


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


class DeviceContext(BaseModel):
    """Legacy pre-auth device binding status payload.

    Kept for compatibility with older clients/tests; the login flow no
    longer consults it operationally.
    """

    device_key: str
    is_registered: bool
    can_login: bool
    shop_id: int | None
    shop_name: str | None
    shop_code: str | None
    counter_name: str | None
    message: str


class DeviceBindingBase(BaseModel):
    model_config = ConfigDict(extra="forbid")

    device_key: str = Field(min_length=8, max_length=64)
    counter_name: str | None = Field(default=None, max_length=80)
    is_active: bool = True


class DeviceBindingCreate(DeviceBindingBase):
    """Register or rebind a device to the selected shop."""


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


class StaffCreate(BaseModel):
    """Owner (or superadmin, D-64/D-65) creates a receiver_user or cashier_user (D-27, R-4)."""

    model_config = ConfigDict(extra="forbid")

    role: UserRole
    username: str | None = Field(default=None, max_length=64)
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

    @field_validator("username")
    @classmethod
    def _username_trim(cls, v: str | None) -> str | None:
        if v is None:
            return v
        value = v.strip()
        return value or None


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
