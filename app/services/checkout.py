"""Checkout finalize — atomic, concurrency-safe, idempotent (R-12, R-13).

The single critical path in v1: turn a cart (a list of barcodes +
quantities) plus one-or-more payment rows into a finalized Invoice,
all in one transaction with row-level locks on the affected Products
so two concurrent finalizes for the last unit of stock can never both
succeed.

Invariants enforced here (R-9, D-20):
  1. Stock never goes negative — we lock each Product row with
     `SELECT ... FOR UPDATE`, sum the requested quantity across the
     cart, and refuse if it exceeds the current stock derived from
     LotLine receipts.
  2. Finalized invoice line items are immutable — we never UPDATE
     these rows; the only way they get created is in this transaction.
  3. Every invoice line resolves to a real, in-stock product at scan
     time — the lookup is per-shop and against `is_active` products.

Idempotency (D-30, R-12):
  The request carries an Idempotency-Key header. On a retry, the server
  returns the same Invoice it created the first time. Lookup is
  per-shop to keep shops independent.
"""
from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from decimal import Decimal
from typing import NamedTuple

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.invoice import (
    IdempotencyKey,
    Invoice,
    InvoiceLine,
    InvoiceStatus,
    Payment,
    PaymentMode,
)
from app.models.product import Product
from app.models.shop import Shop
from app.services.calendar import today_local_date
from app.services.stock import compute_derived_stock


class CheckoutError(Exception):
    """Raised on any business-rule failure during finalize.

    The route maps these to specific HTTP status codes (409 for
    oversell / unknown barcode, 400 for bad payment split, etc).
    """

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class CartLine(NamedTuple):
    """A single line in the cashier's submitted cart."""

    barcode: str
    quantity: int


class PaymentLine(NamedTuple):
    """One payment mode contribution. Multiple allowed (D-59, R-40)."""

    mode: PaymentMode
    amount: Decimal


@dataclass
class FinalizeResult:
    invoice: Invoice
    is_replay: bool  # True when this finalize was a retry of a prior key


# Sentinel payment mode for the default single-mode flow. Routes can
# pass `[("cash", total)]` and the service normalizes the structure.
DEFAULT_MODE = PaymentMode.CASH


def _check_idempotency_key_present(key: str | None) -> str:
    if not key or not key.strip():
        raise CheckoutError(
            "idempotency_key_required",
            "Idempotency-Key header is required on checkout finalize",
        )
    k = key.strip()
    if len(k) > 80:
        raise CheckoutError("idempotency_key_too_long", "Idempotency-Key max length is 80")
    return k


def validate_note_for_payments(*, payments: list[PaymentLine], note: str | None) -> None:
    if any(payment.mode == PaymentMode.OTHER for payment in payments) and not (note or "").strip():
        raise CheckoutError(
            "note_required_for_other_payment",
            "note is required when payment mode 'other' is used",
        )


async def _resolve_products_for_cart(
    db: AsyncSession,
    *,
    shop_id: int,
    lines: Iterable[CartLine],
) -> dict[str, Product]:
    barcodes = [line.barcode for line in lines]
    products = (
        await db.execute(
            select(Product).where(
                Product.shop_id == shop_id,
                Product.barcode.in_(barcodes),
                Product.is_active.is_(True),
            )
        )
    ).scalars().all()
    by_barcode = {p.barcode: p for p in products}

    missing = sorted({b for b in barcodes if b not in by_barcode})
    if missing:
        raise CheckoutError(
            "unknown_barcode",
            f"unknown or inactive barcodes in cart: {missing}",
        )

    # Issue #26 (D-v2-7): a cart line that resolves to a ``pending``
    # product (status='pending') cannot be finalized. Pending products
    # have no price, and the cashier UI is supposed to skip them
    # with the "Pending — no price yet, contact admin" message. This
    # is the backend safety net for that rule: even if a buggy or
    # malicious client submits a pending barcode, the finalize
    # transaction rejects the whole cart with a specific error
    # code so the UI can show the message and let the cashier retry
    # without the offending line.
    pending_barcodes = sorted(
        b for b, p in by_barcode.items() if p.status.value == "pending"
    )
    if pending_barcodes:
        raise CheckoutError(
            "pending_product_in_cart",
            f"cannot finalize cart with pending product(s): {pending_barcodes}; "
            f"remove the line and try again",
        )
    return by_barcode


