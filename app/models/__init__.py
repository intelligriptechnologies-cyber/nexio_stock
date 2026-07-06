"""All ORM models live here. One module per aggregate root.

Every shop-scoped table carries a non-nullable `shop_id` foreign key (D-35,
R-17) so the schema is multi-tenant-ready from day one, even though only one
shop exists at launch (D-3).
"""
from __future__ import annotations

from app.models.invoice import (
    IdempotencyKey,
    Invoice,
    InvoiceLine,
    InvoiceStatus,
    Payment,
    PaymentMode,
)
from app.models.log import AdminLog, InvoicingLog, StockinLog
from app.models.lot import Lot, LotLine
from app.models.product import Product
from app.models.shop import Shop
from app.models.user import User, UserRole

__all__ = [
    "AdminLog",
    "IdempotencyKey",
    "Invoice",
    "InvoiceLine",
    "InvoiceStatus",
    "InvoicingLog",
    "Lot",
    "LotLine",
    "Payment",
    "PaymentMode",
    "Product",
    "Shop",
    "StockinLog",
    "User",
    "UserRole",
]
