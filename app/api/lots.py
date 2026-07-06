"""Lot receiving (stock check-in, D-17, D-25, R-6, R-25).

Receivers (and owners — D-26) record a stock delivery as a Lot with one
or more line items. Each line carries a barcode + quantity; the server
resolves each barcode to a Product in the receiver's own shop.

Authorization:
  - owner / receiver_user may create and list lots
  - cashier_user is rejected with 403 (D-25)
  - superadmin is rejected (D-13: no day-to-day shop ops)

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

from app.api.deps import DbSession, require_role
from app.logging_config import get_logger
from app.models.log import StockinLog
from app.models.lot import Lot, LotLine
from app.models.product import Product
from app.models.user import User, UserRole
from app.schemas.lot import LotCreate, LotListResponse, LotPublic

router = APIRouter(prefix="/lots", tags=["lots"])
log = get_logger(__name__)

# Owner is a superset of receiver per D-26.
_lot_writer_roles = (UserRole.RECEIVER_USER, UserRole.OWNER)


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
    actor_shop_id = _user.shop_id

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
            )
        )

    # One stockin_logs row per lot, holding the brand/qty payload for the
    # receiving screen (R-25) and the audit trail.
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
    db.add(
        StockinLog(
            shop_id=actor_shop_id,
            actor_user_id=actor_id,
            event_type="lot.received",
            payload=log_payload,
        )
    )

    await db.commit()
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
    actor_shop_id = _user.shop_id
    lots = (
        await db.execute(
            select(Lot)
            .where(Lot.shop_id == actor_shop_id)
            .order_by(Lot.received_at.desc(), Lot.id.desc())
            .limit(limit)
            .offset(offset)
        )
    ).scalars().all()
    for lot in lots:
        await _load_lines(db, lot)
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
    actor_shop_id = _user.shop_id
    lot = (
        await db.execute(
            select(Lot).where(Lot.id == lot_id, Lot.shop_id == actor_shop_id)
        )
    ).scalar_one_or_none()
    if lot is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="lot not found")
    await _load_lines(db, lot)
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
