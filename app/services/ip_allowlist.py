"""Client IP parsing and allowlist matching for shop login controls."""
from __future__ import annotations

from collections.abc import Sequence
from ipaddress import ip_address, ip_network

from fastapi import Request


def resolve_client_ip(request: Request) -> str:
    """Return the best client IP signal for this deployment.

    Railway forwards the public client IP in ``X-Real-IP``. For local
    development and tests, fall back to FastAPI's peer address.
    """

    header = request.headers.get("x-real-ip", "").strip()
    if header:
        # Proxies should hand us a single public IP. If a chain appears,
        # use the first hop.
        return header.split(",", 1)[0].strip()

    if request.client is not None and request.client.host:
        return request.client.host

    return ""


def normalize_cidrs(values: Sequence[str]) -> list[str]:
    """Validate and canonicalize user-entered IPs/CIDRs.

    A bare IP becomes a host network (``/32`` or ``/128``). Duplicate
    entries are removed while preserving order.
    """

    normalized: list[str] = []
    seen: set[str] = set()
    for raw in values:
        value = raw.strip()
        if not value:
            raise ValueError("allowed_login_cidrs entries must not be blank")
        try:
            network = ip_network(value, strict=False)
        except ValueError as exc:
            raise ValueError(f"invalid CIDR/IP: {value}") from exc
        canonical = str(network)
        if canonical in seen:
            continue
        seen.add(canonical)
        normalized.append(canonical)
    return normalized


def client_ip_is_allowed(client_ip: str, allowed_cidrs: Sequence[str]) -> bool:
    """Check whether a client IP matches at least one allowlist entry."""

    if not allowed_cidrs:
        return True

    try:
        address = ip_address(client_ip)
    except ValueError:
        return False

    for raw in allowed_cidrs:
        try:
            network = ip_network(raw, strict=False)
        except ValueError:
            continue
        if address in network:
            return True
    return False
