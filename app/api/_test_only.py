"""Test-only routes used to exercise role-based authorization gates.

Mounted only when `app_env == "test"` (see `app.main.create_app`). These
exist purely so the #1 acceptance criterion ("receiver_user calling a
cashier-only endpoint returns 403") can be verified end-to-end without
having to wait for #3's /lots or #4's /checkout to land.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.deps import require_role
from app.models.user import User, UserRole

router = APIRouter(prefix="/__test__", tags=["__test__"])


@router.get("/receiver-only", summary="test: receiver-only gate")
async def receiver_only(
    user: User = Depends(require_role(UserRole.RECEIVER_USER, UserRole.OWNER)),
):
    return {"ok": True, "role": user.role.value}


@router.get("/cashier-only", summary="test: cashier-only gate")
async def cashier_only(
    user: User = Depends(require_role(UserRole.CASHIER_USER, UserRole.OWNER)),
):
    return {"ok": True, "role": user.role.value}
