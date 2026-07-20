"""Invoice listing, validation, and editable-current-invoice workflow."""
from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from sqlalchemy import exists, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.invoice import (
    Invoice,
    InvoiceLine,
    InvoiceStatus,
    PastInvoice,
    Payment,
    PaymentMode,
)
from app.models.product import Product
from app.models.user import User
from app.services.checkout import CartLine, CheckoutError, PaymentLine, validate_note_for_payments
from app.services.stock import compute_derived_stock


@dataclass
class ValidatedCartLine:
    barcode: str
    requested_quantity: int
    available_quantity: int
    accepted_quantity: int
    adjusted: bool


@dataclass
class InvoiceEditResult:
    invoice: Invoice
    before: dict
    after: dict


async def attach_cashier_names(
    db: AsyncSession, invoices: Sequence[Invoice | PastInvoice]
) -> None:
    """Attach `cashier_name` to invoice ORM rows before serialization."""
    if not invoices:
        return
    cashier_ids = {invoice.cashier_user_id for invoice in invoices}
    rows = (
        await db.execute(
            select(User.id, User.full_name).where(User.id.in_(cashier_ids))
        )
    ).all()
    cashier_name_by_id = {row.id: row.full_name for row in rows}
    for invoice in invoices:
        invoice.cashier_name = cashier_name_by_id.get(invoice.cashier_user_id)


def _invoice_snapshot(invoice: Invoice) -> dict:
    return {
        "invoice_id": invoice.id,
        "invoice_number": invoice.invoice_number,
        "total_amount": str(invoice.total_amount),
        "note": invoice.note,
        "lines": [
            {
                "product_id": line.product_id,
                "quantity": line.quantity,
                "unit_price": str(line.unit_price),
                "line_total": str(line.line_total),
            }
            for line in invoice.lines
        ],
        "payments": [
            {"mode": payment.mode.value, "amount": str(payment.amount)}
            for payment in invoice.payments
        ],
    }


async def validate_cart_quantities(
    db: AsyncSession, *, shop_id: int, cart: list[CartLine]
) -> list[ValidatedCartLine]:
    products = (
        await db.execute(
            select(Product).where(
                Product.shop_id == shop_id,
                Product.barcode.in_([line.barcode for line in cart]),
                Product.is_active.is_(True),
            )
        )
    ).scalars().all()
    by_barcode = {p.barcode: p for p in products}
    missing = sorted({line.barcode for line in cart if line.barcode not in by_barcode})
    if missing:
        raise CheckoutError("unknown_barcode", f"unknown or inactive barcodes in cart: {missing}")

    stock = await compute_derived_stock(db, product_ids=[p.id for p in products])
    return [
        ValidatedCartLine(
            barcode=line.barcode,
            requested_quantity=line.quantity,
            available_quantity=stock.get(by_barcode[line.barcode].id, 0),
            accepted_quantity=min(line.quantity, stock.get(by_barcode[line.barcode].id, 0)),
            adjusted=line.quantity > stock.get(by_barcode[line.barcode].id, 0),
        )
        for line in cart
    ]


async def list_current_invoices(
    db: AsyncSession,
    *,
    shop_id: int,
    date_from: date | None,
    date_to: date | None,
    cashier_user_id: int | None,
    payment_mode: PaymentMode | None,
    status: InvoiceStatus | None,
    limit: int,
    offset: int,
) -> list[Invoice]:
    stmt = (
        select(Invoice)
        .where(Invoice.shop_id == shop_id)
        .options(selectinload(Invoice.lines), selectinload(Invoice.payments))
    )
    if date_from is not None:
        stmt = stmt.where(Invoice.business_date >= date_from)
    if date_to is not None:
        stmt = stmt.where(Invoice.business_date <= date_to)
    if cashier_user_id is not None:
        stmt = stmt.where(Invoice.cashier_user_id == cashier_user_id)
    if status is not None:
        stmt = stmt.where(Invoice.status == status)
    if payment_mode is not None:
        stmt = stmt.where(
            exists().where(Payment.invoice_id == Invoice.id, Payment.mode == payment_mode)
        )
    stmt = stmt.order_by(Invoice.finalized_at.desc()).limit(limit).offset(offset)
    return list((await db.execute(stmt)).scalars().all())


