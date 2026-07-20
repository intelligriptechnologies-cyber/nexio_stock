"""Shop configuration routes (#8: GST / excise line).

Owner reads and updates their own shop's config, implicitly via the
JWT. Superadmin reads/updates any shop by passing an explicit shop_id
(query param on GET, body field on PATCH) — D-64/D-65.

The GSTIN + excise_duty_rate fields drive the invoice PDF (D-23,
R-33). The duty rate is a configurable placeholder — the AC
explicitly says no CGST/SGST percentage is hardcoded. The PDF
surfaces it as a labelled "Excise / VAT (placeholder)" line, not as
a CGST/SGST breakdown.
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.dialects.postgresql.asyncpg import AsyncAdapt_asyncpg_dbapi
from sqlalchemy.exc import IntegrityError

from app.api._errors import is_unique_violation
from app.api.deps import DbSession, require_role, resolve_write_shop_id
from app.logging_config import get_logger
from app.models.device import DeviceBinding
from app.models.product import Product, ProductStatus
from app.models.shop import Shop
from app.models.user import User, UserRole
from app.schemas.auth import UserPublic
from app.schemas.shop import (
    DeviceBindingCreate,
    DeviceBindingPublic,
    DeviceBindingUpdate,
    ProductCopyRequest,
    ProductCopyResponse,
    ShopCreate,
    ShopMaintenanceUpdate,
    ShopPublic,
    ShopSummary,
    ShopUpdate,
    ShopUserCreate,
    ShopUserPasswordReset,
    ShopUserUpdate,
    SkippedProduct,
)
from app.security.passwords import hash_password
from app.services.usernames import next_default_username

router = APIRouter(prefix="/shops", tags=["shops"])
log = get_logger(__name__)

_read_roles = (UserRole.OWNER, UserRole.RECEIVER_USER, UserRole.CASHIER_USER, UserRole.SUPERADMIN)
_write_roles = (UserRole.OWNER, UserRole.SUPERADMIN)


@router.get(
    "",
    response_model=list[ShopSummary],
    summary="Superadmin lists every shop (id/name/code) — used to pick a shop_id",
)
async def list_shops(
    db: DbSession,
    _user: User = Depends(require_role(UserRole.SUPERADMIN)),
) -> list[ShopSummary]:
    rows = (await db.execute(select(Shop).order_by(Shop.name))).scalars().all()
    return [ShopSummary.model_validate(r) for r in rows]


@router.post(
    "",
    response_model=ShopPublic,
    status_code=status.HTTP_201_CREATED,
    summary="Superadmin creates a shop",
)
async def create_shop(
    payload: ShopCreate,
    db: DbSession,
    _user: User = Depends(require_role(UserRole.SUPERADMIN)),
) -> ShopPublic:
    shop = Shop(
        name=payload.name,
        code=payload.code,
        low_stock_threshold_default=payload.low_stock_threshold_default,
        cashier_login_restriction_enabled=payload.cashier_login_restriction_enabled,
        receiving_vendor_link_enabled=payload.receiving_vendor_link_enabled,
        allowed_login_cidrs=payload.allowed_login_cidrs,
    )
    db.add(shop)
    try:
        await db.commit()
    except (IntegrityError, AsyncAdapt_asyncpg_dbapi.IntegrityError) as exc:
        await db.rollback()
        if is_unique_violation(exc):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"shop code {payload.code!r} already exists",
            ) from exc
        raise
    await db.refresh(shop)
    return ShopPublic.model_validate(shop)


@router.patch(
    "/{shop_id:int}",
    response_model=ShopPublic,
    summary="Superadmin edits a shop's identity/details",
)
async def update_shop(
    shop_id: int,
    payload: ShopMaintenanceUpdate,
    db: DbSession,
    _user: User = Depends(require_role(UserRole.SUPERADMIN)),
) -> ShopPublic:
    shop = await db.get(Shop, shop_id)
    if shop is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="shop not found")
    data = payload.model_dump(exclude_unset=True)
    for field_name, value in data.items():
        setattr(shop, field_name, value)
    try:
        await db.commit()
    except (IntegrityError, AsyncAdapt_asyncpg_dbapi.IntegrityError) as exc:
        await db.rollback()
        if is_unique_violation(exc):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="shop code already exists",
            ) from exc
        raise
    await db.refresh(shop)
    return ShopPublic.model_validate(shop)


@router.get(
    "/{shop_id:int}/users",
    response_model=list[UserPublic],
    summary="Superadmin lists users for one shop",
)
async def list_shop_users(
    shop_id: int,
    db: DbSession,
    _user: User = Depends(require_role(UserRole.SUPERADMIN)),
) -> list[UserPublic]:
    shop = await db.get(Shop, shop_id)
    if shop is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="shop not found")
    rows = (
        await db.execute(
            select(User)
            .where(User.shop_id == shop_id)
            .order_by(User.role, User.full_name, User.id)
        )
    ).scalars().all()
    return [UserPublic.model_validate(r) for r in rows]


@router.post(
    "/{shop_id:int}/users",
    response_model=UserPublic,
    status_code=status.HTTP_201_CREATED,
    summary="Superadmin creates an owner/cashier/receiver user for a shop",
)
async def create_shop_user(
    shop_id: int,
    payload: ShopUserCreate,
    db: DbSession,
    _user: User = Depends(require_role(UserRole.SUPERADMIN)),
) -> UserPublic:
    shop = await db.get(Shop, shop_id)
    if shop is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="shop not found")
    username = payload.username or await next_default_username(db, shop=shop, role=payload.role)
    user = User(
        shop_id=shop_id,
        role=payload.role,
        username=username,
        full_name=payload.full_name,
        phone=payload.phone,
        password_hash=hash_password(payload.password),
        is_active=True,
    )
    db.add(user)
    try:
        await db.commit()
    except (IntegrityError, AsyncAdapt_asyncpg_dbapi.IntegrityError) as exc:
        await db.rollback()
        if is_unique_violation(exc):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="username already exists or phone is already registered",
            ) from exc
        raise
    await db.refresh(user)
    return UserPublic.model_validate(user)


async def _get_bounded_shop_user(db: DbSession, *, shop_id: int, user_id: int) -> User:
    target = (
        await db.execute(
            select(User).where(
                User.id == user_id,
                User.shop_id == shop_id,
                User.role != UserRole.SUPERADMIN,
            )
        )
    ).scalar_one_or_none()
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="shop user not found")
    return target


@router.patch(
    "/{shop_id:int}/users/{user_id:int}",
    response_model=UserPublic,
    summary="Superadmin activates/deactivates a shop user",
)
async def update_shop_user(
    shop_id: int,
    user_id: int,
    payload: ShopUserUpdate,
    db: DbSession,
    _user: User = Depends(require_role(UserRole.SUPERADMIN)),
) -> UserPublic:
    target = await _get_bounded_shop_user(db, shop_id=shop_id, user_id=user_id)
    target.is_active = payload.is_active
    await db.commit()
    await db.refresh(target)
    return UserPublic.model_validate(target)


@router.patch(
    "/{shop_id:int}/users/{user_id:int}/password",
    response_model=UserPublic,
    summary="Superadmin resets a shop user's PIN/password",
)
async def reset_shop_user_password(
    shop_id: int,
    user_id: int,
    payload: ShopUserPasswordReset,
    db: DbSession,
    _user: User = Depends(require_role(UserRole.SUPERADMIN)),
) -> UserPublic:
    target = await _get_bounded_shop_user(db, shop_id=shop_id, user_id=user_id)
    target.password_hash = hash_password(payload.password)
    await db.commit()
    await db.refresh(target)
    return UserPublic.model_validate(target)


@router.post(
    "/{target_shop_id:int}/products/copy-from-shop",
    response_model=ProductCopyResponse,
    summary="Superadmin copies active product rows from another shop",
)
async def copy_products_from_shop(
    target_shop_id: int,
    payload: ProductCopyRequest,
    db: DbSession,
    _user: User = Depends(require_role(UserRole.SUPERADMIN)),
) -> ProductCopyResponse:
    if payload.source_shop_id == target_shop_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="source and target shops must be different",
        )
    source = await db.get(Shop, payload.source_shop_id)
    target = await db.get(Shop, target_shop_id)
    if source is None or target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="source or target shop not found")

    source_products = (
        await db.execute(
            select(Product).where(
                Product.shop_id == payload.source_shop_id,
                Product.is_active.is_(True),
                Product.status == ProductStatus.ACTIVE,
            )
        )
    ).scalars().all()
    target_product_ids = set(
        (
            await db.execute(
                select(Product.master_product_id).where(Product.shop_id == target_shop_id)
            )
        ).scalars().all()
    )

    copied = 0
    skipped_products: list[SkippedProduct] = []
    for product in source_products:
        if product.master_product_id in target_product_ids:
            skipped_products.append(
                SkippedProduct(barcode=product.barcode, reason="already exists in target shop")
            )
            continue
        db.add(
            Product(
                shop_id=target_shop_id,
                master_product_id=product.master_product_id,
                price=product.price,
                low_stock_threshold=product.low_stock_threshold,
                is_active=True,
                status=product.status,
            )
        )
        target_product_ids.add(product.master_product_id)
        copied += 1

    await db.commit()
    return ProductCopyResponse(
        copied=copied,
        skipped=len(skipped_products),
        skipped_products=skipped_products,
    )


@router.get(
    "/me/devices",
    response_model=list[DeviceBindingPublic],
    summary="List the device bindings for the selected shop",
)
async def list_shop_devices(
    db: DbSession,
    user: User = Depends(require_role(UserRole.OWNER, UserRole.SUPERADMIN)),
    shop_id: Annotated[
        int | None,
        Query(description="Superadmin-only: selected shop to list devices for"),
    ] = None,
) -> list[DeviceBindingPublic]:
    actor_shop_id = await resolve_write_shop_id(db, user, shop_id)
    rows = (
        await db.execute(
            select(DeviceBinding)
            .where(DeviceBinding.shop_id == actor_shop_id)
            .order_by(DeviceBinding.id.asc())
        )
    ).scalars().all()
    return [DeviceBindingPublic.model_validate(row) for row in rows]


@router.post(
    "/me/devices",
    response_model=DeviceBindingPublic,
    summary="Register or rebind a device to the selected shop",
)
async def upsert_shop_device(
    payload: DeviceBindingCreate,
    db: DbSession,
    user: User = Depends(require_role(UserRole.OWNER, UserRole.SUPERADMIN)),
    shop_id: Annotated[
        int | None,
        Query(description="Superadmin-only: selected shop to bind this device to"),
    ] = None,
) -> DeviceBindingPublic:
    actor_shop_id = await resolve_write_shop_id(db, user, shop_id)
    binding = (
        await db.execute(
            select(DeviceBinding).where(DeviceBinding.device_key == payload.device_key)
        )
    ).scalar_one_or_none()
    if binding is None:
        binding = DeviceBinding(
            device_key=payload.device_key,
            shop_id=actor_shop_id,
            counter_name=payload.counter_name,
            is_active=payload.is_active,
            registered_by_user_id=user.id,
        )
        db.add(binding)
    else:
        binding.shop_id = actor_shop_id
        binding.counter_name = payload.counter_name
        binding.is_active = payload.is_active
        binding.registered_by_user_id = user.id
    await db.commit()
    await db.refresh(binding)
    return DeviceBindingPublic.model_validate(binding)


@router.patch(
    "/me/devices/{device_id:int}",
    response_model=DeviceBindingPublic,
    summary="Update a device binding for the selected shop",
)
async def update_shop_device(
    device_id: int,
    payload: DeviceBindingUpdate,
    db: DbSession,
    user: User = Depends(require_role(UserRole.OWNER, UserRole.SUPERADMIN)),
    shop_id: Annotated[
        int | None,
        Query(description="Superadmin-only: selected shop to update devices for"),
    ] = None,
) -> DeviceBindingPublic:
    actor_shop_id = await resolve_write_shop_id(db, user, shop_id)
    binding = (
        await db.execute(
            select(DeviceBinding).where(
                DeviceBinding.id == device_id,
                DeviceBinding.shop_id == actor_shop_id,
            )
        )
    ).scalar_one_or_none()
    if binding is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="device not found")
    data = payload.model_dump(exclude_unset=True)
    for field_name, value in data.items():
        setattr(binding, field_name, value)
    await db.commit()
    await db.refresh(binding)
    return DeviceBindingPublic.model_validate(binding)


@router.get(
    "/me",
    response_model=ShopPublic,
    summary="Get the current shop's config (gstin, duty rate, default low-stock threshold)",
)
async def get_my_shop(
    db: DbSession,
    _user: User = Depends(require_role(*_read_roles)),
    shop_id: Annotated[
        int | None, Query(description="Superadmin-only (D-65): target shop")
    ] = None,
) -> ShopPublic:
    actor_shop_id = await resolve_write_shop_id(db, _user, shop_id)
    shop = (
        await db.execute(select(Shop).where(Shop.id == actor_shop_id))
    ).scalar_one_or_none()
    if shop is None:
        # Defensive — every shop-scoped user has a shop, but the
        # contract has to handle the (impossible) null case.
        return ShopPublic(  # type: ignore[call-arg]
            id=actor_shop_id or 0,
            name="(unknown)",
            code="(unknown)",
            gstin=None,
            excise_duty_rate=None,
            low_stock_threshold_default=None,
            cashier_login_restriction_enabled=False,
            receiving_vendor_link_enabled=True,
            allowed_login_cidrs=[],
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
    actor_shop_id = await resolve_write_shop_id(db, _user, payload.shop_id)

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

    data = payload.model_dump(exclude_unset=True, exclude={"shop_id"})
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
