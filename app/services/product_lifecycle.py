"""Product lifecycle — the single seam for the pending <-> active transition.

Architecture review (Candidate D, top recommendation, 2026-07-08):
the rule that ties a Product's status to its price was previously
expressed in four places — an `activate_product` handler that applied
it correctly, an `update_product` handler that didn't, a no-op
`@model_validator` on `ProductUpdate` that documented the rule but
didn't enforce it, and a CHECK constraint that surfaced the bug as
a 500. This module owns the rule end-to-end.

A bad PATCH now becomes a 400 (raised here, mapped by the router)
instead of a 500 (raised by the DB CHECK violation path). The
`apply_status_transition` function is the one place any future change
to the lifecycle invariant has to touch.

The rule itself (D-v2-5):

  active  -> price IS NOT NULL AND price > 0
  pending -> price IS NULL

`activate_product` flips a pending row to active iff the new price is
present and positive. `update_product` is a generic setter: a price
patch on a pending row flips the status to active (the "completion"
action, issue #25); a price patch on an active row is allowed (a
re-price); a None price on an active row is rejected (a re-deactivate
isn't a thing); a None price on a pending row is also rejected
because the only sensible way to leave the pending state is to set
a price, not to null it.
"""
from __future__ import annotations

from decimal import Decimal

from app.models.product import Product, ProductStatus


class ProductLifecycleError(Exception):
    """Raised when a status/price patch violates the lifecycle invariant.

    The router maps this to 400. Carries the offending fields so the
    cashier UI can render a specific message.
    """

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def _validate_status_price_pair(status: ProductStatus, price: Decimal | None) -> None:
    if status == ProductStatus.ACTIVE and (price is None or price <= 0):
        raise ProductLifecycleError(
            "active_requires_price",
            "an active product must have a price > 0",
        )
    if status == ProductStatus.PENDING and price is not None:
        raise ProductLifecycleError(
            "pending_requires_no_price",
            "a pending product must not have a price",
        )


def apply_status_transition(product: Product, *, price: Decimal | None) -> None:
    """Mutate ``product`` so the status/price invariant holds.

    Called by both `activate_product` (issue #25) and `update_product`
    (issue #22 follow-up). The caller has already merged any other
    fields (brand, size_label, threshold, is_active) onto the product;
    this function is responsible only for the price/status coupling.

    Raises ``ProductLifecycleError`` (400) on a violation rather than
    letting the DB CHECK raise an IntegrityError (500). The DB CHECK
    remains as a belt-and-braces backstop for direct-SQL writes.
    """
    if price is None:
        # The only valid target state for a null price is "pending",
        # and we don't currently support flipping an active row to
        # pending via PATCH. Deactivation lives on is_active=false
        # (and even there the price is preserved, not nulled).
        raise ProductLifecycleError(
            "price_required",
            "setting price to null is not supported; deactivate the product via is_active=false instead",
        )

    if product.status == ProductStatus.PENDING:
        # Completing a pending row by setting a price (D-v2-5).
        product.price = price
        product.status = ProductStatus.ACTIVE
    else:
        # Re-pricing an active product is fine.
        product.price = price
        # status stays active.

    # Final guard so any future caller that touches status first
    # still has to satisfy the invariant.
    _validate_status_price_pair(product.status, product.price)


__all__ = [
    "ProductLifecycleError",
    "apply_status_transition",
]