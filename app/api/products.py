"""Product catalog + bulk CSV import (D-7, D-19, D-52, D-61, R-7, R-10, R-27, R-42).

Write endpoints are owner (own shop) or superadmin (any shop, via an
explicit shop_id — D-64/D-65). The /lookup endpoint is the scanner's
product-fetch path used by the cashier in #4 and the receiver in #3 — it's
read-only and accepts a barcode (scanned or manually typed per the
fallback in R-10/R-27) and returns the product record. It's exposed
through this router rather than one in #3/#4 so a single place owns the
contract.

Quick-add (issue #22, D-v2-5/D-v2-9/D-v2-12) creates a ``pending`` product
on the spot from brand + size only. It's open to receiver, cashier, and
owner (D-v2-10). The endpoint accepts an optional ``X-Quick-Add-Origin``
header (``receiving`` | ``checkout``) so the event can be logged to the
right domain log table (D-v2-13); default is ``receiving`` because that's
the only caller in #22, and ``checkout`` is added in #26.

Issue #30: route handlers here own request parsing and error-to-HTTP
translation only — the CRUD/quick-add/pending-list/activation/CSV-import
logic lives in ``app.services.products``.
"""
from __future__ import annotations

from typing import Annotated, Literal

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Query, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api._logs import write_business_log
from app.api.deps import (
    DbSession,
    require_no_offline_session_lock,
    require_role,
    resolve_read_shop_id,
    resolve_write_shop_id,
)
from app.logging_config import get_logger
from app.models.log import AdminLog
from app.models.product import Product, ProductStatus
from app.models.user import User, UserRole
from app.schemas.product import (
    ProductActionConfirmation,
    ProductDeleteResponse,
    PendingProductRow,
    ProductActivate,
    ProductCreate,
    ProductImportError,
    ProductImportResponse,
    ProductPublic,
    ProductQuickAdd,
    ProductUpdate,
)

# Imported qualified (not `from ... import list_products, ...`): those
# names collide with this router's own handler function names, and
# FastAPI derives each route's OpenAPI operationId from the handler's
# `__name__` — a committed openapi.json and a generated frontend client
# key off those ids, so the handlers keep their original names.
from app.services import products as products_svc
from app.services.product_creation import (
    ProductConflictError,
    create_product_row,
    product_conflict_to_http,
)
from app.services.product_lifecycle import ProductLifecycleError
from app.services.products import (
    ProductError,
    QuickAddConflictError,
    archive_product,
    activate_pending_product,
    count_pending_products,
    get_product_for_write,
    lookup_product_by_barcode,
    permanent_delete_blockers,
    permanent_delete_eligible_ids,
    quick_add_log_entry,
    reject_pending_product,
    restore_product,
    update_product_fields,
)
from app.services.stock import compute_derived_stock

router = APIRouter(prefix="/products", tags=["products"])
log = get_logger(__name__)

# Read-only access for cashier + receiver too — they both need to look up
# a product by barcode (scan or manual entry) during their respective
# flows (#3 receiving, #4 checkout). Owner and superadmin have it too.
_lookup_roles = (UserRole.OWNER, UserRole.RECEIVER_USER, UserRole.CASHIER_USER, UserRole.SUPERADMIN)
_write_roles = (UserRole.OWNER, UserRole.SUPERADMIN)
# Quick-add is intentionally broader than /products POST: receiver and
# cashier are the primary users (D-v2-1); owner is a superset of both
# (D-v2-10). Superadmin may quick-add only with an explicit acting shop.
_quick_add_roles = (UserRole.OWNER, UserRole.RECEIVER_USER, UserRole.CASHIER_USER, UserRole.SUPERADMIN)
_pending_roles = (UserRole.OWNER, UserRole.SUPERADMIN)

