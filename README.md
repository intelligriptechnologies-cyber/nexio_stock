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

## Setup (from zero to logged in)

This walks through everything needed on a fresh machine — local, a cloud IDE
(Codespaces/Gitpod-style), or a remote VM — to get the backend, frontend,
first shop, and first login all working.

### 0. Prerequisites

- Python 3.11+
- Node 18+
- Docker (for local Postgres) — or access to any Postgres 16 instance
- `uv` (Python package/venv manager):

  ```bash
  # either works
  pip install uv
  # or the official installer
  curl -LsSf https://astral.sh/uv/install.sh | sh
  ```

### 1. Backend: install, configure, migrate

```bash
uv sync --extra dev

# start local Postgres (skip if pointing at an existing instance)
docker compose up -d db

cp .env.example .env
uv run alembic upgrade head
```

Edit `.env` if your Postgres isn't the local docker-compose one (`DATABASE_URL`),
and see **Environment variables & CORS** below before you touch `CORS_ALLOW_ORIGINS` —
its correct value depends on where your browser will load the frontend from.

### 2. Create the first superadmin + shop

Superadmin is the cross-shop operator account; a shop needs its own owner
account. Both are provisioned via the CLI (there's no signup flow — D-58):

```bash
uv run barstock createsuperuser
# prompts for username/password if not passed via --username/--password

uv run barstock createshop \
  --code myshop \
  --name "My Shop" \
  --owner-username owner1 \
  --owner-phone 9876500001
# prompts for --owner-password if omitted
```

`--owner-phone` is required and must be a **real, globally unique** phone
number — not just unique within this shop. Login for owner/receiver/cashier
looks a user up by phone alone (it has no shop context yet), so phone is a
global uniqueness constraint across every shop in the system. Re-running
`createshop` with a phone already used by another shop's owner will fail
with a clear "already exists" error rather than silently succeeding.

### 3. Run the backend

```bash
uv run uvicorn app.main:app --reload
```

Confirm it's up: `http://127.0.0.1:8000/docs` (adjust host/port if you're on
a remote box — see below).

### 4. Frontend: install, configure, run

```bash
cd frontend
npm install
cp .env.example .env
```

Set `VITE_API_BASE` in `frontend/.env` to wherever your browser can reach the
backend (see **Environment variables & CORS** — this is *not* always
`127.0.0.1:8000`). Then:

```bash
npm run dev
```

Open the URL Vite prints (default `http://127.0.0.1:5173`, or your forwarded
URL on a cloud IDE/remote box).

### 5. Log in

- **Owner** (or receiver_user/cashier_user once created): the main login
  screen is a phone + password PIN pad — enter the phone/password from step 2.
- **Superadmin**: click "Superadmin login" on that screen (or go directly to
  `/login/superadmin`) and log in with username + password from step 2.

A successful login redirects automatically: owner → `/dashboard`,
superadmin → `/admin`, receiver_user → `/receiving`, cashier_user → `/checkout`.
If you land back on the login screen with an error instead, it's almost
always the CORS/API-base mismatch described next — not a login bug.

### 6. Create staff accounts (receiver_user / cashier_user)

Only the owner (or superadmin) can create these, and only via the API —
there's no CLI for it. Log in as owner in the frontend, then use the
Swagger UI at `/docs` (Authorize with the Bearer token, or copy it from
`sessionStorage.getItem("barstock.token")` in devtools) to `POST /staff`:

```json
{
  "role": "cashier_user",
  "username": "cashier1",
  "full_name": "Cashier One",
  "phone": "9876500002",
  "password": "somepassword"
}
```

Same global-phone-uniqueness rule applies — pick a phone not already used by
any user in any shop.

## Environment variables & CORS

The backend and frontend run as two separate processes/origins, so two
settings have to agree with **where your browser actually is**, not where
the processes happen to run:

- `CORS_ALLOW_ORIGINS` (backend `.env`, JSON array) — every origin your
  browser will load the frontend from. The backend rejects (silently, from
  the browser's point of view) any origin not in this list.
- `VITE_API_BASE` (frontend `.env`) ??? the URL your browser will use to reach
  the backend API. This is baked in at dev-server start time, not runtime ???
  restart `npm run dev` after changing it. In production, point this at the
  custom backend domain (for example `https://bstock.nexiohyper.com`) and
  rebuild the frontend after any change.

Both are read once at process startup (`.env` isn't hot-reloaded), so
**restart both dev servers after editing either file**.

Operational rule: `CORS_ALLOW_ORIGINS` is the backend's complete browser-origin
allowlist. If you add a custom frontend domain, add that exact origin there
and restart or redeploy the backend. Only rebuild the frontend when
`VITE_API_BASE` changes.

Symptom of getting this wrong: the backend logs a normal `200 OK` for the
login request, but the browser shows a backend reachability error ??? the
request succeeded server-side but the browser couldn't read the cross-origin
response, or couldn't reach the API host at all.

Pick the pattern that matches your setup:

| Where you run it | `CORS_ALLOW_ORIGINS` should include | `VITE_API_BASE` should be |
|---|---|---|
| Local machine | `http://127.0.0.1:5173`, `http://localhost:5173` (already the default) | `http://127.0.0.1:8000` (already the default) |
| Cloud IDE with forwarded ports (Codespaces, Gitpod, etc.) | the forwarded **frontend** URL, e.g. `https://<forwarded-id>-5173.<cloud-domain>` | the forwarded **backend** URL, e.g. `https://<forwarded-id>-8000.<cloud-domain>` |
| Remote VM / server | `http://<server-host-or-ip>:5173` (or `https://` behind a reverse proxy) | `http://<server-host-or-ip>:8000` (or `https://` behind a reverse proxy) |

If your platform's forwarded URLs change on every rebuild (common for cloud
IDEs), you'll need to update both values again after a rebuild.

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
