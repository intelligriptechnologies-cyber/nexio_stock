#!/usr/bin/env python
"""Build tour.json by hand-curating a learning path through the codebase.

Phase-5 fallback. The LLM tour-builder would produce LLM-quality
narrative; this delivers the bare structure (ordered steps with the
nodes to highlight per step).
"""
import json
from pathlib import Path

ROOT = Path(r"C:/barstock")
INTER = ROOT / ".understand-anything/intermediate"


# Hardcoded tour steps. Each step has an order, title, description,
# and a list of nodeIds from assembled-graph.json.
TOUR_STEPS = [
    {
        "order": 1,
        "title": "Project Overview",
        "description": (
            "Start with the harness/ directory (PRD, branch map, ledger, "
            "absences) and README to understand what Barstock is and the "
            "intent of the 8 incremental slices. The user's standing goal "
            "is 'complete all the issues, then do the GST invoice-line stub'; "
            "the harness files describe the absent decisions (D-numbers in "
            "02-ledger.md)."
        ),
        "nodeIds": ["file:README.md", "file:harness/05-issues/README.md"],
    },
    {
        "order": 2,
        "title": "Application Boot (Composition Root)",
        "description": (
            "app/main.py is the FastAPI app factory. Lifespan configures "
            "structured logging, opens the SQLAlchemy engine, and spawns "
            "the in-process low-stock evaluator. Routers are mounted in "
            "create_app(). Settings via app/config.py."
        ),
        "nodeIds": [
            "file:app/main.py",
            "file:app/config.py",
            "file:app/db.py",
            "file:app/logging_config.py",
            "file:app/cli.py",
        ],
    },
    {
        "order": 3,
        "title": "Domain Models (ORM)",
        "description": (
            "app/models/ holds all SQLAlchemy 2.0 ORM tables. Notice "
            "the strict layering: every shop-scoped table carries a "
            "non-nullable shop_id FK (D-35), InvoiceStatus enums align "
            "between issues (#5 added REVERSAL/PENDING_VOID; #6 added "
            "EodSignOff), and the 'what counts as sold' set is a module-"
            "level constant STATUSES_COUNTING_AS_SOLD (not on the enum "
            "class, since str-enum coerces plain class attributes to "
            "strings)."
        ),
        "nodeIds": [
            "file:app/models/__init__.py",
            "file:app/models/shop.py",
            "file:app/models/user.py",
            "file:app/models/product.py",
            "file:app/models/lot.py",
            "file:app/models/invoice.py",
            "file:app/models/log.py",
        ],
    },
    {
        "order": 4,
        "title": "Schemas — Pydantic DTOs",
        "description": (
            "app/schemas/ has the request/response shapes. Boundaries "
            "follow the slice ownership: auth/auth, product/product, "
            "lot/lot, checkout/checkout, eod/eod, shop/shop. Schemas "
            "use pydantic v2 — note the module_validator where fields "
            "cross-reference (catalog price + size must be independent "
            "per D-19)."
        ),
        "nodeIds": [
            "file:app/schemas/__init__.py",
            "file:app/schemas/auth.py",
            "file:app/schemas/product.py",
            "file:app/schemas/lot.py",
            "file:app/schemas/checkout.py",
            "file:app/schemas/eod.py",
            "file:app/schemas/shop.py",
        ],
    },
    {
        "order": 5,
        "title": "Business Services (the heart of the system)",
        "description": (
            "app/services/ holds the domain logic, HTTP-free. "
            "checkout.py runs the atomic finalize (FOR UPDATE row lock, "
            "idempotency replay, payment split); voids.py handles "
            "pre-EOD direct void and post-EOD pending-then-approved "
            "compensating entries; eod.py signs the day off; "
            "low_stock.py computes the at-threshold list; "
            "invoice_pdf.py renders the reportlab PDF."
        ),
        "nodeIds": [
            "file:app/services/checkout.py",
            "file:app/services/voids.py",
            "file:app/services/eod.py",
            "file:app/services/low_stock.py",
            "file:app/services/invoice_pdf.py",
        ],
    },
    {
        "order": 6,
        "title": "HTTP Interfaces (FastAPI routers)",
        "description": (
            "app/api/ has the HTTP transport layer. Each module "
            "groups a slice: auth/, staff/, products/, lots/, "
            "checkout/, voids/, dashboard/, shops/. deps.py has "
            "require_role() and the JWT decoder; _errors.py has "
            "the shared error-to-HTTP mapping (extracted during "
            "improve-arch). _test_only.py mounts placeholder gates "
            "in test mode."
        ),
        "nodeIds": [
            "file:app/api/__init__.py",
            "file:app/api/deps.py",
            "file:app/api/_errors.py",
            "file:app/api/_test_only.py",
            "file:app/api/health.py",
            "file:app/api/auth.py",
            "file:app/api/users.py",
            "file:app/api/staff.py",
            "file:app/api/products.py",
            "file:app/api/lots.py",
            "file:app/api/checkout.py",
            "file:app/api/voids.py",
            "file:app/api/dashboard.py",
            "file:app/api/shops.py",
        ],
    },
    {
        "order": 7,
        "title": "Auth & Security primitives",
        "description": (
            "app/security/ holds bcrypt (direct, not passlib — bcrypt "
            "4.x breaks passlib's version probe) and HS256 JWT. The "
            "Pydantic validator on bcrypt pre-trims to 72 bytes."
        ),
        "nodeIds": [
            "file:app/security/__init__.py",
            "file:app/security/passwords.py",
            "file:app/security/jwt.py",
        ],
    },
    {
        "order": 8,
        "title": "Schema Migrations",
        "description": (
            "alembic/versions/ is the schema's source of truth — one "
            "migration per slice (#1 foundation, #2 products, #3 lots, "
            "#4 invoices, #5 voids, #6 eod, #8 gst+excise). Migrations "
            "are committed in slice order; rollback is undoable."
        ),
        "nodeIds": [
            "file:alembic/env.py",
            "file:alembic/script.py.mako",
        ],
    },
    {
        "order": 9,
        "title": "Repository Configuration",
        "description": (
            "pyproject.toml pins Python 3.11 and declares the runtime "
            "(FastAPI, SQLAlchemy 2.0 async, asyncpg, bcrypt, structlog, "
            "reportlab) plus dev deps (pytest, ruff). docker-compose.yml "
            "starts postgres:16-alpine. .env.example shows the env shape."
        ),
        "nodeIds": [
            "file:pyproject.toml",
            "file:docker-compose.yml",
            "file:.env.example",
        ],
    },
    {
        "order": 10,
        "title": "Test Suite",
        "description": (
            "The test suite uses real Postgres (per R-13 row lock needs "
            "Postgres semantics — SQLite would mask bugs). conftest.py "
            "creates a per-session throwaway DB and runs alembic upgrade "
            "via subprocess. TRUNCATE clears shop-scoped tables per test. "
            "Each slice has its own test_*.py module."
        ),
        "nodeIds": [
            "file:tests/conftest.py",
        ],
    },
    {
        "order": 11,
        "title": "Project Knowledge (PRD + Ledger)",
        "description": (
            "harness/ holds the documents that drove the slice order: "
            "00-intake (the friend's original ask), 01-branch-map "
            "(dependency graph of the 8 slices), 02-ledger (the absent "
            "decisions catalog D-1..D-62), 03-prd (the frozen spec), "
            "04-absences (known unknowns)."
        ),
        "nodeIds": [
            "file:harness/00-intake.md",
            "file:harness/01-branch-map.md",
            "file:harness/02-ledger.md",
            "file:harness/03-prd.md",
            "file:harness/04-absences.md",
        ],
    },
]


def main():
    assembled = json.loads((INTER / "assembled-graph.json").read_text())
    node_ids_set = {n["id"] for n in assembled["nodes"]}

    steps = []
    for step in TOUR_STEPS:
        keep = [nid for nid in step["nodeIds"] if nid in node_ids_set]
        if not keep:
            continue
        steps.append(
            {
                "order": step["order"],
                "title": step["title"],
                "description": step["description"],
                "nodeIds": keep,
            }
        )
    steps.sort(key=lambda s: s["order"])
    (INTER / "tour.json").write_text(json.dumps({"tour": steps}, indent=2))
    print(f"wrote tour.json: {len(steps)} steps")


if __name__ == "__main__":
    main()