_PRODUCT_ERROR_CODE_TO_STATUS: dict[str, int] = {
    "not_found": status.HTTP_404_NOT_FOUND,
    "deactivated": status.HTTP_400_BAD_REQUEST,
    "already_active": status.HTTP_400_BAD_REQUEST,
    "already_inactive": status.HTTP_400_BAD_REQUEST,
    "confirmation_mismatch": status.HTTP_400_BAD_REQUEST,
    "permanent_delete_requires_inactive": status.HTTP_400_BAD_REQUEST,
    "permanent_delete_blocked": status.HTTP_409_CONFLICT,
    "empty_csv": status.HTTP_400_BAD_REQUEST,
    "missing_columns": status.HTTP_400_BAD_REQUEST,
    "conflict_row_missing": status.HTTP_500_INTERNAL_SERVER_ERROR,
}


def _error_to_http(exc: ProductError) -> HTTPException:
    # Plain string `detail` (not the {"code", "message"} shape used by
    # voids/checkout) — this router's existing clients/tests expect the
    # bare message string that was here before the service split.
    status_code = _PRODUCT_ERROR_CODE_TO_STATUS.get(exc.code, status.HTTP_500_INTERNAL_SERVER_ERROR)
    if status_code == status.HTTP_500_INTERNAL_SERVER_ERROR:
        log.error("product.unmapped_error_code", code=exc.code, message=exc.message)
    return HTTPException(status_code=status_code, detail=exc.message)


def _lifecycle_error_to_http(exc: ProductLifecycleError) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail={"code": exc.code, "message": exc.message},
    )


async def _public_with_stock(
    db: AsyncSession, rows: list[Product]
) -> list[ProductPublic]:
    """Build ``ProductPublic`` for each row, attaching ``current_stock``
    in one batched query (issue #40, R-v3-4).

    Single source of truth: ``app.services.stock.compute_derived_stock``,
    which is also what the dashboard's low-stock list (#7) and
    checkout's oversell check (#4/#28) use. The catalog value will
    never drift from either of those.
    """
    # One round-trip for the whole batch; no extra wrapper module —
    # the call site is small enough that an indirection would add
    # noise without value. (Architecture-pass review, 2026-07-08.)
    product_ids = [r.id for r in rows]
    stock = await compute_derived_stock(db, product_ids=product_ids)
    eligible_ids = await permanent_delete_eligible_ids(db, product_ids=product_ids)
    out: list[ProductPublic] = []
    for r in rows:
        # model_validate picks up the schema-default current_stock=0;
        # build the response explicitly so we can override with the
        # computed value without the "multiple values for keyword" error.
        data = ProductPublic.model_validate(r).model_dump()
        data["current_stock"] = stock.get(r.id, 0)
        data["can_permanently_delete"] = r.id in eligible_ids and not r.is_active
        out.append(ProductPublic(**data))
    return out


@router.post(
    "",
    response_model=ProductPublic,
    status_code=status.HTTP_201_CREATED,
    summary="Owner creates a single product",
)
async def create_product(
    payload: ProductCreate,
    db: DbSession,
    _user: User = Depends(require_role(*_write_roles)),
) -> ProductPublic:
    # Eagerly capture: the auth dep's session is closing around the time
    # this handler's `db` session takes over, and detached User objects
    # trigger a lazy load on attribute access.
    actor_id = _user.id
    # Owner/receiver/cashier create in their own shop; superadmin must
    # name the target shop explicitly (D-64/D-65).
    actor_shop_id = await resolve_write_shop_id(db, _user, payload.shop_id)
    await require_no_offline_session_lock(
        db, shop_id=actor_shop_id, action="product creation"
    )

    try:
        product = await create_product_row(
            db,
            shop_id=actor_shop_id,
            barcode=payload.barcode,
            brand=payload.brand,
            size_label=payload.size_label,
            price=payload.price,
            low_stock_threshold=payload.low_stock_threshold,
            status_value=ProductStatus.ACTIVE,
        )
    except ProductConflictError as exc:
        raise product_conflict_to_http(exc) from exc
    await db.refresh(product)
    log.info(
        "product.created",
        actor_user_id=actor_id,
        shop_id=actor_shop_id,
        product_id=product.id,
        barcode=product.barcode,
    )
    return ProductPublic.model_validate(product)


