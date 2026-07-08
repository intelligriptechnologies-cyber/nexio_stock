"""Inventory page data — issue #43 (R-v3-7, R-v3-8, R-v3-16).

The Inventory page is read-accessible to all three shop-scoped roles
(owner, receiver, cashier) and to superadmin via the acting-shop
picker. Two sections on one page:
  - Current stock counts per product for the acting shop (reuses the
    catalog endpoint's ``current_stock`` field — same single source of
    truth shared with the dashboard low-stock list and checkout
    oversell check).
  - Lot-level receiving history (lot #, date, receiver, total
    quantity) for the acting shop.

This module owns the lot-history endpoint specifically: the existing
``GET /lots`` returns the full ``LotPublic`` (with lines) and is
gated to receiver/owner/superadmin only — not the shape nor the role
list the Inventory page needs. The dedicated endpoint keeps the
Inventory contract lean and reachable by cashiers too.
"""
from __future__ import annotations

from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    DbSession,
    require_role,
    resolve_write_shop_id,
)
from app.models.lot import Lot, LotLine
from app.models.user import User, UserRole
from app.schemas.lot import LotSummary, LotSummaryListResponse

# All four roles can read inventory (D-v3-13): owner, receiver,
# cashier, superadmin.
_inventory_reader_roles = (
    UserRole.OWNER,
    UserRole.RECEIVER_USER,
    UserRole.CASHIER_USER,
    UserRole.SUPERADMIN,
)

router = APIRouter(prefix="/inventory", tags=["inventory"])


@router.get(
    "/lots",
    response_model=LotSummaryListResponse,
    summary=(
        "Lot history (lot #, date, receiver, total quantity) for the "
        "acting shop — issue #43 (R-v3-8). Lean summary rows; use "
        "GET /lots/{lot_id} for the full lot with line items."
    ),
)
async def list_lot_history(
    db: DbSession,
    _user: User = Depends(require_role(*_inventory_reader_roles)),
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
    shop_id: Annotated[
        int | None,
        Query(description="Superadmin-only (D-65): target shop"),
    ] = None,
) -> LotSummaryListResponse:
    # resolve_write_shop_id (not the read variant) so a superadmin
    # without a picked shop gets a clean 400 from the existing guard,
    # matching every other dashboard-style read in the project.
    scoped_shop_id = await resolve_write_shop_id(db, _user, shop_id)

    # Total-quantity per lot: SUM(lot_lines.quantity) GROUP BY lot_id,
    # joined back to the lot row for the date and receiver. One
    # round-trip via a subquery.
    qty_subq = (
        select(
            LotLine.lot_id.label("lot_id"),
            func.coalesce(func.sum(LotLine.quantity), 0).label("total_quantity"),
        )
        .group_by(LotLine.lot_id)
        .subquery()
    )

    rows = (
        await db.execute(
            select(
                Lot.id,
                Lot.received_at,
                Lot.received_by_user_id,
                func.coalesce(qty_subq.c.total_quantity, 0).label("total_quantity"),
            )
            .where(Lot.shop_id == scoped_shop_id)
            .outerjoin(qty_subq, qty_subq.c.lot_id == Lot.id)
            .order_by(Lot.received_at.desc(), Lot.id.desc())
            .limit(limit)
            .offset(offset)
        )
    ).all()

    # Pre-fetch the receiver names in one query rather than N+1 on the
    # lookup of User.full_name per row.
    receiver_ids = {row.received_by_user_id for row in rows}
    receiver_names: dict[int, str] = {}
    if receiver_ids:
        from app.models.user import User as UserModel

        receivers = (
            await db.execute(
                select(UserModel.id, UserModel.full_name).where(
                    UserModel.id.in_(receiver_ids)
                )
            )
        ).all()
        receiver_names = {r.id: r.full_name for r in receivers}

    return LotSummaryListResponse(
        lots=[
            LotSummary(
                id=row.id,
                received_at=row.received_at,
                received_by_user_id=row.received_by_user_id,
                received_by_name=receiver_names.get(row.received_by_user_id, ""),
                total_quantity=int(row.total_quantity),
            )
            for row in rows
        ],
        evaluated_at=datetime.now(),
    )


__all__ = ["router", "status"]