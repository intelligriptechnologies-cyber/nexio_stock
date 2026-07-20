"""Business rules for guarded cashier offline sessions."""
from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api._logs import write_business_log
from app.models.invoice import IdempotencyKey
from app.models.log import InvoicingLog
from app.models.offline_session import (
    LOCKING_OFFLINE_STATES,
    OfflineSession,
    OfflineSessionState,
)
from app.models.product import Product, ProductStatus
from app.models.shop import Shop
from app.services.calendar import today_local_date
from app.schemas.offline_session import (
    OfflineCatalogItem,
    OfflineReceiptIn,
    OfflineReceiptSyncMapping,
)
from app.security.jwt import create_access_token
from app.services.checkout import (
    CartLine,
    PaymentLine,
    finalize_checkout,
)
from app.services.stock import compute_derived_stock

INITIAL_SESSION_HOURS = 6
EXTENSION_HOURS = 2
MAX_EXTENSION_COUNT = 1


class OfflineSessionError(Exception):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class StartedOfflineSession:
    session: OfflineSession
    offline_token: str
    catalog: list[OfflineCatalogItem]


@dataclass
class SyncedOfflineSession:
    session: OfflineSession
    mappings: list[OfflineReceiptSyncMapping]
    is_replay: bool


def _now() -> datetime:
    return datetime.now(UTC)


