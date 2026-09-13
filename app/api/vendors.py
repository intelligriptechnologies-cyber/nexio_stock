"""Vendor CRUD and selection routes."""
from __future__ import annotations

import csv
import io
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.dialects.postgresql.asyncpg import AsyncAdapt_asyncpg_dbapi
from sqlalchemy.exc import IntegrityError

from app.api._errors import is_unique_violation
from app.api.deps import DbSession, require_role, resolve_write_shop_id
from app.models.user import User, UserRole
from app.models.vendor import Vendor
from app.schemas.vendor import VendorCreate, VendorPublic, VendorUpdate

router = APIRouter(prefix="/vendors", tags=["vendors"])

_read_roles = (UserRole.RECEIVER_USER, UserRole.OWNER, UserRole.SUPERADMIN)
_write_roles = (UserRole.OWNER, UserRole.SUPERADMIN)


@router.get("", response_model=list[VendorPublic], summary="List vendors for the acting shop")
async def list_vendors(
    db: DbSession,
    response: Response,
    user: User = Depends(require_role(*_read_roles)),
    shop_id: Annotated[int | None, Query(description="Superadmin-only target shop")] = None,
    include_inactive: bool = False,
    q: Annotated[str | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 25,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[VendorPublic]:
    actor_shop_id = await resolve_write_shop_id(db, user, shop_id)
    stmt = select(Vendor).where(Vendor.shop_id == actor_shop_id)
    if not include_inactive or user.role == UserRole.RECEIVER_USER:
        stmt = stmt.where(Vendor.is_active.is_(True))
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(Vendor.name.ilike(like), Vendor.gstin.ilike(like), Vendor.phone.ilike(like)))
    count_stmt = select(func.count()).select_from(stmt.order_by(None).subquery())
    response.headers["X-Total-Count"] = str((await db.execute(count_stmt)).scalar_one())
    rows = (
        await db.execute(
            stmt.order_by(Vendor.is_active.desc(), Vendor.name, Vendor.id).limit(limit).offset(offset)
        )
    ).scalars().all()
    return [VendorPublic.model_validate(row) for row in rows]


@router.get("/export", summary="Export every filtered vendor as CSV")
async def export_vendors(
    db: DbSession,
    user: User = Depends(require_role(*_read_roles)),
    shop_id: int | None = None,
    include_inactive: bool = False,
    q: str | None = None,
) -> Response:
    actor_shop_id = await resolve_write_shop_id(db, user, shop_id)
    stmt = select(Vendor).where(Vendor.shop_id == actor_shop_id)
    if not include_inactive or user.role == UserRole.RECEIVER_USER:
        stmt = stmt.where(Vendor.is_active.is_(True))
    if q:
        like = f"%{q}%"
        stmt = stmt.where(or_(Vendor.name.ilike(like), Vendor.gstin.ilike(like), Vendor.phone.ilike(like)))
    rows = (await db.execute(stmt.order_by(Vendor.is_active.desc(), Vendor.name, Vendor.id))).scalars().all()
    out = io.StringIO()
    fields = ["id", "shop_id", "name", "gstin", "address", "email", "phone", "is_active", "created_at", "updated_at"]
    writer = csv.DictWriter(out, fieldnames=fields)
    writer.writeheader()
    for row in rows:
        writer.writerow({field: getattr(row, field) for field in fields})
    return Response(content=out.getvalue(), media_type="text/csv", headers={"Content-Disposition": 'attachment; filename="vendors.csv"'})


@router.post(
    "",
    response_model=VendorPublic,
    status_code=status.HTTP_201_CREATED,
    summary="Owner or superadmin creates a vendor",
)
async def create_vendor(
    payload: VendorCreate,
    db: DbSession,
    user: User = Depends(require_role(*_write_roles)),
) -> VendorPublic:
    actor_shop_id = await resolve_write_shop_id(db, user, payload.shop_id)
    vendor = Vendor(
        shop_id=actor_shop_id,
        name=payload.name,
        gstin=payload.gstin,
        address=payload.address,
        email=payload.email,
        phone=payload.phone,
        is_active=True,
    )
    db.add(vendor)
    try:
        await db.commit()
    except (IntegrityError, AsyncAdapt_asyncpg_dbapi.IntegrityError) as exc:
        await db.rollback()
        if is_unique_violation(exc):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="vendor already exists"
            ) from exc
        raise
    await db.refresh(vendor)
    return VendorPublic.model_validate(vendor)


@router.patch(
    "/{vendor_id:int}",
    response_model=VendorPublic,
    summary="Owner or superadmin updates a vendor",
)
async def update_vendor(
    vendor_id: int,
    payload: VendorUpdate,
    db: DbSession,
    user: User = Depends(require_role(*_write_roles)),
) -> VendorPublic:
    actor_shop_id = await resolve_write_shop_id(db, user, payload.shop_id)
    vendor = (
        await db.execute(
            select(Vendor).where(Vendor.id == vendor_id, Vendor.shop_id == actor_shop_id)
        )
    ).scalar_one_or_none()
    if vendor is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="vendor not found")

    data = payload.model_dump(exclude_unset=True, exclude={"shop_id"})
    for field_name, value in data.items():
        setattr(vendor, field_name, value)
    try:
        await db.commit()
    except (IntegrityError, AsyncAdapt_asyncpg_dbapi.IntegrityError) as exc:
        await db.rollback()
        if is_unique_violation(exc):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail="vendor already exists"
            ) from exc
        raise
    await db.refresh(vendor)
    return VendorPublic.model_validate(vendor)
