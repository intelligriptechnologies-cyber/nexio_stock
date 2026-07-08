"""Products service (issue #30) — CRUD, quick-add, pending-list,
activation, and CSV bulk import.

``app/api/products.py`` used to hold all of this directly in route
handlers — every other mutating area (checkout, voids, eod) has a
matching ``app/services/*.py`` module; this gives products the same
split. The router keeps request parsing, auth-role gating, and
error-to-HTTP translation; this module owns the query-building,
state mutation, and CSV parsing.

``ProductError`` is the one domain-error type for the concerns that
don't already have their own (``ProductConflictError`` for inserts,
``ProductLifecycleError`` for the price/status invariant). The router
maps it to HTTP via a ``code -> status`` table, same pattern as
``app.services.voids.VoidError`` / ``app.services.checkout.CheckoutError``.
"""
from __future__ import annotations

import csv
import io
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.log import InvoicingLog, StockinLog
from app.models.product import Product, ProductStatus
from app.models.user import User, UserRole
from app.services.product_creation import ProductConflictError, create_product_row
from app.services.product_lifecycle import apply_status_transition


class ProductError(Exception):
    """Raised for the products-service concerns that aren't already
    covered by ``ProductConflictError`` / ``ProductLifecycleError``.
    The router maps this to HTTP via a per-code status table."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


# --- shared shop-scoping (list / lookup / pending) ----------------------


def _apply_shop_scope(stmt, *, actor_role: UserRole, actor_shop_id: int | None, shop_id: int | None):
    """Non-superadmin is pinned to its own shop and may not request a
    different one (D-66); superadmin may optionally narrow to one shop
    via the acting-shop picker, else sees every shop."""
    if actor_role != UserRole.SUPERADMIN:
        if shop_id is not None and shop_id != actor_shop_id:
            raise ProductError("shop_id_forbidden", "only superadmin may specify shop_id")
        return stmt.where(Product.shop_id == actor_shop_id)
    if shop_id is not None:
        return stmt.where(Product.shop_id == shop_id)
    return stmt


async def list_products(
    db: AsyncSession,
    *,
    actor_role: UserRole,
    actor_shop_id: int | None,
    shop_id: int | None,
    active_only: bool,
    q: str | None,
    limit: int,
    offset: int,
) -> list[Product]:
    stmt = _apply_shop_scope(
        select(Product), actor_role=actor_role, actor_shop_id=actor_shop_id, shop_id=shop_id
    )
    if active_only:
        stmt = stmt.where(Product.is_active.is_(True))
    if q:
        stmt = stmt.where(Product.brand.ilike(f"%{q}%"))
    stmt = stmt.order_by(Product.brand, Product.size_label).limit(limit).offset(offset)
    return (await db.execute(stmt)).scalars().all()


async def lookup_product_by_barcode(
    db: AsyncSession,
    *,
    actor_role: UserRole,
    actor_shop_id: int | None,
    shop_id: int | None,
    barcode: str,
) -> Product:
    """Scan-time product fetch (D-v2-6/#26: a ``pending`` product IS
    resolvable here). Raises ``ProductError("not_found", ...)`` when
    missing or deactivated."""
    stmt = _apply_shop_scope(
        select(Product).where(Product.barcode == barcode),
        actor_role=actor_role,
        actor_shop_id=actor_shop_id,
        shop_id=shop_id,
    )
    product = (await db.execute(stmt)).scalar_one_or_none()
    if product is None or not product.is_active:
        raise ProductError("not_found", f"no active product with barcode '{barcode}'")
    return product


async def get_product_for_write(
    db: AsyncSession,
    *,
    product_id: int,
    actor_role: UserRole,
    actor_shop_id: int | None,
) -> Product:
    stmt = select(Product).where(Product.id == product_id)
    if actor_role != UserRole.SUPERADMIN:
        stmt = stmt.where(Product.shop_id == actor_shop_id)
    product = (await db.execute(stmt)).scalar_one_or_none()
    if product is None:
        raise ProductError("not_found", "product not found")
    return product


def update_product_fields(product: Product, data: dict) -> None:
    """Mutate ``product`` per a PATCH payload (``.model_dump(exclude_unset=True)``).

    A price change goes through ``apply_status_transition`` first so the
    price/status coupling (D-v2-5) is enforced — raises
    ``ProductLifecycleError`` (mapped to 400 by the router) rather than
    letting a bad value reach the DB CHECK constraint as a 500.
    """
    data = dict(data)
    if "price" in data:
        apply_status_transition(product, price=data["price"])
        del data["price"]
    for field_name, value in data.items():
        setattr(product, field_name, value)


def activate_pending_product(
    product: Product, *, price: Decimal, low_stock_threshold: int | None
) -> bool:
    """Complete a pending product by setting its price (issue #25,
    D-v2-8). Returns ``was_pending`` for the caller's audit log.

    Raises ``ProductError("deactivated", ...)`` if the product has
    ``is_active=False``; ``ProductLifecycleError`` if the price/status
    invariant is violated.
    """
    if not product.is_active:
        raise ProductError("deactivated", "cannot activate a deactivated product")
    was_pending = product.status == ProductStatus.PENDING
    apply_status_transition(product, price=price)
    product.low_stock_threshold = low_stock_threshold
    return was_pending


# --- quick-add (issue #22) ----------------------------------------------


class QuickAddConflictError(Exception):
    """Same-barcode race on quick-add (D-52/D-v2-9). Carries the
    existing row so the router can log the conflict and return 409."""

    def __init__(self, existing: Product) -> None:
        super().__init__(f"barcode {existing.barcode!r} already exists")
        self.existing = existing


async def quick_add_product(
    db: AsyncSession,
    *,
    shop_id: int,
    barcode: str,
    brand: str,
    size_label: str,
    origin: str,
    actor_id: int,
) -> Product:
    """Create a ``pending`` product from brand + size only (issue #22,
    D-v2-4). Records ``origin``/``actor_id`` directly on the row (issue
    #31) so the Pending Products list can read them back without
    scanning the audit-log tables. Raises ``QuickAddConflictError`` on a
    same-barcode race so the router can log it and return 409, or
    ``ProductError("conflict_row_missing", ...)`` in the
    (shouldn't-happen) case where the constraint fired but no existing
    row can be found."""
    try:
        return await create_product_row(
            db,
            shop_id=shop_id,
            barcode=barcode,
            brand=brand,
            size_label=size_label,
            price=None,
            low_stock_threshold=None,
            status_value=ProductStatus.PENDING,
            pending_origin=origin,
            pending_added_by_user_id=actor_id,
        )
    except ProductConflictError as exc:
        # The seam has already rolled back; we can safely SELECT now.
        existing = (
            await db.execute(
                select(Product).where(Product.shop_id == shop_id, Product.barcode == barcode)
            )
        ).scalar_one_or_none()
        if existing is None:
            raise ProductError(
                "conflict_row_missing", "barcode conflict but no existing row found"
            ) from exc
        raise QuickAddConflictError(existing) from exc


def quick_add_log_entry(
    *, actor_id: int, shop_id: int, product: Product, origin: str
) -> StockinLog | InvoicingLog:
    """Build the audit-log row for a successful quick-add (D-v2-13):
    receiving origin -> stockin_logs, checkout origin -> invoicing_logs."""
    payload = {
        "product_id": product.id,
        "barcode": product.barcode,
        "brand": product.brand,
        "size_label": product.size_label,
        "origin": origin,
    }
    log_cls = StockinLog if origin == "receiving" else InvoicingLog
    return log_cls(
        shop_id=shop_id,
        actor_user_id=actor_id,
        event_type="product.pending_created",
        payload=payload,
    )


# --- pending products list (issue #25) ----------------------------------


@dataclass
class PendingProductInfo:
    product: Product
    last_event_origin: str | None
    last_event_actor_id: int | None
    last_event_actor_name: str | None


async def list_pending_products(
    db: AsyncSession,
    *,
    actor_role: UserRole,
    actor_shop_id: int | None,
    shop_id: int | None,
) -> list[PendingProductInfo]:
    """Owner/superadmin view of every product still in status='pending'
    (D-v2-5), newest first. Origin and adding-actor are read directly
    off ``Product.pending_origin`` / ``pending_added_by_user_id`` (issue
    #31) — recorded once at quick-add write time — rather than
    re-derived by scanning every ``product.pending_created`` row across
    ``stockin_logs``/``invoicing_logs`` on each call. The list itself is
    the notification surface (D-v2-8)."""
    stmt = (
        select(Product)
        .where(Product.status == ProductStatus.PENDING)
        .order_by(Product.created_at.desc())
    )
    stmt = _apply_shop_scope(
        stmt, actor_role=actor_role, actor_shop_id=actor_shop_id, shop_id=shop_id
    )

    rows = (await db.execute(stmt)).scalars().all()
    if not rows:
        return []

    # Resolve actor names in one query (small N — the pending list is
    # bounded to dozens of rows in any realistic deployment).
    actor_ids = {p.pending_added_by_user_id for p in rows if p.pending_added_by_user_id is not None}
    actor_names: dict[int, str] = {}
    if actor_ids:
        actor_rows = (await db.execute(select(User).where(User.id.in_(actor_ids)))).scalars().all()
        actor_names = {u.id: u.full_name for u in actor_rows}

    return [
        PendingProductInfo(
            product=p,
            last_event_origin=p.pending_origin,
            last_event_actor_id=p.pending_added_by_user_id,
            last_event_actor_name=(
                actor_names.get(p.pending_added_by_user_id)
                if p.pending_added_by_user_id is not None
                else None
            ),
        )
        for p in rows
    ]


# --- CSV bulk import -----------------------------------------------------

CSV_REQUIRED_COLUMNS = ("barcode", "brand", "size_label", "price")
CSV_OPTIONAL_COLUMNS = ("low_stock_threshold",)


@dataclass
class ImportRowError:
    row: int
    barcode: str | None
    error: str


@dataclass
class ImportSummary:
    created: int
    errors: list[ImportRowError]


def _decode_csv_bytes(raw: bytes) -> str:
    try:
        return raw.decode("utf-8-sig")  # tolerate BOM
    except UnicodeDecodeError:
        return raw.decode("latin-1", errors="replace")


async def import_products_csv(
    db: AsyncSession, *, shop_id: int, raw: bytes
) -> ImportSummary:
    """Bulk import per D-61 / R-42. Returns a summary even when some
    rows fail -- per-row errors are listed so the cashier-facing UI can
    show "X succeeded, Y failed" rather than silently partial-failing.
    A row fails if validation rejects it OR if its barcode collides
    with an existing product (D-52).

    Raises ``ProductError`` for whole-file problems (empty file,
    missing required columns) -- those abort before any row is
    processed.
    """
    text = _decode_csv_bytes(raw)
    reader = csv.DictReader(io.StringIO(text))
    if reader.fieldnames is None:
        raise ProductError("empty_csv", "empty CSV")
    missing = [c for c in CSV_REQUIRED_COLUMNS if c not in reader.fieldnames]
    if missing:
        raise ProductError("missing_columns", f"CSV missing required columns: {missing}")

    created = 0
    errors: list[ImportRowError] = []

    for row_index, raw_row in enumerate(reader, start=2):  # row 1 is header
        row_num = row_index  # already 1-based for the data rows
        barcode = (raw_row.get("barcode") or "").strip()
        brand = (raw_row.get("brand") or "").strip()
        size_label = (raw_row.get("size_label") or "").strip()
        price_raw = (raw_row.get("price") or "").strip()
        threshold_raw = (raw_row.get("low_stock_threshold") or "").strip()

        # Per-row validation
        if not barcode or not brand or not size_label or not price_raw:
            errors.append(
                ImportRowError(
                    row=row_num,
                    barcode=barcode or None,
                    error="barcode, brand, size_label, and price are all required",
                )
            )
            continue
        try:
            price = Decimal(price_raw)
        except (InvalidOperation, ValueError):
            errors.append(
                ImportRowError(row=row_num, barcode=barcode, error=f"price '{price_raw}' is not a valid decimal")
            )
            continue
        if price <= 0:
            errors.append(ImportRowError(row=row_num, barcode=barcode, error="price must be > 0"))
            continue
        threshold: int | None = None
        if threshold_raw:
            try:
                threshold = int(threshold_raw)
            except ValueError:
                errors.append(
                    ImportRowError(
                        row=row_num,
                        barcode=barcode,
                        error=f"low_stock_threshold '{threshold_raw}' is not a valid integer",
                    )
                )
                continue
            if threshold < 0:
                errors.append(
                    ImportRowError(row=row_num, barcode=barcode, error="low_stock_threshold must be >= 0")
                )
                continue

        # Architecture review Candidate B: insert + 409 lives in
        # app.services.product_creation. The CSV batch passes
        # commit=False so we can flush per row and surface per-row
        # 409s as ImportRowError entries (the existing
        # per-row-validation shape).
        try:
            product = await create_product_row(
                db,
                shop_id=shop_id,
                barcode=barcode,
                brand=brand,
                size_label=size_label,
                price=price,
                low_stock_threshold=threshold,
                status_value=ProductStatus.ACTIVE,
                commit=False,
            )
        except ProductConflictError as exc:
            errors.append(
                ImportRowError(row=row_num, barcode=barcode, error=f"barcode '{exc.barcode}' already exists")
            )
            continue

        created += 1
        # Let the session forget the row so a later failure doesn't
        # poison this row's in-memory state. Use expunge (not
        # rollback) because the INSERT succeeded (it was flushed,
        # not committed).
        db.expunge(product)

    if created:
        await db.commit()

    return ImportSummary(created=created, errors=errors)


__all__ = [
    "CSV_OPTIONAL_COLUMNS",
    "CSV_REQUIRED_COLUMNS",
    "ImportRowError",
    "ImportSummary",
    "PendingProductInfo",
    "ProductError",
    "QuickAddConflictError",
    "activate_pending_product",
    "get_product_for_write",
    "import_products_csv",
    "list_pending_products",
    "list_products",
    "lookup_product_by_barcode",
    "quick_add_log_entry",
    "quick_add_product",
    "update_product_fields",
]
