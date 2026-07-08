"""Owner dashboard — EOD totals, sign-off history, void queue, stock
overview (R-26, R-44, D-32, D-36, D-63).

Owner + superadmin only for the EOD actions and the cross-shop stock
overview; the read-only totals endpoints are also open to receiver
(so they can see "today is closed" on the receiving screen) and
cashier (so the checkout screen can show "today is closed, you can't
ring up more sales").
"""
from __future__ import annotations

from datetime import date as date_cls
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from app.api._errors import map_error_to_http
from app.api.deps import (
    DbSession,
    require_role,
    resolve_write_shop_id,
    today_local_date,  # issue #37: shared "today" helper
)
from app.db import unit_of_work
from app.logging_config import get_logger
from app.models.user import User, UserRole
from app.schemas.eod import (
    EodTotalsResponse,
    LowStockResponse,
    PaymentModeTotal,
    PendingVoidResponse,
    SignOffHistoryResponse,
    SignOffRequest,
    SignOffResponse,
    StockOverviewResponse,
    StockOverviewShopGroup,
    StockOverviewShopRow,
)
from app.services.eod import (
    EodError,
    get_day_totals,
    list_pending_voids,
    list_signoff_history,
    sign_off_day,
)
from app.services.stock_overview import build_stock_overview, now_utc

router = APIRouter(prefix="/dashboard", tags=["dashboard"])
log = get_logger(__name__)

_owner_only = (UserRole.OWNER, UserRole.SUPERADMIN)
_read_roles = (UserRole.OWNER, UserRole.RECEIVER_USER, UserRole.CASHIER_USER, UserRole.SUPERADMIN)


_EOD_CODE_TO_STATUS: dict[str, int] = {
    "already_signed_off": status.HTTP_409_CONFLICT,
    "future_date": status.HTTP_400_BAD_REQUEST,
}


@router.post(
    "/eod/sign-off",
    response_model=SignOffResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Owner marks a business date as closed (R-44, D-32, D-63)",
)
async def sign_off(
    payload: SignOffRequest,
    db: DbSession,
    _user: User = Depends(require_role(*_owner_only)),
) -> SignOffResponse:
    actor_id = _user.id
    actor_shop_id = await resolve_write_shop_id(db, _user, payload.shop_id)

    try:
        async with unit_of_work(db):
            result = await sign_off_day(
                db,
                shop_id=actor_shop_id,
                business_date=payload.business_date,
                signed_off_by_user_id=actor_id,
                notes=payload.notes,
            )
    except EodError as exc:
        raise map_error_to_http(
            exc,
            code_to_status=_EOD_CODE_TO_STATUS,
            log_event="eod.unmapped_error_code",
        ) from exc

    log.info(
        "eod.signed_off",
        actor_user_id=actor_id,
        shop_id=actor_shop_id,
        business_date=payload.business_date.isoformat(),
        invoices_signed_off=result.invoices_signed_off,
    )
    return SignOffResponse(
        business_date=result.sign_off.business_date,
        signed_off_at=result.sign_off.signed_off_at,
        signed_off_by_user_id=result.sign_off.signed_off_by_user_id,
        invoices_signed_off=result.invoices_signed_off,
    )


@router.get(
    "/eod-totals",
    response_model=EodTotalsResponse,
    summary="Aggregate revenue + payment-mode split for a business date",
)
async def eod_totals(
    db: DbSession,
    _user: User = Depends(require_role(*_read_roles)),
    business_date: Annotated[
        date_cls | None,
        Query(
            description=(
                "Calendar date in the shop's local timezone (IST for v1). "
                "Defaults to today (server-local) when omitted — issue #37."
            )
        ),
    ] = None,
    shop_id: Annotated[
        int | None, Query(description="Superadmin-only (D-65): target shop")
    ] = None,
) -> EodTotalsResponse:
    actor_shop_id = await resolve_write_shop_id(db, _user, shop_id)
    # issue #37: previously required (no default), but `Query(...)` (Ellipsis)
    # crashed FastAPI's validation-error serializer and surfaced as a 500.
    # Default to server-local "today" so a caller (like DashboardPage) that
    # forgets the param still gets a clean 200.
    effective_date = business_date if business_date is not None else today_local_date()
    totals = await get_day_totals(
        db, shop_id=actor_shop_id, business_date=effective_date
    )
    return EodTotalsResponse(
        business_date=totals.business_date,
        signed_off=totals.signed_off,
        invoice_count=totals.invoice_count,
        revenue=totals.revenue,
        voided_count=totals.voided_count,
        reversal_count=totals.reversal_count,
        payments_by_mode=[
            PaymentModeTotal(mode=mode, amount=amount)
            for mode, amount in sorted(totals.payments_by_mode.items())
        ],
    )