@router.post(
    "/quick-add",
    response_model=ProductPublic,
    status_code=status.HTTP_201_CREATED,
    summary="Provisional product creation (receiver/cashier/owner, brand + size only)",
)
async def quick_add_product(
    payload: ProductQuickAdd,
    db: DbSession,
    _user: User = Depends(require_role(*_quick_add_roles)),
    idempotency_key: Annotated[
        str | None,
        Header(
            alias="Idempotency-Key",
            description="Reuses the checkout-finalize idempotency pattern (D-v2-12, D-30). "
            "A double-tap on 'Add' with the same key is a no-op rather than a duplicate-error.",
            max_length=80,
        ),
    ] = None,
    x_quick_add_origin: Annotated[
        Literal["receiving", "checkout"] | None,
        Header(
            alias="X-Quick-Add-Origin",
            description="Which screen triggered the quick-add; routes the audit-log "
            "entry to stockin_logs (receiving) or invoicing_logs (checkout) per D-v2-13. "
            "Defaults to 'receiving' because that's the only caller in #22; "
            "checkout is added in #26.",
        ),
    ] = None,
) -> ProductPublic:
    """Quick-add: receiver/cashier/owner registers a brand-new product on
    the spot when a scan doesn't resolve (issue #22, D-v2-4).

    Behavior:
      - Creates a ``status='pending'`` Product (no price, no threshold).
      - Owner completes it later via the Pending Products screen (#25).
      - A pending product can be received into a Lot like an active one
        (D-v2-6) — receiving this endpoint does NOT bypass that.
      - Same-barcode race is caught by the DB unique constraint on
        ``barcode`` (D-52, D-v2-9) and surfaced as a 409 with a
        conflict-friendly detail so the UI can show
        "Someone already added this — refreshing" instead of a raw error.

    Idempotency: the optional ``Idempotency-Key`` header means a
    double-tap on "Add" with the same key returns the same product
    rather than producing a second create (D-v2-12). The check is
    scoped to this endpoint only — separate from the checkout-finalize
    idempotency namespace.
    """
    actor_id = _user.id
    try:
        actor_shop_id = await resolve_write_shop_id(db, _user, payload.shop_id)
    except HTTPException as exc:
        if _user.role == UserRole.SUPERADMIN and payload.shop_id is None and exc.status_code == 400:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Select a shop before adding this product.",
            ) from exc
        raise
    # The origin header is the source of truth for both the audit-log
    # table choice below and the pending-row origin recorded by the
    # service (issue #31) — defaults to "receiving" for the in-scope
    # #22 caller. Checkout is added in #26.
    origin = x_quick_add_origin or "receiving"
    await require_no_offline_session_lock(
        db, shop_id=actor_shop_id, action="quick-add product creation"
    )

    try:
        product = await products_svc.quick_add_product(
            db,
            shop_id=actor_shop_id,
            barcode=payload.barcode,
            brand=payload.brand,
            size_label=payload.size_label,
            origin=origin,
            actor_id=actor_id,
        )
    except QuickAddConflictError as exc:
        existing = exc.existing
        log.info(
            "product.quick_add.conflict",
            actor_user_id=actor_id,
            shop_id=actor_shop_id,
            barcode=payload.barcode,
            existing_product_id=existing.id,
            existing_status=existing.status.value,
        )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"barcode '{payload.barcode}' already exists",
        ) from exc
    except ProductError as exc:
        raise _error_to_http(exc) from exc
    await require_no_offline_session_lock(
        db, shop_id=product.shop_id, action="product update"
    )
    await db.refresh(product)

    # Audit-log to the right domain table (D-v2-13): receiving ->
    # stockin_logs, checkout -> invoicing_logs.
    quick_add_log_entry(db, actor_id=actor_id, shop_id=actor_shop_id, product=product, origin=origin)
    await db.commit()

    log.info(
        "product.quick_add.created",
        actor_user_id=actor_id,
        shop_id=actor_shop_id,
        product_id=product.id,
        barcode=product.barcode,
        origin=origin,
    )
    return ProductPublic.model_validate(product)


