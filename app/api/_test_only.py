"""Test-only routes used to exercise role-based authorization gates.

Mounted only when `app_env == "test"` (see `app.main.create_app`).
Currently just the cashier-only placeholder — the receiver-only gate is
now exercised by the real POST /lots in #3, and `/staff` (owner-only)
covers the cross-role test we still need.

The cashier-only placeholder is removed when /checkout (#4) lands.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.deps import require_role
from app.models.user import User, UserRole

router = APIRouter(prefix="/__test__", tags=["__test__"])


@router.get("/cashier-only", summary="test: cashier-only gate (replaced by /checkout in #4)")
async def cashier_only(
    user: User = Depends(require_role(UserRole.CASHIER_USER, UserRole.OWNER)),
):
    return {"ok": True, "role": user.role.value}