def _offline_token(session: OfflineSession) -> str:
    ttl_seconds = max(60, int((session.max_expires_at - _now()).total_seconds()))
    ttl_minutes = max(1, (ttl_seconds + 59) // 60)
    return create_access_token(
        sub=str(session.cashier_user_id),
        shop_id=session.shop_id,
        role="cashier_user",
        extra={"token_type": "offline_session", "offline_session_id": session.id},
        ttl_minutes=ttl_minutes,
    )


async def expire_overdue_sessions(db: AsyncSession, *, shop_id: int | None = None) -> None:
    """Mark overdue active/preparing sessions expired.

    Failed sessions intentionally remain locking: they represent receipts
    that reached sync resolution and still require retry or owner discard.
    """
    stmt = select(OfflineSession).where(
        OfflineSession.state.in_(
            [OfflineSessionState.PREPARING, OfflineSessionState.ACTIVE]
        ),
        OfflineSession.expires_at <= _now(),
    )
    if shop_id is not None:
        stmt = stmt.where(OfflineSession.shop_id == shop_id)
    rows = (await db.execute(stmt)).scalars().all()
    now = _now()
    for row in rows:
        row.state = OfflineSessionState.EXPIRED
        row.expired_at = now
        row.state_changed_at = now


async def find_locking_session(
    db: AsyncSession, *, shop_id: int
) -> OfflineSession | None:
    await expire_overdue_sessions(db, shop_id=shop_id)
    return (
        await db.execute(
            select(OfflineSession)
            .where(
                OfflineSession.shop_id == shop_id,
                OfflineSession.state.in_(list(LOCKING_OFFLINE_STATES)),
            )
            .order_by(OfflineSession.started_at.desc(), OfflineSession.id.desc())
        )
    ).scalars().first()


async def ensure_shop_not_offline_locked(
    db: AsyncSession, *, shop_id: int, action: str
) -> None:
    session = await find_locking_session(db, shop_id=shop_id)
    if session is not None:
        raise OfflineSessionError(
            "offline_session_active",
            (
                f"shop {shop_id} is locked by offline session {session.id} "
                f"({session.state.value}); {action} is blocked until sync, "
                "owner discard, or expiry"
            ),
        )


async def start_offline_session(
    db: AsyncSession,
    *,
    shop_id: int,
    cashier_user_id: int,
) -> StartedOfflineSession:
    shop = (
        await db.execute(select(Shop).where(Shop.id == shop_id).with_for_update())
    ).scalar_one()
    existing = await find_locking_session(db, shop_id=shop_id)
    if existing is not None:
        raise OfflineSessionError(
            "offline_session_active",
            f"shop already has offline session {existing.id} in state {existing.state.value}",
        )

    products = (
        await db.execute(
            select(Product)
            .where(
                Product.shop_id == shop_id,
                Product.is_active.is_(True),
                Product.status == ProductStatus.ACTIVE,
                Product.price.is_not(None),
            )
            .order_by(Product.brand.asc(), Product.size_label.asc(), Product.id.asc())
        )
    ).scalars().all()
    stock = await compute_derived_stock(db, product_ids=[p.id for p in products])
    catalog = [
        OfflineCatalogItem(
            id=p.id,
            barcode=p.barcode,
            brand=p.brand,
            size_label=p.size_label,
            price=p.price,
            current_stock=stock.get(p.id, 0),
        )
        for p in products
    ]
    now = _now()
    expires_at = now + timedelta(hours=INITIAL_SESSION_HOURS)
    max_expires_at = expires_at + timedelta(hours=EXTENSION_HOURS)
    session = OfflineSession(
        shop_id=shop_id,
        cashier_user_id=cashier_user_id,
        state=OfflineSessionState.ACTIVE,
        baseline_business_date=today_local_date(),
        baseline_catalog_snapshot={
            "captured_at": now.isoformat(),
            "item_count": len(catalog),
            "items": [item.model_dump(mode="json") for item in catalog],
        },
        baseline_stock_snapshot={
            "captured_at": now.isoformat(),
            "items": [
                {"product_id": item.id, "barcode": item.barcode, "stock": item.current_stock}
                for item in catalog
            ],
        },
        server_last_invoice_number=shop.last_invoice_number or 0,
        expires_at=expires_at,
        max_expires_at=max_expires_at,
        started_at=now,
        state_changed_at=now,
    )
    db.add(session)
    await db.flush()
    return StartedOfflineSession(
        session=session,
        offline_token=_offline_token(session),
        catalog=catalog,
    )


async def get_active_session(
    db: AsyncSession, *, shop_id: int
) -> OfflineSession | None:
    return await find_locking_session(db, shop_id=shop_id)


async def extend_offline_session(
    db: AsyncSession,
    *,
    session_id: int,
    actor_user_id: int,
) -> tuple[OfflineSession, str]:
    session = (
        await db.execute(
            select(OfflineSession)
            .where(OfflineSession.id == session_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if session is None:
        raise OfflineSessionError("not_found", "offline session not found")
    await expire_overdue_sessions(db, shop_id=session.shop_id)
    await db.refresh(session)
    if session.cashier_user_id != actor_user_id:
        raise OfflineSessionError("not_session_cashier", "only the session cashier can extend it")
    if session.state != OfflineSessionState.ACTIVE:
        raise OfflineSessionError(
            "bad_state", f"cannot extend offline session in state {session.state.value}"
        )
    if session.extension_count >= MAX_EXTENSION_COUNT:
        raise OfflineSessionError("extension_used", "offline session extension is already used")
    now = _now()
    session.extension_count += 1
    session.expires_at = min(
        session.max_expires_at, session.expires_at + timedelta(hours=EXTENSION_HOURS)
    )
    session.state_changed_at = now
    return session, _offline_token(session)


async def discard_offline_session(
    db: AsyncSession,
    *,
    session_id: int,
    actor_user_id: int,
    reason: str,
) -> OfflineSession:
    session = (
        await db.execute(
            select(OfflineSession)
            .where(OfflineSession.id == session_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if session is None:
        raise OfflineSessionError("not_found", "offline session not found")
    if session.state in {
        OfflineSessionState.SYNCED,
        OfflineSessionState.DISCARDED,
        OfflineSessionState.EXPIRED,
    }:
        raise OfflineSessionError(
            "bad_state", f"cannot discard offline session in state {session.state.value}"
        )
    now = _now()
    session.state = OfflineSessionState.DISCARDED
    session.discard_reason = reason
    session.discarded_by_user_id = actor_user_id
    session.discarded_at = now
    session.state_changed_at = now
    return session


def _receipt_total(receipt: OfflineReceiptIn) -> Decimal:
    return sum((p.amount for p in receipt.payments), Decimal("0")).quantize(Decimal("0.01"))


async def sync_offline_session(
    db: AsyncSession,
    *,
    session_id: int,
    actor_user_id: int,
    receipts: Iterable[OfflineReceiptIn],
) -> SyncedOfflineSession:
    session = (
        await db.execute(
            select(OfflineSession)
            .where(OfflineSession.id == session_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if session is None:
        raise OfflineSessionError("not_found", "offline session not found")
    if session.cashier_user_id != actor_user_id:
        raise OfflineSessionError("not_session_cashier", "only the session cashier can sync it")
    if session.state == OfflineSessionState.SYNCED and session.sync_result:
        return SyncedOfflineSession(
            session=session,
            mappings=[
                OfflineReceiptSyncMapping(**row)
                for row in session.sync_result.get("mappings", [])
            ],
            is_replay=True,
        )
    if session.state in {OfflineSessionState.DISCARDED, OfflineSessionState.EXPIRED}:
        raise OfflineSessionError(
            "bad_state", f"cannot sync offline session in state {session.state.value}"
        )
    if session.state not in {
        OfflineSessionState.ACTIVE,
        OfflineSessionState.FAILED,
        OfflineSessionState.SYNCING,
    }:
        raise OfflineSessionError(
            "bad_state", f"cannot sync offline session in state {session.state.value}"
        )
    if session.state == OfflineSessionState.ACTIVE and session.expires_at <= _now():
        now = _now()
        session.state = OfflineSessionState.EXPIRED
        session.expired_at = now
        session.state_changed_at = now
        raise OfflineSessionError("expired", "offline session expired before sync")

    receipt_list = list(receipts)
    if not receipt_list:
        raise OfflineSessionError("empty_batch", "sync batch must contain at least one receipt")
    duplicate_temp_ids = {
        r.temp_receipt_id
        for r in receipt_list
        if sum(1 for x in receipt_list if x.temp_receipt_id == r.temp_receipt_id) > 1
    }
    if duplicate_temp_ids:
        raise OfflineSessionError(
            "duplicate_temp_receipt_id",
            f"duplicate temporary receipt ids: {sorted(duplicate_temp_ids)}",
        )
    duplicate_keys = {
        r.idempotency_key
        for r in receipt_list
        if sum(1 for x in receipt_list if x.idempotency_key == r.idempotency_key) > 1
    }
    if duplicate_keys:
        raise OfflineSessionError(
            "duplicate_idempotency_key",
            f"duplicate idempotency keys: {sorted(duplicate_keys)}",
        )

    consumed = (
        await db.execute(
            select(IdempotencyKey.key).where(
                IdempotencyKey.shop_id == session.shop_id,
                IdempotencyKey.key.in_([r.idempotency_key for r in receipt_list]),
            )
        )
    ).scalars().all()
    if consumed:
        raise OfflineSessionError(
            "idempotency_key_consumed",
            f"idempotency key already consumed: {sorted(consumed)[0]}",
        )

    now = _now()
    session.state = OfflineSessionState.SYNCING
    session.sync_attempts += 1
    session.state_changed_at = now
    session.failure_reason = None
    shop = await db.get(Shop, session.shop_id)

    mappings: list[OfflineReceiptSyncMapping] = []
    gross_total = Decimal("0")
    for receipt in receipt_list:
        result = await finalize_checkout(
            db,
            shop_id=session.shop_id,
            cashier_user_id=session.cashier_user_id,
            cart=[CartLine(barcode=line.barcode, quantity=line.quantity) for line in receipt.lines],
            payments=[
                PaymentLine(mode=payment.mode, amount=payment.amount)
                for payment in receipt.payments
            ],
            idempotency_key=receipt.idempotency_key,
            note=receipt.note,
        )
        invoice = result.invoice
        await db.flush()
        await db.refresh(invoice, attribute_names=["lines", "payments"])
        gross_total += _receipt_total(receipt)
        mappings.append(
            OfflineReceiptSyncMapping(
                temp_receipt_id=receipt.temp_receipt_id,
                invoice_id=invoice.id,
                invoice_number=invoice.invoice_number,
            )
        )
        write_business_log(
            db,
            InvoicingLog,
            event_type="invoice.finalized",
            actor_id=actor_user_id,
            shop_id=session.shop_id,
            shop_log_scope_key=shop.log_scope_key,
            shop_created_at=shop.created_at,
            payload={
                "source": "offline_session_sync",
                "offline_session_id": session.id,
                "temp_receipt_id": receipt.temp_receipt_id,
                "invoice_id": invoice.id,
                "invoice_number": invoice.invoice_number,
                "total_amount": str(invoice.total_amount),
                "payments": [
                    {"mode": p.mode.value, "amount": str(p.amount)}
                    for p in invoice.payments
                ],
                "lines": [
                    {
                        "product_id": line.product_id,
                        "quantity": line.quantity,
                        "unit_price": str(line.unit_price),
                        "line_total": str(line.line_total),
                    }
                    for line in invoice.lines
                ],
            },
        )

    now = _now()
    session.state = OfflineSessionState.SYNCED
    session.receipt_count = len(receipt_list)
    session.receipt_counter = len(receipt_list)
    session.gross_total = gross_total
    session.sync_result = {
        "synced_at": now.isoformat(),
        "mappings": [m.model_dump(mode="json") for m in mappings],
    }
    session.synced_at = now
    session.state_changed_at = now
    return SyncedOfflineSession(session=session, mappings=mappings, is_replay=False)


async def mark_sync_failed(
    db: AsyncSession,
    *,
    session_id: int,
    code: str,
    message: str,
) -> None:
    session = await db.get(OfflineSession, session_id)
    if session is None or session.state in {
        OfflineSessionState.SYNCED,
        OfflineSessionState.DISCARDED,
        OfflineSessionState.EXPIRED,
    }:
        return
    now = _now()
    session.state = OfflineSessionState.FAILED
    session.failure_reason = {"code": code, "message": message, "failed_at": now.isoformat()}
    session.state_changed_at = now
    await db.commit()


async def mark_session_expired(db: AsyncSession, *, session_id: int) -> None:
    session = await db.get(OfflineSession, session_id)
    if session is None or session.state in {
        OfflineSessionState.SYNCED,
        OfflineSessionState.DISCARDED,
        OfflineSessionState.EXPIRED,
    }:
        return
    now = _now()
    session.state = OfflineSessionState.EXPIRED
    session.expired_at = now
    session.state_changed_at = now
    await db.commit()


__all__ = [
    "OfflineSessionError",
    "StartedOfflineSession",
    "SyncedOfflineSession",
    "discard_offline_session",
    "ensure_shop_not_offline_locked",
    "extend_offline_session",
    "find_locking_session",
    "get_active_session",
    "mark_session_expired",
    "mark_sync_failed",
    "start_offline_session",
    "sync_offline_session",
]
