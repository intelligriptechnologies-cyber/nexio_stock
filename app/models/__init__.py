"""All ORM models live here. One module per aggregate root.

Every shop-scoped table carries a non-nullable `shop_id` foreign key (D-35,
R-17) so the schema is multi-tenant-ready from day one, even though only one
shop exists at launch (D-3).
"""
from __future__ import annotations

from app.models.invoice import (
    STATUSES_COUNTING_AS_SOLD,
    EodSignOff,
    IdempotencyKey,
    Invoice,
    InvoiceLine,
    InvoiceStatus,
    PastInvoice,
    PastInvoiceLine,
    PastPayment,
    Payment,
    PaymentMode,
)
from app.models.device import DeviceBinding
from app.models.log import AdminLog, InvoicingLog, LogFileRetentionSetting, StockinLog
from app.models.lot import Lot, LotLine
from app.models.stock_inward import StockInward, StockInwardLine, StockInwardStatus
from app.models.offline_session import (
    LOCKING_OFFLINE_STATES,
    OfflineSession,
    OfflineSessionState,
)
from app.models.product import MasterProduct, Product, ProductStatus
from app.models.shop import Shop
from app.models.user import User, UserRole
from app.models.vendor import Vendor

__all__ = [
    "LOCKING_OFFLINE_STATES",
    "STATUSES_COUNTING_AS_SOLD",
    "AdminLog",
    "EodSignOff",
    "IdempotencyKey",
    "DeviceBinding",
    "Invoice",
    "InvoiceLine",
    "InvoiceStatus",
    "InvoicingLog",
    "LogFileRetentionSetting",
    "Lot",
    "LotLine",
    "MasterProduct",
    "OfflineSession",
    "OfflineSessionState",
    "PastInvoice",
    "PastInvoiceLine",
    "PastPayment",
    "Payment",
    "PaymentMode",
    "Product",
    "ProductStatus",
    "Shop",
    "StockInward",
    "StockInwardLine",
    "StockInwardStatus",
    "StockinLog",
    "User",
    "UserRole",
    "Vendor",
]
