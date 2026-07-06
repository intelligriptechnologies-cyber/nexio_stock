"""Shop configuration routes (#8: GST / excise line).

Owner reads and updates their shop's config. Superadmin can read
any shop (for support) but for v1 we keep it simple: each request is
shop-scoped via the JWT.

The GSTIN + excise_duty_rate fields drive the invoice PDF (D-23,
R-33). The duty rate is a configurable placeholder — the AC
explicitly says no CGST/SGST percentage is hardcoded. The PDF
surfaces it as a labelled "Excise / VAT (placeholder)" line, not as
a CGST/SGST breakdown.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select

from app.api.deps import DbSession, require_role
from app.logging_config import get_logger
from app.models.shop import Shop
from app.models.user import User, UserRole
from app.schemas.shop import ShopPublic, ShopUpdate

router = APIRouter(prefix="/shops", tags=["shops"])
log = get_logger(__name__)

_read_roles = (UserRole.OWNER, UserRole.RECEIVER_USER, UserRole.CASHIER_USER, UserRole.SUPERADMIN)
_write_roles = (UserRole.OWNER, UserRole.SUPERADMIN)


@router.get(
    "/me",
    response_model=ShopPublic,
    summary="Get the current shop's config (gstin, duty rate, default low-stock threshold)",
)
async def get_my_shop(
    db: DbSession,
    _user: User = Depends(require_role(*_read_roles)),
) -> ShopPublic:
    shop = (
        await db.execute(select(Shop).where(Shop.id == _user.shop_id))
    ).scalar_one_or_none()
    if shop is None:
        # Defensive — every shop-scoped user has a shop, but the
        # contract has to handle the (impossible) null case.
        return ShopPublic(  # type: ignore[call-arg]
            id=_user.shop_id or 0,
            name="(unknown)",
            code="(unknown)",
            gstin=None,
            excise_duty_rate=None,
            low_stock_threshold_default=None,
        )
    return ShopPublic.model_validate(shop)


@router.patch(
    "/me",
    response_model=ShopPublic,
    summary="Owner updates shop-level config (gstin, duty rate, low-stock default)",
)
async def update_my_shop(
    payload: ShopUpdate,
    db: DbSession,
    _user: User = Depends(require_role(*_write_roles)),
) -> ShopPublic:
    actor_id = _user.id
    actor_shop_id = _user.shop_id

    shop = (
        await db.execute(select(Shop).where(Shop.id == actor_shop_id))
    ).scalar_one_or_none()
    if shop is None:
        return ShopPublic(  # type: ignore[call-arg]
            id=actor_shop_id or 0,
            name="(unknown)",
            code="(unknown)",
            gstin=None,
            excise_duty_rate=None,
            low_stock_threshold_default=None,
        )

    data = payload.model_dump(exclude_unset=True)
    for field_name, value in data.items():
        setattr(shop, field_name, value)
    await db.commit()
    await db.refresh(shop)

    log.info(
        "shop.updated",
        actor_user_id=actor_id,
        shop_id=actor_shop_id,
        changed_fields=sorted(data.keys()),
    )
    return ShopPublic.model_validate(shop)
