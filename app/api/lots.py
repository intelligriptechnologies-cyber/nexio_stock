"""Lot receiving (stock check-in, D-17, D-25, R-6, R-25).

Receivers (and owners — D-26) record a stock delivery as a Lot with one
or more line items. Each line carries a barcode + quantity; the server
resolves each barcode to a Product in the receiver's own shop.

Authorization:
  - owner / receiver_user may create and list lots (own shop)
  - cashier_user is rejected with 403 (D-25)
  - superadmin may create/list/get for any shop via an explicit
    shop_id on create, and unscoped reads otherwise (D-64/D-65)

Stock is NOT stored on the Product row — it's derived from the LotLine
quantities. After this endpoint succeeds, the affected products'
"current stock" view (computed at read time) goes up by the received
quantities.

Every successful create writes one `stockin_logs` row with the lot id
and line items (D-47 / R-37).
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api._logs import write_business_log
from app.api.deps import DbSession, require_role, resolve_write_shop_id
from app.db import unit_of_work
from app.logging_config import get_logger
from app.models.log import StockinLog
from app.models.lot import Lot, LotLine
from app.models.product import Product
from app.models.user import User, UserRole
from app.schemas.lot import LotCreate, LotListResponse, LotPublic
from app.services._line_snapshots import resolve_missing_snapshots

router = APIRouter(prefix="/lots", tags=["lots"])
log = get_logger(__name__)

# Owner is a superset of receiver per D-26; superadmin per D-64.
_lot_writer_roles = (UserRole.RECEIVER_USER, UserRole.OWNER, UserRole.SUPERADMIN)


@router.post(
    "",
    response_model=LotPublic,
    status_code=status.HTTP_201_CREATED,
    summary="Receiver records a stock delivery (one Lot, many line items)",
)
async def create_lot(
    payload: LotCreate,
    db: DbSession,
    _user: User = Depends(require_role(*_lot_writer_roles)),
) -> LotPublic:
    # Eagerly capture so the log line + later references don't trigger a
    # lazy load on a detached User (the auth dep's session has closed by
    # the time we'd otherwise read these).
    actor_id = _user.id
    actor_shop_id = await resolve_write_shop_id(db, _user, payload.shop_id)

    # Resolve every barcode to a product in the receiver's shop, in one
    # round-trip rather than N queries.
    barcodes = [line.barcode for line in payload.lines]
    products = (
        await db.execute(
            select(Product).where(
                Product.shop_id == actor_shop_id,
                Product.barcode.in_(barcodes),
                Product.is_active.is_(True),
            )
        )
    ).scalars().all()
    by_barcode = {p.barcode: p for p in products}

    missing = [b for b in barcodes if b not in by_barcode]
    if missing:
        # 404 (per AC: scanner fallback — unknown barcodes are flagged,
        # not silently added) with the unknown list for the UI.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"unknown or inactive barcodes in this shop: {missing}",
        )

    async with unit_of_work(db):
        lot = Lot(
            shop_id=actor_shop_id,
            received_by_user_id=actor_id,
            reference=payload.reference,
            notes=payload.notes,
        )
        db.add(lot)
        await db.flush()  # need lot.id for the line rows

        for line in payload.lines:
            product = by_barcode[line.barcode]
            db.add(
                LotLine(
                    lot_id=lot.id,
                    product_id=product.id,
                    quantity=line.quantity,
                    # Issue #38 — snapshot brand + size at receive time.
                    product_brand=product.brand,
                    product_size_label=product.size_label,
                )
            )

        # One stockin_logs row per lot, holding the brand/qty payload for
        # the receiving screen (R-25) and the audit trail.
        log_payload = {
            "lot_id": lot.id,
            "reference": payload.reference,
            "lines": [
                {
                    "barcode": line.barcode,
                    "product_id": by_barcode[line.barcode].id,
                    "brand": by_barcode[line.barcode].brand,
                    "size_label": by_barcode[line.barcode].size_label,
                    "quantity": line.quantity,
                }
                for line in payload.lines
            ],
        }
        write_business_log(
            db,
            StockinLog,
            event_type="lot.received",
            actor_id=actor_id,
            shop_id=actor_shop_id,
            payload=log_payload,
        )

    await db.refresh(lot)

    log.info(
        "lot.created",
        actor_user_id=actor_id,
        shop_id=actor_shop_id,
        lot_id=lot.id,
        line_count=len(payload.lines),
        total_units=sum(line.quantity for line in payload.lines),
        reference=payload.reference,
    )

    # Eager-load the lines for the response.
    await _load_lines(db, lot)
    # Issue #38: backfill snapshot for any pre-migration lot line.
    await resolve_missing_snapshots(db, list(lot.lines))
    return LotPublic.model_validate(lot)


@router.get(
    "",
    response_model=LotListResponse,
    summary="List recent lots for the current shop",
)
async def list_lots(
    db: DbSession,
    _user: User = Depends(require_role(*_lot_writer_roles)),
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> LotListResponse:
    stmt = select(Lot)
    if _user.role != UserRole.SUPERADMIN:
        stmt = stmt.where(Lot.shop_id == _user.shop_id)
    lots = (
        await db.execute(
            stmt.order_by(Lot.received_at.desc(), Lot.id.desc())
            .limit(limit)
            .offset(offset)
        )
    ).scalars().all()
    for lot in lots:
        await _load_lines(db, lot)
    # Issue #38: backfill snapshot for any pre-migration line across the
    # whole page. One query per page (resolves the union of distinct
    # missing product_ids); no-op if every line is already snapshot'd.
    await resolve_missing_snapshots(db, [ln for lot in lots for ln in lot.lines])
    return LotListResponse(lots=[LotPublic.model_validate(lot) for lot in lots])


@router.get(
    "/{lot_id}",
    response_model=LotPublic,
    summary="Get one lot with its line items",
)
async def get_lot(
    lot_id: int,
    db: DbSession,
    _user: User = Depends(require_role(*_lot_writer_roles)),
) -> LotPublic:
    stmt = select(Lot).where(Lot.id == lot_id)
    if _user.role != UserRole.SUPERADMIN:
        stmt = stmt.where(Lot.shop_id == _user.shop_id)
    lot = (await db.execute(stmt)).scalar_one_or_none()
    if lot is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="lot not found")
    await _load_lines(db, lot)
    # Issue #38: backfill snapshot for any pre-migration line.
    await resolve_missing_snapshots(db, list(lot.lines))
    return LotPublic.model_validate(lot)


async def _load_lines(db: AsyncSession, lot: Lot) -> None:
    """Eager-load the `lines` relationship on a Lot.

    The relationship's default lazy="select" strategy would issue a
    sync lazy load on first attribute access — which fails with
    MissingGreenlet under the async session. Doing it explicitly here
    (via selectinload) keeps the response shape predictable and avoids
    any cross-context IO.
    """
    await db.refresh(lot, attribute_names=["lines"])