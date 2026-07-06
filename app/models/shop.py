"""Shop — the multi-tenant root.

A shop owns its users, products, lots, invoices, and logs. Provisioning a new
shop is a manual superadmin action (D-58). Shop-scoped data is filtered by
`shop_id` server-side on every query (R-17, R-21).
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Numeric, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base

if TYPE_CHECKING:
    from app.models.user import User


class Shop(Base):
    __tablename__ = "shops"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    # Shop-wide default for low-stock threshold (D-34). Per-product override
    # on `Product.low_stock_threshold` wins; NULL there falls back to this.
    # Lives here (not on Product) so a freshly-initialised catalog has a
    # sensible default before any per-product tuning (#7).
    low_stock_threshold_default: Mapped[int | None] = mapped_column(nullable=True)
    # Monotonic per-shop invoice counter. Incremented under the row lock
    # at checkout finalize so concurrent finalizes get distinct
    # invoice_numbers (see app.services.checkout).
    last_invoice_number: Mapped[int] = mapped_column(
        nullable=False, default=0, server_default="0"
    )
    # --- #8: GSTIN + excise-duty line on the invoice (D-23) ---
    # GSTIN is 15 chars for Indian state-level registrations. Stored
    # as a string, optional — set by the owner when the shop is
    # registered. The PDF renders this when present.
    gstin: Mapped[str | None] = mapped_column(String(15), nullable=True)
    # Excise / VAT duty rate as a percentage (e.g. Decimal("20.00")
    # for 20%). This is a configurable placeholder per D-23 — the
    # exact rate is to be confirmed against actual Odisha State Excise
    # Department rules before being relied on for filings. The PDF
    # surfaces it as a labelled placeholder line, not a CGST/SGST
    # breakdown. NULL means "don't show a tax line on the invoice".
    excise_duty_rate: Mapped[Decimal | None] = mapped_column(
        Numeric(8, 2), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    users: Mapped[list[User]] = relationship(back_populates="shop")
