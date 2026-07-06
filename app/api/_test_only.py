"""Test-only routes used to exercise role-based authorization gates.

Mounted only when `app_env == "test"` (see `app.main.create_app`).

Both role gates that were placeholders here are now exercised by real
endpoints:
  - receiver-only: POST /lots (in #3)
  - cashier-only:  POST /checkout/finalize (in #4)

Kept as an empty module so any leftover test references compile.
"""
from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(prefix="/__test__", tags=["__test__"])
