#!/usr/bin/env python
"""Build layers.json by directory-structure heuristic on assembled-graph.

Phase-4 fallback when the LLM-dispatched architecture-analyzer is not
available in this session. Uses directory boundaries as the layer
boundary signal (per the skill note: 'Directory structure is strong
evidence for layer boundaries').

Input:  assembled-graph.json
Output: layers.json
"""
import json
from pathlib import Path

ROOT = Path(r"C:/barstock")
INTER = ROOT / ".understand-anything/intermediate"

# layer_id, name, description, glob pattern matched against file paths
LAYER_RULES = [
    (
        "layer:composition-root",
        "Composition root (app boot, settings, db engine, CLI, lifespan)",
        "app/main.py, app/config.py, app/db.py, app/logging_config.py, app/cli.py, app/__init__.py",
        lambda p: (
            p.startswith("app/")
            and "/" not in p[len("app/"):]
            and p[len("app/"):] in {
                "main.py",
                "config.py",
                "db.py",
                "logging_config.py",
                "cli.py",
                "__init__.py",
            }
        ),
    ),
    (
        "layer:security",
        "Security primitives (passwords, JWT)",
        "app/security/",
        lambda p: p.startswith("app/security/"),
    ),
    (
        "layer:domain-models",
        "Domain models (ORM)",
        "app/models/",
        lambda p: p.startswith("app/models/"),
    ),
    (
        "layer:schemas-dto",
        "Pydantic DTOs / schemas",
        "app/schemas/",
        lambda p: p.startswith("app/schemas/"),
    ),
    (
        "layer:business-services",
        "Business services (domain logic, isolated from HTTP)",
        "app/services/",
        lambda p: p.startswith("app/services/"),
    ),
    (
        "layer:http-interfaces",
        "HTTP transport (FastAPI routers, deps, errors)",
        "app/api/",
        lambda p: p.startswith("app/api/"),
    ),
    (
        "layer:tests",
        "Test suite",
        "tests/",
        lambda p: p.startswith("tests/"),
    ),
    (
        "layer:schema-migrations",
        "Alembic database migrations",
        "alembic/versions/ + alembic/env.py + alembic/script.py.mako",
        lambda p: p.startswith("alembic/versions/") or p in ("alembic/env.py", "alembic/script.py.mako"),
    ),
    (
        "layer:migration-config",
        "Alembic config + runtime",
        "alembic.ini, alembic/README, alembic/env.py",
        lambda p: p in ("alembic.ini", "alembic/README", "alembic/env.py"),
    ),
    (
        "layer:repo-config",
        "Repository infrastructure (Docker, env, gitignore, pyproject, uv.lock)",
        "repo root: pyproject.toml, uv.lock, docker-compose.yml, .env.example, .gitignore",
        lambda p: p in {
            "pyproject.toml",
            "uv.lock",
            "docker-compose.yml",
            ".env.example",
            ".gitignore",
            "Dockerfile",
        },
    ),
    (
        "layer:project-knowledge",
        "PRD + design ledger + issue tracking (harness/)",
        "harness/",
        lambda p: p.startswith("harness/"),
    ),
    (
        "layer:docs",
        "Project documentation (README, agent artifacts)",
        "README, agent caches",
        lambda p: p in {"README.md"} or p.startswith(".understand-anything/"),
    ),
]


def main():
    graph = json.loads((INTER / "assembled-graph.json").read_text())
    files = [n for n in graph["nodes"] if n.get("type") in ("file", "config", "document")]
    by_path = {n["path"]: n["id"] for n in files}

    layers = []
    assigned = set()
    for lid, name, desc, predicate in LAYER_RULES:
        node_ids = []
        for path, nid in by_path.items():
            if predicate(path) and nid not in assigned:
                node_ids.append(nid)
                assigned.add(nid)
        if node_ids:
            node_ids.sort()
            layers.append(
                {"id": lid, "name": name, "description": desc, "nodeIds": node_ids}
            )

    # Catch-all layer for anything still unassigned.
    orphans = [nid for nid in by_path.values() if nid not in assigned]
    if orphans:
        orphans.sort()
        layers.append(
            {
                "id": "layer:miscellaneous",
                "name": "Miscellaneous / unscoped",
                "description": (
                    "Files the heuristic layerer did not bucket. Typically "
                    "tooling artifacts (e.g. agentignore, mako templates) or "
                    "a typo-in-name branch. Treat as 'unclassified'."
                ),
                "nodeIds": orphans,
            }
        )

    (INTER / "layers.json").write_text(json.dumps({"layers": layers}, indent=2))
    print(f"wrote layers.json: {len(layers)} layers, {sum(len(l['nodeIds']) for l in layers)} nodes assigned")
    for layer in layers:
        print(f"  {layer['id']}: {len(layer['nodeIds'])} nodes — {layer['name']}")


if __name__ == "__main__":
    main()