@router.get(
    "/eod-history",
    response_model=SignOffHistoryResponse,
    summary="List past EOD sign-offs (R-19: data retained indefinitely)",
)
async def eod_history(
    db: DbSession,
    _user: User = Depends(require_role(*_read_roles)),
    from_date: Annotated[date_cls | None, Query()] = None,
    to_date: Annotated[date_cls | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=365)] = 90,
    shop_id: Annotated[
        int | None, Query(description="Superadmin-only (D-65): target shop")
    ] = None,
) -> SignOffHistoryResponse:
    actor_shop_id = await resolve_write_shop_id(db, _user, shop_id)
    rows = await list_signoff_history(
        db,
        shop_id=actor_shop_id,
        from_date=from_date,
        to_date=to_date,
        limit=limit,
    )
    return SignOffHistoryResponse(
        signoffs=[
            SignOffResponse(
                business_date=row.business_date,
                signed_off_at=row.signed_off_at,
                signed_off_by_user_id=row.signed_off_by_user_id,
                invoices_signed_off=row.invoices_signed_off,
            )
            for row in rows
        ],
    )


@router.get(
    "/void-queue",
    response_model=PendingVoidResponse,
    summary="Invoices awaiting owner approval/rejection of a post-EOD void",
)
async def void_queue(
    db: DbSession,
    _user: User = Depends(require_role(*_read_roles)),
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    shop_id: Annotated[
        int | None, Query(description="Superadmin-only (D-65): target shop")
    ] = None,
) -> PendingVoidResponse:
    actor_shop_id = await resolve_write_shop_id(db, _user, shop_id)
    rows = await list_pending_voids(
        db, shop_id=actor_shop_id, limit=limit
    )
    # Eager-load the lines for the response shape.
    if rows:
        await db.refresh(rows[0], attribute_names=["lines"])
        # Refresh the rest individually. (Bulk selectinload is
        # cleaner, but the list is small.)
        for r in rows[1:]:
            await db.refresh(r, attribute_names=["lines"])

    from app.schemas.checkout import InvoicePublic

    invoices: list[InvoicePublic] = []
    for r in rows:
        await db.refresh(r, attribute_names=["payments"])
        invoices.append(InvoicePublic.model_validate(r))
    # Issue #38: backfill snapshot for any pre-migration line across
    # the void queue. One round-trip for the union of distinct product_ids.
    from app.services._line_snapshots import resolve_missing_snapshots

    await resolve_missing_snapshots(db, [ln for inv in invoices for ln in inv.lines])
    return PendingVoidResponse(invoices=invoices)


@router.get(
    "/low-stock",
    response_model=LowStockResponse,
    summary="Products at or below their effective threshold (D-34, R-15, #7)",
)
async def low_stock(
    db: DbSession,
    _user: User = Depends(require_role(*_read_roles)),
    shop_id: Annotated[
        int | None, Query(description="Superadmin-only (D-65): target shop")
    ] = None,
) -> LowStockResponse:
    """List products whose current derived stock is at or below their
    effective threshold (per-product override, falling back to the
    shop-wide default). Computed on demand; the in-process scheduler
    in `app.main.lifespan` also calls this on a timer for the
    background-job AC."""
    from datetime import UTC, datetime

    from app.schemas.eod import LowStockItem
    from app.services.low_stock import compute_low_stock

    actor_shop_id = await resolve_write_shop_id(db, _user, shop_id)
    rows = await compute_low_stock(db, shop_id=actor_shop_id)
    return LowStockResponse(
        items=[
            LowStockItem(
                product_id=row.product.id,
                barcode=row.product.barcode,
                brand=row.product.brand,
                size_label=row.product.size_label,
                current_stock=row.current_stock,
                effective_threshold=row.effective_threshold,
            )
            for row in rows
        ],
        evaluated_at=datetime.now(UTC),
    )


# --- Issue #41: cross-shop stock overview (R-v3-5, D-v3-5) ---


@router.get(
    "/stock-overview",
    response_model=StockOverviewResponse,
    summary=(
        "Aggregated stock per product, grouped by shop, across every "
        "shop the caller is authorized to see (issue #41, R-v3-5)"
    ),
)
async def stock_overview(
    db: DbSession,
    _user: User = Depends(require_role(*_owner_only)),
) -> StockOverviewResponse:
    """Owner/superadmin-only (same role check as the other dashboard
    reads, e.g. ``/low-stock``). Receiver/cashier are intentionally
    excluded — they get per-shop stock via the Inventory page (#43).

    Per D-v3-5: deliberately a NEW dedicated endpoint, not an
    ``all_shops`` flag bolted onto ``/dashboard/low-stock``. The
    cross-shop view is free to grow its own shape (grouped-by-shop
    fields, different pagination, different filter dimensions)
    without entangling it with the per-shop low-stock-threshold
    logic.
    """
    groups = await build_stock_overview(db, actor=_user)
    return StockOverviewResponse(
        shops=[
            StockOverviewShopGroup(
                shop_id=g.shop_id,
                shop_name=g.shop_name,
                items=[
                    StockOverviewShopRow(
                        product_id=row.product_id,
                        barcode=row.barcode,
                        brand=row.brand,
                        size_label=row.size_label,
                        current_stock=row.current_stock,
                        is_active=row.is_active,
                    )
                    for row in g.rows
                ],
            )
            for g in groups
        ],
        evaluated_at=now_utc(),
    )