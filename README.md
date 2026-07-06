# Barstock

Single-counter liquor shop inventory & billing system for a friend's shop in
Odisha, India. See `harness/03-prd.md` for the product requirements and
`harness/02-ledger.md` for the design decisions behind them.

## Stack

- Python 3.11, managed with `uv`
- FastAPI (OpenAPI/Swagger out of the box) on Uvicorn
- SQLAlchemy 2.0 async + Alembic
- Postgres 16 (Supabase / Railway in production; local docker-compose for dev/test)
- Pydantic v2 / pydantic-settings
- structlog for structured JSON logs to stdout
- passlib[bcrypt] + python-jose for auth (JWT)

## Quickstart

```bash
# 1. install deps
uv sync --extra dev

# 2. start local Postgres
docker compose up -d db

# 3. copy env, run migrations, create a superuser
cp .env.example .env
uv run alembic upgrade head
uv run barstock createsuperuser

# 4. run the API
uv run uvicorn app.main:app --reload

# 5. hit the docs
open http://127.0.0.1:8000/docs
```

## Tests

```bash
uv run pytest                    # run the suite
uv run pytest --cov=app          # with coverage
uv run ruff check .              # lint
uv run ruff format .             # format
```

Tests need a running Postgres on `localhost:5432` with the credentials from
`docker-compose.yml`. `tests/conftest.py` provisions a clean schema per test.

## Layout

```
app/
  main.py              # FastAPI app factory + lifespan
  config.py            # pydantic-settings (env)
  db.py                # async engine + session
  logging_config.py    # structlog setup
  models/              # SQLAlchemy 2.0 declarative models
  schemas/             # Pydantic v2 request/response models
  api/                 # routers + dependencies
  security/            # password hashing + JWT
  services/            # business logic when non-trivial
  cli.py               # `uv run barstock ...` entrypoint
alembic/               # migrations
tests/                 # mirrors app/
```