# Idempotency note: the /products/quick-add handler accepts an optional
# Idempotency-Key header (D-v2-12). The cache that used to live here was
# deleted in the architecture review (Candidate C, 2026-07-08) -- the
# frontend always regenerates a random key per submit (qa-${origin}-
# ${barcode}-${uid()}), so the cache-hit branch was structurally
# unreachable through the actual UI. Same-barcode double-submits are
# caught by the global UNIQUE(barcode) constraint and surface as 409
# (handled by the same-barcode race path below). If a future caller
# wants server-side key replay, the right shape is a stable ref on
# the client (like CheckoutPage's idempotencyKeyRef) plus a small
# IdempotencyKey row table -- not a per-process LRU.


@router.get(
    "",
    response_model=list[ProductPublic],
    summary="List products (owner: own shop; superadmin: all shops)",
)
async def list_products(
    db: DbSession,
    _user: User = Depends(require_role(*_write_roles, *_lookup_roles)),
    active_only: Annotated[bool, Query(description="Filter out deactivated products")] = True,
    q: Annotated[str | None, Query(description="Substring match on brand")] = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
    shop_id: Annotated[
        int | None,
        Query(description="Superadmin only: scope the listing to one shop (D-66)"),
    ] = None,
) -> list[ProductPublic]:
    scoped_shop_id = resolve_read_shop_id(_user, shop_id)
    rows = await products_svc.list_products(
        db,
        shop_id=scoped_shop_id,
        active_only=active_only,
        q=q,
        limit=limit,
        offset=offset,
    )
    # Issue #40 — attach current_stock via the shared stock service so
    # the catalog column never diverges from the dashboard's low-stock
    # list for the same product.
    return await _public_with_stock(db, list(rows))


@router.get(
    "/lookup",
    response_model=ProductPublic,
    summary="Resolve a product by barcode (used by receiver/cashier scan flows)",
)
async def lookup_product(
    db: DbSession,
    _user: User = Depends(require_role(*_lookup_roles)),
    barcode: Annotated[str, Query(min_length=1, max_length=64)] = ...,
    shop_id: Annotated[
        int | None,
        Query(description="Superadmin only: scope the lookup to one shop (D-66)"),
    ] = None,
) -> ProductPublic:
    """Scan-time product fetch. The locally-cached catalog (R-12 / D-30)
    lives client-side; this endpoint is the cold-start / cache-miss path
    AND the server-side lookup the cashier and receiver use in their
    respective flows.

    A ``pending`` product IS resolvable here — the receiver needs to scan
    it into a Lot (D-v2-6) and the cashier needs the status field to
    decide whether to block the line (#26). The `is_active=False` check
    is unchanged: deactivating a product still hides it from scan.
    """
    scoped_shop_id = resolve_read_shop_id(_user, shop_id)
    try:
        product = await lookup_product_by_barcode(db, shop_id=scoped_shop_id, barcode=barcode)
    except ProductError as exc:
        raise _error_to_http(exc) from exc
    # Issue #40 — same single-source-of-truth as the list endpoint.
    enriched = await _public_with_stock(db, [product])
    return enriched[0]


