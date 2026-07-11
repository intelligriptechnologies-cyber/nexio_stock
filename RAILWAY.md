# Deploying Barstock to Railway

This covers two things:

1. **Deploying** the backend (FastAPI) and frontend (Vite SPA) to Railway.
2. **Managing users** (superadmin, shops, owners, cashiers, receivers) via the CLI once it's deployed.

Written so someone who has never touched this project's Railway setup before can follow it end to end.

## 0. Prerequisites

- Node.js installed locally (for the Railway CLI installer).
- A Railway account with access to the project (or permission to create one).
- This repo cloned locally, current directory `C:\barstock` (or wherever you cloned it).

## 1. Install and log in to the Railway CLI

```
bash <( curl -fsSL railway.com/install.sh )
```

Login **must** happen from a real terminal window (Windows Terminal / PowerShell / Git Bash) — it needs a real TTY. It will not work from a piped/non-interactive shell (e.g. inside some automation tools).

```
railway login
```

This opens a browser to authorize. Confirm it worked:

```
railway whoami
```

## 2. Link this directory to the Railway project

If the project already exists (ask a teammate for the name, or check the Railway dashboard):

```
cd C:\barstock
railway link
```

Follow the prompts to pick the workspace and project. This creates a mapping in `~/.railway/config.json` keyed to `C:\barstock` — **the CLI uses this directory-to-project mapping**, so always run Railway commands from the repo root, not from a subdirectory (see the frontend gotcha in step 5).

(Only if starting completely from scratch, with no project yet: `railway init --name barstock` creates a brand new project instead of linking to an existing one.)

## 3. The three services in this project

