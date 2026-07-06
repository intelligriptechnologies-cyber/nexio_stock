"""`uv run barstock <command>` CLI entrypoint.

Commands for v1:
  - createsuperuser   bootstrap the first superadmin
  - createshop        create a shop (and its first owner) — manual D-58 flow

Both are intentionally simple, dev-facing helpers. They are not the path
real shop onboarding will use (superadmin runs them once at provisioning).
"""
from __future__ import annotations

import asyncio
import sys
from getpass import getpass

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.config import get_settings
from app.db import get_sessionmaker, init_db
from app.logging_config import configure_logging, get_logger
from app.models.shop import Shop
from app.models.user import User, UserRole
from app.security.passwords import hash_password


def _print(*args: object) -> None:
    print(*args, file=sys.stderr)


async def _createsuperadmin(username: str, password: str) -> None:
    settings = get_settings()
    if len(password) < 8:
        _print("password must be at least 8 characters")
        raise SystemExit(2)

    configure_logging(settings.log_level)
    log = get_logger("cli.createsuperuser")
    await init_db()
    Session = get_sessionmaker()

    async with Session() as session, session.begin():
        existing = (
            await session.execute(
                select(User).where(
                    User.username == username, User.role == UserRole.SUPERADMIN
                )
            )
        ).scalar_one_or_none()
        if existing is not None:
            _print(f"superadmin '{username}' already exists (id={existing.id})")
            return
        user = User(
            shop_id=None,
            role=UserRole.SUPERADMIN,
            username=username,
            full_name="Super Admin",
            phone="0000000000",  # superadmin is not a shop user; no real phone
            password_hash=hash_password(password),
            is_active=True,
        )
        session.add(user)
    log.info("cli.createsuperadmin.created", username=username)
    _print(f"superadmin '{username}' created")


async def _createshop(code: str, name: str, owner_username: str, owner_password: str) -> None:
    settings = get_settings()
    configure_logging(settings.log_level)
    log = get_logger("cli.createshop")
    await init_db()
    Session = get_sessionmaker()

    async with Session() as session, session.begin():
        shop = (await session.execute(select(Shop).where(Shop.code == code))).scalar_one_or_none()
        if shop is None:
            shop = Shop(code=code, name=name)
            session.add(shop)
            await session.flush()
            _print(f"shop '{code}' created (id={shop.id})")
        else:
            _print(f"shop '{code}' already exists (id={shop.id}); reusing")

        existing_owner = (
            await session.execute(
                select(User).where(
                    User.shop_id == shop.id,
                    User.username == owner_username,
                    User.role == UserRole.OWNER,
                )
            )
        ).scalar_one_or_none()
        if existing_owner is not None:
            _print(
                f"owner '{owner_username}' already exists in shop '{code}' "
                f"(id={existing_owner.id})"
            )
            return
        owner = User(
            shop_id=shop.id,
            role=UserRole.OWNER,
            username=owner_username,
            full_name="Shop Owner",
            phone="0000000001",  # placeholder; owner can update later
            password_hash=hash_password(owner_password),
            is_active=True,
        )
        session.add(owner)
        try:
            await session.flush()
        except IntegrityError as exc:
            await session.rollback()
            _print(f"failed to create owner: {exc.orig}")
            raise SystemExit(1) from exc
    log.info("cli.createshop.done", shop_code=code, owner_username=owner_username)
    _print(f"owner '{owner_username}' created in shop '{code}' (id={owner.id})")


def main(argv: list[str] | None = None) -> None:
    argv = argv if argv is not None else sys.argv[1:]

    if not argv or argv[0] in ("-h", "--help"):
        _print(
            "usage:\n"
            "  barstock createsuperuser [--username NAME] [--password PW]\n"
            "  barstock createshop --code CODE --name NAME --owner-username NAME "
            "[--owner-password PW]\n"
        )
        return

    cmd = argv[0]
    args = argv[1:]
    if cmd == "createsuperuser":
        username = None
        password = None
        i = 0
        while i < len(args):
            if args[i] == "--username" and i + 1 < len(args):
                username = args[i + 1]
                i += 2
            elif args[i] == "--password" and i + 1 < len(args):
                password = args[i + 1]
                i += 2
            else:
                _print(f"unknown arg: {args[i]}")
                raise SystemExit(2)
        if not username:
            username = input("superadmin username: ").strip()
        if not password:
            password = getpass("superadmin password (min 8): ")
        asyncio.run(_createsuperadmin(username, password))
    elif cmd == "createshop":
        code = None
        name = None
        owner_username = None
        owner_password = None
        i = 0
        while i < len(args):
            if args[i] == "--code" and i + 1 < len(args):
                code = args[i + 1]
                i += 2
            elif args[i] == "--name" and i + 1 < len(args):
                name = args[i + 1]
                i += 2
            elif args[i] == "--owner-username" and i + 1 < len(args):
                owner_username = args[i + 1]
                i += 2
            elif args[i] == "--owner-password" and i + 1 < len(args):
                owner_password = args[i + 1]
                i += 2
            else:
                _print(f"unknown arg: {args[i]}")
                raise SystemExit(2)
        if not all([code, name, owner_username]):
            _print("required: --code, --name, --owner-username")
            raise SystemExit(2)
        if not owner_password:
            owner_password = getpass("owner password (min 4): ")
        asyncio.run(_createshop(code, name, owner_username, owner_password))
    else:
        _print(f"unknown command: {cmd}")
        raise SystemExit(2)


if __name__ == "__main__":
    main()