@router.patch(
    "/{product_id}",
    response_model=ProductPublic,
    summary="Owner updates a product's price, brand, threshold, or active flag",
)
async def update_product(
    product_id: int,
    payload: ProductUpdate,
    db: DbSession,
    _user: User = Depends(require_role(*_write_roles)),
) -> ProductPublic:
    actor_id = _user.id
    try:
        product = await get_product_for_write(
            db, product_id=product_id, actor_role=_user.role, actor_shop_id=_user.shop_id
        )
    except ProductError as exc:
        raise _error_to_http(exc) from exc

    data = payload.model_dump(exclude_unset=True)
    try:
        update_product_fields(product, data)
    except ProductLifecycleError as exc:
        raise _lifecycle_error_to_http(exc) from exc
    await db.commit()
    await db.refresh(product)
    log.info(
        "product.updated",
        actor_user_id=actor_id,
        shop_id=product.shop_id,
        product_id=product.id,
        changed_fields=sorted(data.keys()),
    )
    return ProductPublic.model_validate(product)


async def _confirm_destructive_action(payload: ProductActionConfirmation, expected: str) -> None:
    if payload.confirmation_text != expected:
        raise ProductError(
            "confirmation_mismatch",
            f"Type {expected} to confirm this action.",
        )


@router.post(
    "/{product_id}/archive",
    response_model=ProductPublic,
    summary="Owner archives a product by marking it inactive",
)
async def archive_product_action(
    product_id: int,
    payload: ProductActionConfirmation,
    db: DbSession,
    _user: User = Depends(require_role(*_write_roles)),
) -> ProductPublic:
    actor_id = _user.id
    try:
        product = await get_product_for_write(
            db, product_id=product_id, actor_role=_user.role, actor_shop_id=_user.shop_id
        )
    except ProductError as exc:
        raise _error_to_http(exc) from exc

    await require_no_offline_session_lock(db, shop_id=product.shop_id, action="product archive")
    try:
        await _confirm_destructive_action(payload, "DELETE")
        if not archive_product(product):
            raise ProductError("already_inactive", "product is already inactive")
    except ProductError as exc:
        raise _error_to_http(exc) from exc

    write_business_log(
        db,
        AdminLog,
        event_type="product.archived",
        actor_id=actor_id,
        actor_name=_user.full_name,
        shop_id=product.shop_id,
        payload={
            "product_id": product.id,
            "barcode": product.barcode,
            "brand": product.brand,
            "size_label": product.size_label,
        },
    )
    await db.commit()
    await db.refresh(product)
    log.info(
        "product.archived",
        actor_user_id=actor_id,
        shop_id=product.shop_id,
        product_id=product.id,
        barcode=product.barcode,
    )
    return ProductPublic.model_validate(product)


@router.post(
    "/{product_id}/restore",
    response_model=ProductPublic,
    summary="Owner restores an inactive product",
)
async def restore_product_action(
    product_id: int,
    payload: ProductActionConfirmation,
    db: DbSession,
    _user: User = Depends(require_role(*_write_roles)),
) -> ProductPublic:
    actor_id = _user.id
    try:
        product = await get_product_for_write(
            db, product_id=product_id, actor_role=_user.role, actor_shop_id=_user.shop_id
        )
    except ProductError as exc:
        raise _error_to_http(exc) from exc

    await require_no_offline_session_lock(db, shop_id=product.shop_id, action="product restore")
    try:
        await _confirm_destructive_action(payload, "RESTORE")
        if not restore_product(product):
            raise ProductError("already_active", "product is already active")
    except ProductError as exc:
        raise _error_to_http(exc) from exc

    write_business_log(
        db,
        AdminLog,
        event_type="product.restored",
        actor_id=actor_id,
        actor_name=_user.full_name,
        shop_id=product.shop_id,
        payload={
            "product_id": product.id,
            "barcode": product.barcode,
            "brand": product.brand,
            "size_label": product.size_label,
        },
    )
    await db.commit()
    await db.refresh(product)
    log.info(
        "product.restored",
        actor_user_id=actor_id,
        shop_id=product.shop_id,
        product_id=product.id,
        barcode=product.barcode,
    )
    return ProductPublic.model_validate(product)