| Service    | What it is                        | Root context      |
|------------|------------------------------------|--------------------|
| `Postgres` | Managed Postgres database          | n/a (plugin)        |
| `backend`  | FastAPI app (this repo's root)     | repo root (`.`)     |
| `frontend` | Vite/React SPA                     | `frontend/`         |

All three already exist if the project was set up before. To check:

```
railway status
```

If a service is missing, create it:

```
railway add -d postgres          # creates the Postgres plugin
railway add -s backend           # creates an empty service named "backend"
railway add -s frontend          # creates an empty service named "frontend"
```

## 4. Required environment variables

Set these once per service. Values only need to be set again if they change.

**`backend`** service variables:

```
railway variable set -s backend \
  'DATABASE_URL=postgresql+asyncpg://${{Postgres.PGUSER}}:${{Postgres.PGPASSWORD}}@${{Postgres.PGHOST}}:${{Postgres.PGPORT}}/${{Postgres.PGDATABASE}}' \
  'SECRET_KEY=<a random 32+ char string, e.g. output of: openssl rand -hex 32>' \
  'APP_ENV=production' \
  'CORS_ALLOW_ORIGINS=["https://<your-frontend-domain>"]'
```

Notes:
- `DATABASE_URL` uses `${{Postgres.VAR}}` syntax to reference the Postgres service's own variables live — you never need to copy/paste the password.
- The `+asyncpg` in the scheme is required; Railway's own `DATABASE_URL` default (`postgresql://…`) will NOT work with this app's SQLAlchemy async driver.
- `CORS_ALLOW_ORIGINS` must be updated (and the backend redeployed — see step 8) any time the frontend's domain changes. If both apex and `www` custom domains are usable, include both exact origins (for example, `https://barstock-dev.nexiohyper.com` and `https://www.barstock-dev.nexiohyper.com`). Do not use `*`; credential-capable CORS requires explicit origins.

**`frontend`** service variables:

```
railway variable set -s frontend \
  'VITE_API_BASE=https://<your-backend-domain>'
```

This is a **build-time** variable (Vite bakes it into the JS bundle), so changing it requires a rebuild/redeploy of the frontend, not just a restart.

To check what's set on a service at any time:

```
railway variable -s backend -k
railway variable -s frontend -k
```

## 5. Deploying

### Backend

Deploy from the **repo root** (backend's root context is `.`):

```
cd C:\barstock
railway up -s backend --ci
```

`--ci` streams build logs and exits when done instead of tailing forever.

### Frontend

**Gotcha:** the Railway CLI resolves the linked project from the directory-to-project mapping in `~/.railway/config.json`, keyed to the exact path you ran `railway link`/`init` from (`C:\barstock`). If you `cd frontend` and run `railway up` there, the CLI still finds the mapping by walking up to `C:\barstock` and **uploads the repo root as the build context**, not `frontend/` — silently deploying the wrong thing. Always deploy the frontend like this instead, from the repo root, with an explicit path:

```
cd C:\barstock
railway up frontend -s frontend --ci --path-as-root
```

Railway's build system (Railpack) auto-detects the Vite static build and serves `dist/` via Caddy automatically — **do not** add a `Procfile` to `frontend/` for this. The runtime image for a static site has no Node/npx in it, so a Procfile like `web: npx serve -s dist -l $PORT` will crash-loop with `npx: command not found`. Let Railpack's default static-site handling do it.

### Generating public URLs (first time only)

```
railway domain -s backend
railway domain -s frontend
```

Each prints a `https://<name>-production-xxxx.up.railway.app` URL. Do this once per service; the URL is stable across redeploys.

### Verifying a deploy

```
railway logs -s backend --deployment
railway logs -s frontend --deployment
```

Backend has two health endpoints (not `/health` — that 404s):

```
curl https://<backend-domain>/healthz   # liveness
curl https://<backend-domain>/readyz    # DB connectivity check
```

## 6. Known deploy fix baked into this repo

Two files at the repo root exist specifically to make Railway deploys work — **do not delete them**:

- **`.python-version`** (`3.11`) — `pyproject.toml` pins `requires-python = ">=3.11,<3.12"`, but Railway's build system (Railpack) defaults to Python 3.13 if nothing tells it otherwise. Without this file, the build succeeds but the container crash-loops at startup with `error: No interpreter found for Python ==3.11.*` because runtime Python downloads are disabled. `.python-version` forces Railpack to use 3.11 for both build and runtime, keeping them in sync.
- **`Procfile`** (repo root) — tells Railway how to start the backend:
  ```
  web: uv run alembic upgrade head && uv run uvicorn app.main:app --host 0.0.0.0 --port $PORT
  ```
  This runs DB migrations automatically on every deploy, then starts the server on Railway's dynamically-assigned `$PORT`.

## 7. Updating env vars after a service is already deployed

Setting a variable does **not** restart the running container by itself:

```
railway variable set -s backend 'CORS_ALLOW_ORIGINS=["https://new-domain","https://www.new-domain"]'
```

`railway redeploy -s backend -y` is unreliable for services deployed via CLI upload (as opposed to a GitHub-connected deploy) — it may silently no-op. The reliable way to pick up new env vars is to force a fresh deploy the same way you deployed originally:

```
cd C:\barstock
railway up -s backend --ci
```

## 8. Committing deploy config changes

`Procfile` and `.python-version` must be committed to git — if they only exist in your local working directory, the next person who clones `main` and deploys will hit the same Python-version crash loop this doc describes in step 6. Check before deploying:

```
git status --short Procfile .python-version
```

Both should show as tracked/clean, not `??` (untracked).

---

# User / Shop Management via CLI

Once the backend is deployed and healthy, use these commands to bootstrap accounts. All commands run **inside the actual deployed container** via `railway ssh`, so they have network access to the production database — no local DB connection needed.

## Roles in this app

| Role             | Scope           | Created by                          |
|------------------|-----------------|--------------------------------------|
| `superadmin`     | Cross-shop       | CLI only (`createsuperuser`)         |
| `owner`          | One shop         | CLI only (`createshop`)              |
| `cashier_user`   | One shop         | Owner, via the `/staff` API endpoint |
| `receiver_user`  | One shop         | Owner, via the `/staff` API endpoint |

Login is by **phone + password** for owner/cashier/receiver, and **username + password** for superadmin. Every phone number must be globally unique across the whole system (not just per-shop) — pick distinct numbers for every account you create.

## Create a superadmin

```
railway ssh -s backend -- uv run barstock createsuperuser --username <name> --password <pw>
```

- `<pw>` must be at least 8 characters.
- If you omit `--username`/`--password`, the command prompts interactively — only works if you're running `railway ssh` from a real terminal, not through an automated/non-TTY tool.
- Superadmin logs in with **username + password** at `POST /auth/login/superadmin`, not the phone-based `/auth/login`.

## Create a shop + its owner

```
railway ssh -s backend -- uv run barstock createshop \
  --code <ShopCode> --name <ShopName> \
  --owner-username <OwnerUsername> --owner-phone <UniquePhone> --owner-password <pw>
```

- `<pw>` must be at least 4 characters.
- **Avoid spaces** in `--name` (e.g. use `Nexio_DemoShop`, not `"Nexio Demo Shop"`) — quoting gets mangled when `railway ssh` forwards the command remotely, and a space in the middle gets parsed as a separate unknown argument.
- `<UniquePhone>` must be 7-15 digits, and not already used by any other account in the system.
- Re-running with the same `--code` is safe — it detects the existing shop and reuses it instead of erroring, but will refuse to create a duplicate owner username within that shop.

This only creates the shop and its single owner account. Cashiers and receivers are NOT created here — they're created by the owner through the API (next section).

## Create a cashier or receiver (via API, as the owner)

**Step 1 — log in as the owner** to get an access token:

```
curl -X POST https://<backend-domain>/auth/login \
  -H "Content-Type: application/json" \
  -d '{"phone":"<owner-phone>","password":"<owner-pw>"}'
```

Copy the `access_token` value from the JSON response.

**Step 2 — create the staff account**, using that token:

```
curl -X POST https://<backend-domain>/staff \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "role": "cashier_user",
    "username": "<Username>",
    "full_name": "<Full Name>",
    "phone": "<UniquePhone>",
    "password": "<pw>"
  }'
```

- `role` must be exactly `"cashier_user"` or `"receiver_user"` — `"owner"` is rejected (owners can only be created by the `createshop` CLI command, not through this endpoint).
- `password` must be at least 4 characters.
- `phone` must be unique across the whole system, same rule as above.
- The access token from step 1 expires (`expires_in` field in the login response, in seconds) — if it's stale, just log in again.

## Quick reference: demo shop example

This is exactly the sequence used to set up a demo shop end to end (adjust names/phones/passwords for your own use):

```
# 1. Shop + owner
railway ssh -s backend -- uv run barstock createshop \
  --code MyShop --name MyShop \
  --owner-username MyShop_Owner --owner-phone 9000000001 --owner-password 1111

# 2. Log in as owner, grab access_token from the response
curl -X POST https://<backend-domain>/auth/login \
  -H "Content-Type: application/json" \
  -d '{"phone":"9000000001","password":"1111"}'

# 3. Create cashier
curl -X POST https://<backend-domain>/staff \
  -H "Authorization: Bearer <access_token>" -H "Content-Type: application/json" \
  -d '{"role":"cashier_user","username":"MyShop_Cashier","full_name":"MyShop Cashier","phone":"9000000002","password":"1111"}'

# 4. Create receiver
curl -X POST https://<backend-domain>/staff \
  -H "Authorization: Bearer <access_token>" -H "Content-Type: application/json" \
  -d '{"role":"receiver_user","username":"MyShop_Receiver","full_name":"MyShop Receiver","phone":"9000000003","password":"1111"}'
```

Everyone (owner/cashier/receiver) then logs in at the frontend URL using their **phone** and **password** on the shop login screen.
