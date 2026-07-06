"""Password hashing using bcrypt directly (no passlib — passlib is
unmaintained and incompatible with bcrypt >= 4).
"""
from __future__ import annotations

import bcrypt

from app.config import get_settings


def hash_password(plain: str) -> str:
    rounds = get_settings().bcrypt_rounds
    salt = bcrypt.gensalt(rounds=rounds)
    # bcrypt has a 72-byte secret limit. Truncate defensively; longer
    # passwords get a 72-byte prefix (matches the bcrypt reference impl).
    return bcrypt.hashpw(plain.encode("utf-8")[:72], salt).decode("ascii")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8")[:72], hashed.encode("ascii"))
    except (ValueError, TypeError):
        return False
