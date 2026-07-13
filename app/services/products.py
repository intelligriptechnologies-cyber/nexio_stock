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

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api._logs import write_business_log
from app.models.invoice import InvoiceLine, PastInvoiceLine
from app.models.lot import LotLine
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
#
# The authorization decision (can this caller ask for this shop_id?)
# lives in `app.api.deps.resolve_read_shop_id` (issue #32) — by the time
# a query reaches this module, `shop_id` is already the resolved scope:
# a concrete shop for every non-superadmin caller, and either a concrete
# shop or `None` ("no filter", superadmin browsing every shop) here.


def _scope_to_shop(stmt, *, shop_id: int | None):
    if shop_id is None:
        return stmt
    return stmt.where(Product.shop_id == shop_id)


async def list_products(
    db: AsyncSession,
    *,
    shop_id: int | None,
    active_only: bool,
    q: str | None,
    limit: int,
    offset: int,
) -> list[Product]:
    stmt = _scope_to_shop(select(Product), shop_id=shop_id)
    if active_only:
        stmt = stmt.where(Product.is_active.is_(True))
    if q:
        like = f"%{q}%"
        stmt = stmt.where(
            or_(
                Product.brand.ilike(like),
                Product.barcode.ilike(like),
                Product.size_label.ilike(like),
            )
        )
    stmt = stmt.order_by(Product.brand, Product.size_label).limit(limit).offset(offset)
    return (await db.execute(stmt)).scalars().all()


async def permanent_delete_eligible_ids(
    db: AsyncSession, *, product_ids: list[int]
) -> set[int]:
    if not product_ids:
        return set()

    blocked: set[int] = set()
    for line_model in (LotLine, InvoiceLine, PastInvoiceLine):
        stmt = (
            select(line_model.product_id)
            .where(line_model.product_id.in_(product_ids))
            .group_by(line_model.product_id)
        )
        blocked.update((await db.execute(stmt)).scalars().all())
    return set(product_ids) - blocked


async def permanent_delete_blockers(db: AsyncSession, *, product_id: int) -> list[str]:
    blockers: list[str] = []
    checks = (
        ("lot history", select(func.count(LotLine.id)).where(LotLine.product_id == product_id)),
        (
            "invoice history",
            select(func.count(InvoiceLine.id)).where(InvoiceLine.product_id == product_id),
        ),
        (
            "archived invoice history",
            select(func.count(PastInvoiceLine.id)).where(PastInvoiceLine.product_id == product_id),
        ),
    )
    for label, stmt in checks:
        count = int((await db.execute(stmt)).scalar_one())
        if count > 0:
            blockers.append(label)
    return blockers


async def lookup_product_by_barcode(
    db: AsyncSession, *, shop_id: int | None, barcode: str
) -> Product:
    """Scan-time product fetch (D-v2-6/#26: a ``pending`` product IS
    resolvable here). Raises ``ProductError("not_found", ...)`` when
    missing or deactivated."""
    stmt = _scope_to_shop(select(Product).where(Product.barcode == barcode), shop_id=shop_id)
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
        if existing.status == ProductStatus.REJECTED and existing.shop_id == shop_id:
            existing.status = ProductStatus.PENDING
            existing.brand = brand
            existing.size_label = size_label
            existing.price = None
            existing.is_active = True
            existing.pending_origin = origin
            existing.pending_added_by_user_id = actor_id
            await db.commit()
            return existing
        raise QuickAddConflictError(existing) from exc


def quick_add_log_entry(
    db: AsyncSession, *, actor_id: int, shop_id: int, product: Product, origin: str
) -> StockinLog | InvoicingLog:
    """Write the audit-log row for a successful quick-add (D-v2-13):
    receiving origin -> stockin_logs, checkout origin -> invoicing_logs."""
    payload = {
        "product_id": product.id,
        "barcode": product.barcode,
        "brand": product.brand,
        "size_label": product.size_label,
        "origin": origin,
    }
    log_cls = StockinLog if origin == "receiving" else InvoicingLog
    return write_business_log(
        db,
        log_cls,
        event_type="product.pending_created",
        actor_id=actor_id,
        shop_id=shop_id,
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
    db: AsyncSession, *, shop_id: int | None
) -> list[PendingProductInfo]:
    """Owner/superadmin view of every product still in status='pending'
    (D-v2-5), newest first. Origin and adding-actor are read directly
    off ``Product.pending_origin`` / ``pending_added_by_user_id`` (issue
    #31) — recorded once at quick-add write time — rather than
    re-derived by scanning every ``product.pending_created`` row across
    ``stockin_logs``/``invoicing_logs`` on each call. The list itself is
    the notification surface (D-v2-8)."""
    stmt = _scope_to_shop(
        select(Product).where(Product.status == ProductStatus.PENDING),
        shop_id=shop_id,
    ).order_by(Product.created_at.desc())

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


async def count_pending_products(db: AsyncSession, *, shop_id: int | None) -> int:
    stmt = _scope_to_shop(
        select(func.count(Product.id)).where(Product.status == ProductStatus.PENDING),
        shop_id=shop_id,
    )
    return int((await db.execute(stmt)).scalar_one())


def reject_pending_product(product: Product) -> bool:
    if product.status != ProductStatus.PENDING:
        return False
    product.status = ProductStatus.REJECTED
    product.price = None
    return True


def archive_product(product: Product) -> bool:
    if not product.is_active:
        return False
    product.is_active = False
    return True


def restore_product(product: Product) -> bool:
    if product.is_active:
        return False
    product.is_active = True
    return True


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
    "archive_product",
    "activate_pending_product",
    "count_pending_products",
    "get_product_for_write",
    "import_products_csv",
    "list_pending_products",
    "list_products",
    "lookup_product_by_barcode",
    "permanent_delete_blockers",
    "permanent_delete_eligible_ids",
    "quick_add_log_entry",
    "quick_add_product",
    "reject_pending_product",
    "restore_product",
    "update_product_fields",
]
