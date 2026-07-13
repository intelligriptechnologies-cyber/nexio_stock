"""Username generation helpers for shop-scoped accounts."""
from __future__ import annotations

import re

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.shop import Shop
from app.models.user import User, UserRole

_NON_USERNAME_CHARS = re.compile(r"[^A-Z0-9]+")


def _normalize_prefix(value: str) -> str:
    normalized = _NON_USERNAME_CHARS.sub("-", value.upper()).strip("-")
    return normalized or "SHOP"


def default_username_for(shop_code: str, role: UserRole, sequence: int) -> str:
    role_label = {
        UserRole.OWNER: "OWNER",
        UserRole.RECEIVER_USER: "RECEIVER",
        UserRole.CASHIER_USER: "CASHIER",
        UserRole.SUPERADMIN: "ADMIN",
    }[role]
    return f"{_normalize_prefix(shop_code)}-{role_label}-{sequence:02d}"[:64]


async def next_default_username(
    db: AsyncSession, *, shop: Shop, role: UserRole
) -> str:
    prefix = f"{_normalize_prefix(shop.code)}-"
    stmt = select(func.count()).select_from(User).where(
        User.shop_id == shop.id,
        User.role == role,
        User.username.ilike(f"{prefix}%"),
    )
    existing = int((await db.execute(stmt)).scalar_one())
    return default_username_for(shop.code, role, existing + 1)