async def list_past_invoices(
    db: AsyncSession,
    *,
    shop_id: int,
    date_from: date | None,
    date_to: date | None,
    cashier_user_id: int | None,
    payment_mode: PaymentMode | None,
    status: InvoiceStatus | None,
    limit: int,
    offset: int,
) -> list[PastInvoice]:
    from app.models.invoice import PastPayment

    stmt = (
        select(PastInvoice)
        .where(PastInvoice.shop_id == shop_id)
        .options(selectinload(PastInvoice.lines), selectinload(PastInvoice.payments))
    )
    if date_from is not None:
        stmt = stmt.where(PastInvoice.business_date >= date_from)
    if date_to is not None:
        stmt = stmt.where(PastInvoice.business_date <= date_to)
    if cashier_user_id is not None:
        stmt = stmt.where(PastInvoice.cashier_user_id == cashier_user_id)
    if status is not None:
        stmt = stmt.where(PastInvoice.status == status)
    if payment_mode is not None:
        stmt = stmt.where(
            exists().where(PastPayment.invoice_id == PastInvoice.id, PastPayment.mode == payment_mode)
        )
    stmt = stmt.order_by(PastInvoice.finalized_at.desc()).limit(limit).offset(offset)
    return list((await db.execute(stmt)).scalars().all())


async def edit_current_invoice(
    db: AsyncSession,
    *,
    invoice_id: int,
    shop_id: int,
    cart: list[CartLine],
    payments: list[PaymentLine],
    note: str | None,
) -> InvoiceEditResult:
    invoice = (
        await db.execute(
            select(Invoice)
            .where(Invoice.id == invoice_id, Invoice.shop_id == shop_id)
            .options(selectinload(Invoice.lines), selectinload(Invoice.payments))
            .with_for_update()
        )
    ).scalar_one_or_none()
    if invoice is None:
        raise CheckoutError("not_found", "invoice not found")
    if invoice.eod_signed_off:
        raise CheckoutError("eod_signed_off", "past or signed-off invoices are view-only")
    if invoice.status != InvoiceStatus.FINALIZED:
        raise CheckoutError("bad_status", f"cannot edit invoice in status {invoice.status.value}")

    before = _invoice_snapshot(invoice)
    submitted_codes = [line.barcode for line in cart]
    products = (
        await db.execute(
            select(Product)
            .where(
                Product.shop_id == shop_id,
                Product.barcode.in_(submitted_codes),
                Product.is_active.is_(True),
            )
            .with_for_update()
        )
    ).scalars().all()
    by_barcode = {p.barcode: p for p in products}
    missing = sorted({line.barcode for line in cart if line.barcode not in by_barcode})
    if missing:
        product_id_fallback = [int(code) for code in missing if code.isdigit()]
        if product_id_fallback:
            fallback_products = (
                await db.execute(
                    select(Product)
                    .where(
                        Product.shop_id == shop_id,
                        Product.id.in_(product_id_fallback),
                        Product.is_active.is_(True),
                    )
                    .with_for_update()
                )
            ).scalars().all()
            for product in fallback_products:
                by_barcode[str(product.id)] = product
            missing = sorted({line.barcode for line in cart if line.barcode not in by_barcode})
    if missing:
        raise CheckoutError("unknown_barcode", f"unknown or inactive barcodes in cart: {missing}")

    requested: dict[int, int] = {}
    for line in cart:
        product = by_barcode[line.barcode]
        requested[product.id] = requested.get(product.id, 0) + line.quantity
    original_qty = {line.product_id: line.quantity for line in invoice.lines}
    current_stock = await compute_derived_stock(db, product_ids=list(requested.keys() | original_qty.keys()))
    oversell = []
    for product_id, qty in requested.items():
        available_for_edit = current_stock.get(product_id, 0) + original_qty.get(product_id, 0)
        if qty > available_for_edit:
            oversell.append((product_id, qty, available_for_edit))
    if oversell:
        raise CheckoutError(
            "insufficient_stock",
            "insufficient stock for: "
            + ", ".join(f"product {pid} (requested {req}, available {avail})" for pid, req, avail in oversell),
        )

    total = Decimal("0")
    line_specs: list[tuple[Product, int, Decimal]] = []
    by_id = {p.id: p for p in products}
    for product_id, qty in requested.items():
        product = by_id[product_id]
        line_total = (product.price * qty).quantize(Decimal("0.01"))
        line_specs.append((product, qty, line_total))
        total += line_total
    total = total.quantize(Decimal("0.01"))
    validate_note_for_payments(payments=payments, note=note)
    paid = sum((payment.amount for payment in payments), Decimal("0")).quantize(Decimal("0.01"))
    if paid != total:
        raise CheckoutError("payment_mismatch", f"payment total {paid} does not match invoice total {total}")

    invoice.total_amount = total
    invoice.note = note
    invoice.lines.clear()
    invoice.payments.clear()
    await db.flush()
    for product, qty, line_total in line_specs:
        invoice.lines.append(
            InvoiceLine(
                product_id=product.id,
                quantity=qty,
                unit_price=product.price,
                line_total=line_total,
                product_brand=product.brand,
                product_size_label=product.size_label,
            )
        )
    for payment in payments:
        invoice.payments.append(
            Payment(mode=payment.mode, amount=payment.amount.quantize(Decimal("0.01")))
        )
    await db.flush()
    await db.refresh(invoice, attribute_names=["lines", "payments"])
    return InvoiceEditResult(invoice=invoice, before=before, after=_invoice_snapshot(invoice))