async def finalize_checkout(
    db: AsyncSession,
    *,
    shop_id: int,
    cashier_user_id: int,
    cart: list[CartLine],
    payments: list[PaymentLine],
    idempotency_key: str | None,
    note: str | None = None,
) -> FinalizeResult:
    """Run the entire finalize transaction. Caller is responsible for
    committing — the function uses `begin_nested` if it needs to roll
    back partial state, but on the happy path it makes the changes
    visible via the existing outer transaction.
    """
    key = _check_idempotency_key_present(idempotency_key)

    if not cart:
        raise CheckoutError("empty_cart", "cart must contain at least one line")
    for line in cart:
        if line.quantity <= 0:
            raise CheckoutError(
                "bad_quantity",
                f"line {line.barcode}: quantity must be > 0",
            )

    if not payments:
        raise CheckoutError("no_payments", "at least one payment line is required")
    total_paid = sum((p.amount for p in payments), Decimal("0"))
    if total_paid <= 0:
        raise CheckoutError("zero_payment", "payment total must be > 0")

    # 1. Idempotency replay — if a prior call stored this key, return
    #    the same invoice. We check BEFORE doing any work, so a retry
    #    never double-sells (R-12 / D-30).
    prior = (
        await db.execute(
            select(IdempotencyKey).where(
                IdempotencyKey.shop_id == shop_id,
                IdempotencyKey.key == key,
            )
        )
    ).scalar_one_or_none()
    if prior is not None:
        invoice = await db.get(Invoice, prior.invoice_id)
        if invoice is not None:
            return FinalizeResult(invoice=invoice, is_replay=True)
        # The key exists but the invoice was deleted — extremely rare
        # (cascade from a void reversal). Treat as no-prior and proceed
        # by inserting a new key below.

    validate_note_for_payments(payments=payments, note=note)

    # 2. Resolve cart barcodes to products.
    by_barcode = await _resolve_products_for_cart(db, shop_id=shop_id, lines=cart)

    # Aggregate the requested quantity per product (cart may have the
    # same barcode twice in the wild — merge first).
    requested: dict[int, int] = {}
    for line in cart:
        product = by_barcode[line.barcode]
        requested[product.id] = requested.get(product.id, 0) + line.quantity

    # 3. Concurrency safety: lock each affected Product row with
    #    SELECT ... FOR UPDATE. Two concurrent finalizes for the same
    #    SKU both queue on the row lock; the second sees the first's
    #    decrements when it wakes.
    locked_products = (
        await db.execute(
            select(Product)
            .where(Product.id.in_(list(requested.keys())))
            .with_for_update()
        )
    ).scalars().all()
    by_id = {p.id: p for p in locked_products}

    # 4. Check stock under the lock.
    current = await compute_derived_stock(db, product_ids=list(requested.keys()))
    oversell = sorted(
        (pid, requested[pid], current.get(pid, 0))
        for pid in requested
        if requested[pid] > current.get(pid, 0)
    )
    if oversell:
        details = ", ".join(
            f"{by_id[pid].barcode} (requested {req}, available {avail})"
            for pid, req, avail in oversell
        )
        raise CheckoutError(
            "insufficient_stock",
            f"insufficient stock for: {details}",
        )

    # 5. Compute total from the products' CURRENT prices (not the cart's
    #    submitted price — the server is the source of truth on price
    #    at sale time; the cashier's "cart" is just a list of barcodes).
    total = Decimal("0")
    line_specs: list[tuple[Product, int, Decimal]] = []
    for product_id, qty in requested.items():
        product = by_id[product_id]
        line_total = (product.price * qty).quantize(Decimal("0.01"))
        line_specs.append((product, qty, line_total))
        total += line_total
    total = total.quantize(Decimal("0.01"))

    if total_paid.quantize(Decimal("0.01")) != total:
        raise CheckoutError(
            "payment_mismatch",
            f"payment total {total_paid} does not match invoice total {total}",
        )

    # 6. Lock the shop row, allocate the next invoice number, bump the
    #    counter. Locking the shop row keeps the invoice_number monotonic
    #    even when two finalizes for different products race.
    shop = (
        await db.execute(
            select(Shop).where(Shop.id == shop_id).with_for_update()
        )
    ).scalar_one()
    next_number = (shop.last_invoice_number or 0) + 1
    shop.last_invoice_number = next_number
    business_date = today_local_date()

    # 7. Create the invoice + lines + payments.
    invoice = Invoice(
        shop_id=shop_id,
        cashier_user_id=cashier_user_id,
        invoice_number=next_number,
        status=InvoiceStatus.FINALIZED,
        total_amount=total,
        business_date=business_date,
        note=note,
    )
    db.add(invoice)
    await db.flush()  # need invoice.id for the lines and payments

    for product, qty, line_total in line_specs:
        db.add(
            InvoiceLine(
                invoice_id=invoice.id,
                product_id=product.id,
                quantity=qty,
                unit_price=product.price,
                line_total=line_total,
                # Issue #38 — snapshot brand + size at sale time so a
                # later product rename never alters this invoice line.
                product_brand=product.brand,
                product_size_label=product.size_label,
            )
        )

    for pay in payments:
        db.add(
            Payment(
                invoice_id=invoice.id,
                mode=pay.mode,
                amount=pay.amount.quantize(Decimal("0.01")),
            )
        )

    db.add(
        IdempotencyKey(
            shop_id=shop_id,
            key=key,
            invoice_id=invoice.id,
        )
    )

    return FinalizeResult(invoice=invoice, is_replay=False)


# Re-export for tests / routes.
__all__ = [
    "DEFAULT_MODE",
    "CartLine",
    "CheckoutError",
    "FinalizeResult",
    "PaymentLine",
    "finalize_checkout",
]