@router.post(
    "/{product_id}/permanent-delete",
    response_model=ProductDeleteResponse,
    summary="Superadmin permanently deletes an inactive product with no blocking history",
)
async def permanent_delete_product(
    product_id: int,
    payload: ProductActionConfirmation,
    db: DbSession,
    _user: User = Depends(require_role(UserRole.SUPERADMIN)),
) -> ProductDeleteResponse:
    actor_id = _user.id
    try:
        product = await get_product_for_write(
            db, product_id=product_id, actor_role=_user.role, actor_shop_id=_user.shop_id
        )
    except ProductError as exc:
        raise _error_to_http(exc) from exc

    await require_no_offline_session_lock(
        db, shop_id=product.shop_id, action="product permanent delete"
    )
    try:
        await _confirm_destructive_action(payload, "PERMANENT DELETE")
        if product.is_active:
            raise ProductError(
                "permanent_delete_requires_inactive",
                "deactivate the product before permanently deleting it",
            )
        blockers = await permanent_delete_blockers(db, product_id=product.id)
        if blockers:
            raise ProductError(
                "permanent_delete_blocked",
                "cannot permanently delete product with lot or invoice history",
            )
    except ProductError as exc:
        raise _error_to_http(exc) from exc

    product_id_value = product.id
    shop_id_value = product.shop_id
    barcode_value = product.barcode
    payload_data = {
        "product_id": product_id_value,
        "barcode": barcode_value,
        "brand": product.brand,
        "size_label": product.size_label,
    }
    write_business_log(
        db,
        AdminLog,
        event_type="product.permanently_deleted",
        actor_id=actor_id,
        actor_name=_user.full_name,
        shop_id=shop_id_value,
        payload=payload_data,
    )
    await db.delete(product)
    await db.commit()
    log.info(
        "product.permanently_deleted",
        actor_user_id=actor_id,
        shop_id=shop_id_value,
        product_id=product_id_value,
        barcode=barcode_value,
    )
    return ProductDeleteResponse(
        id=product_id_value,
        shop_id=shop_id_value,
        barcode=barcode_value,
        action="permanently_deleted",
    )


# --- Issue #25: Pending Products list + activation ---------------------
#
# Activation is the resolution action (D-v2-8): completing the product
# IS the dismissal -- there is no separate dismiss/acknowledge step. The
# owner sets a price, the row flips from pending to active, and the
# product drops off the pending list automatically.


@router.get(
    "/pending/count",
    response_model=dict[str, int],
    summary="Count pending products for sidebar badges",
)
async def pending_product_count(
    db: DbSession,
    _user: User = Depends(require_role(*_pending_roles)),
    shop_id: Annotated[
        int | None,
        Query(description="Superadmin only: scope the count to one shop"),
    ] = None,
) -> dict[str, int]:
    scoped_shop_id = resolve_read_shop_id(_user, shop_id)
    return {"count": await count_pending_products(db, shop_id=scoped_shop_id)}


@router.get(
    "/pending",
    response_model=list[PendingProductRow],
    summary="List pending products awaiting a price (issue #25, D-v2-8)",
)
async def list_pending_products(
    db: DbSession,
    _user: User = Depends(require_role(*_pending_roles)),
    shop_id: Annotated[
        int | None,
        Query(description="Superadmin only: scope the listing to one shop"),
    ] = None,
) -> list[PendingProductRow]:
    scoped_shop_id = resolve_read_shop_id(_user, shop_id)
    rows = await products_svc.list_pending_products(db, shop_id=scoped_shop_id)
    return [
        PendingProductRow(
            id=r.product.id,
            barcode=r.product.barcode,
            brand=r.product.brand,
            size_label=r.product.size_label,
            created_at=r.product.created_at,
            updated_at=r.product.updated_at,
            last_event_origin=r.last_event_origin,
            last_event_actor_id=r.last_event_actor_id,
            last_event_actor_name=r.last_event_actor_name,
        )
        for r in rows
    ]


@router.post(
    "/{product_id}/reject",
    response_model=ProductPublic,
    summary="Owner soft-rejects a pending product",
)
async def reject_product(
    product_id: int,
    db: DbSession,
    _user: User = Depends(require_role(*_pending_roles)),
) -> ProductPublic:
    try:
        product = await get_product_for_write(
            db, product_id=product_id, actor_role=_user.role, actor_shop_id=_user.shop_id
        )
    except ProductError as exc:
        raise _error_to_http(exc) from exc
    await require_no_offline_session_lock(
        db, shop_id=product.shop_id, action="pending product rejection"
    )
    reject_pending_product(product)
    await db.commit()
    await db.refresh(product)
    return ProductPublic.model_validate(product)


@router.post(
    "/{product_id}/activate",
    response_model=ProductPublic,
    summary="Owner completes a pending product by setting its price (issue #25)",
)
async def activate_product(
    product_id: int,
    payload: ProductActivate,
    db: DbSession,
    _user: User = Depends(require_role(*_pending_roles)),
) -> ProductPublic:
    actor_id = _user.id
    try:
        product = await get_product_for_write(
            db, product_id=product_id, actor_role=_user.role, actor_shop_id=_user.shop_id
        )
    except ProductError as exc:
        raise _error_to_http(exc) from exc
    await require_no_offline_session_lock(
        db, shop_id=product.shop_id, action="pending product activation"
    )

    try:
        was_pending = activate_pending_product(
            product, price=payload.price, low_stock_threshold=payload.low_stock_threshold
        )
    except ProductError as exc:
        raise _error_to_http(exc) from exc
    except ProductLifecycleError as exc:
        raise _lifecycle_error_to_http(exc) from exc

    await db.commit()
    await db.refresh(product)
    log.info(
        "product.activated",
        actor_user_id=actor_id,
        shop_id=product.shop_id,
        product_id=product.id,
        was_pending=was_pending,
    )
    return ProductPublic.model_validate(product)


# --- CSV bulk import ---


@router.post(
    "/import-csv",
    response_model=ProductImportResponse,
    summary="Owner bulk-uploads a CSV of products (per-row errors surfaced)",
)
async def import_products_csv(
    db: DbSession,
    _user: User = Depends(require_role(*_write_roles)),
    file: UploadFile = File(..., description="CSV with header row"),
    shop_id: Annotated[
        int | None,
        Form(description="Superadmin-only (D-65): target shop for the import"),
    ] = None,
) -> ProductImportResponse:
    """Bulk import per D-61 / R-42. Returns 200 even when some rows fail —
    per-row errors are listed in the response so the cashier-facing UI
    can show "X succeeded, Y failed" rather than silently partial-failing.
    A row fails if validation rejects it OR if its barcode collides with
    an existing product (D-52)."""
    # Capture actor fields up front — `_user` is detached after the
    # auth dep's session closes, and accessing `.id` / `.shop_id` later
    # triggers a lazy load on a closed session.
    actor_id = _user.id
    actor_shop_id = await resolve_write_shop_id(db, _user, shop_id)
    await require_no_offline_session_lock(
        db, shop_id=actor_shop_id, action="product CSV import"
    )

    raw = await file.read()
    try:
        summary = await products_svc.import_products_csv(db, shop_id=actor_shop_id, raw=raw)
    except ProductError as exc:
        raise _error_to_http(exc) from exc

    log.info(
        "product.import_csv",
        actor_user_id=actor_id,
        shop_id=actor_shop_id,
        created=summary.created,
        failed=len(summary.errors),
    )
    return ProductImportResponse(
        created=summary.created,
        failed=len(summary.errors),
        errors=[ProductImportError(row=e.row, barcode=e.barcode, error=e.error) for e in summary.errors],
    )
