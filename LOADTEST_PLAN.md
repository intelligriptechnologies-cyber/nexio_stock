# Barstock UAT Load Test — Plan

## Goal

Load-test the deployed UAT backend (not local) with realistic multi-shop,
multi-user traffic using Locust:

- **5 shops**, each with **4 cashiers** + **2 receivers** (+ 1 owner) = 35 staff accounts total.
- Cashier flow: checkout with **combos of 1, 2, 3 items** (mirrors the manual
  walkthrough already validated locally: single item, 2-item cart, 3-item
  cart with split payment).
- Receiver flow: stock receiving (so cashiers have real stock to sell against
  — "noticeable stock" per your ask).
- Target: **10,000 invoices** total across the run (~2,000/shop, roughly a
  day's volume for a single-counter shop, per your numbers).
- Explicitly **not** testing superadmin login/flows.

## Environment

- UAT backend: `https://barstock-dev.nexiohyper.com` (confirmed reachable:
  `/`, `/healthz`, `/docs`, `/openapi.json` all return 200).
- Same backend also resolves at the Railway-assigned domain
  `backend-production-85df.up.railway.app` (per your message) — I'll target
  the nexiohyper.com URL since that's the one you'd watch/monitor.
- Railway project `barstock`, environment `dev`, service `backend` — already
  linked locally (`railway status` confirms this), so `railway variables`
  works without re-linking.
- Postgres is reachable directly via its public proxy
  (`DATABASE_PUBLIC_URL` from `railway variables --service Postgres`), which
  is how I'll provision shops/staff without needing superadmin credentials
  over HTTP.
- Existing real data already in this DB: shop `Nexio_D` (Nexio_DemoShop) and
  `Shop-S2` (Satynagar Br), plus their owner/cashier/receiver and one
  superadmin (`igadmin`). The load test must not touch these — only new
  `loadtest-shop-N` rows.
- Login is device-bound (`device_bindings` table): a device_key must be
  registered to a shop+counter before username/password login succeeds.
  Locust workers need pre-registered device keys per shop (I'll register a
  handful of shared "virtual terminal" device keys per shop covering the
  4 cashiers + 2 receivers, since device binding just resolves shop context
  and isn't a session-exclusivity lock).
- Shops also have an optional IP allowlist (`allowed_login_cidrs`); default
  is empty (`[]`) which the code treats as "allow all", so new loadtest
  shops won't block Locust's origin IP unless explicitly configured.

## Provisioning (one-time setup, not part of the timed load test)

All done via the existing `uv run barstock` CLI pointed at the UAT
`DATABASE_URL` (async DSN, from `DATABASE_PUBLIC_URL` with the driver
prefix swapped to `postgresql+asyncpg://`), plus a few authenticated HTTP
calls for staff creation and device binding (staff creation has no CLI,
only `POST /staff` as the shop owner).

1. `railway variables --service Postgres --environment dev --kv` → get
   `DATABASE_PUBLIC_URL`.
2. For shop in `loadtest-shop-1..5`:
   - `DATABASE_URL=postgresql+asyncpg://... uv run barstock createshop --code loadtest-shop-N --name "Loadtest Shop N" --owner-username loadtestN-owner --owner-phone <unique> --owner-password <generated>`
3. Log in as each new owner via `POST https://barstock-dev.nexiohyper.com/auth/login` (owner role, device-bound — register the owner's device first via the superadmin-free path: actually owners can self-register their own device the same way the frontend does, or I bind it directly via SQL/`device_bindings` insert since I already have DB access — simpler and avoids any superadmin HTTP call).
4. As each owner (bearer token), `POST /staff` × 6 per shop (4 cashier_user + 2 receiver_user), with unique global phone numbers.
5. Register one device_key per shop (used by all its cashiers/receivers — login isn't session-exclusive) via direct SQL insert into `device_bindings` (fastest, avoids any superadmin HTTP flow entirely, consistent with "we won't test superadmin").
6. Seed a small product catalog per shop (5-8 brands, distinct barcodes) via `POST /products` (owner-authenticated) — needed so checkout has something to scan.
7. Receiver flow seeds real stock: each receiver logs in and does a `POST /lots` (or equivalent receiving endpoint) to add "noticeable stock" per product before the timed run starts, so cashiers aren't immediately stock-blocked.

## Will this catch slowness/lag under scale? (added after review)

The original design (fixed 10k-invoice target, sized to stop once reached)
answers "does it work at volume" but **not** "where does it get slow" —
those need concurrency stress, not cumulative count. Three additions:

1. **Backend DB pool is a known, specific ceiling to watch for.**
   `app/db.py:50-52` sets `pool_size=10, max_overflow=20` → **30 concurrent
   DB connections max per backend instance.** With 30 staff accounts (4
   cashiers + 2 receivers × 5 shops) all active, we're right at that edge.
   If Railway runs a single backend instance (likely on a dev/UAT plan),
   this predicts a specific failure mode: requests queuing for a DB
   connection once >30 requests are in-flight simultaneously. The load
   test should explicitly ramp concurrency past this point to confirm.

2. **Ramping load shape, not a flat run.** A fixed `--users N --spawn-rate
   R` run either stays under the bottleneck (proves nothing) or overshoots
   it blindly. Instead use a Locust `LoadTestShape` that steps up
   concurrent users over time (e.g. 5 → 10 → 20 → 30 → 45 → 60, a few
   minutes per step) while continuously recording latency, so we get a
   curve of "requests/sec and p95 latency vs. concurrent users" and can
   point at the step where it bends — not just a single before/after
   number. The 10k-invoice figure becomes the total volume produced across
   all steps, not the stopping condition for a single flat run.

3. **Capture percentile latency per endpoint, not just pass/fail.**
   Locust's `--csv` output includes p50/p95/p99/max per named request
   (I'll tag requests with `name=` so `/products/lookup`, `/invoices`
   finalize, `/lots` receiving, and `/auth/login` are reported separately
   rather than lumped together) plus an `--html` report for a shareable
   summary. This is what actually answers "which flow gets slow first."

4. **Side-channel monitoring during the run**, since Locust only sees
   client-observed latency, not server-side cause:
   - `railway logs --service backend --environment dev` tailed during the
     run to catch slow-query warnings or connection-pool timeout errors
     structlog would emit.
   - Railway's dashboard metrics (CPU/memory/instance count) for the
     `backend` service and the `Postgres` plugin — I can't pull these
     programmatically without the Railway API/token scope, so I'll ask you
     to have the dashboard open during the run, or point me at
     `railway logs`/metrics export if there's a way to pull them via CLI.
   - Caveat: Locust runs from my machine, so measured latency includes
     network RTT from here to Railway's region, not just server processing
     time — real for a remote-shop scenario, but worth naming so a p95 of
     "300ms" isn't misread as pure server time.

With these four additions, yes — this design will surface concurrency-driven
slowness (DB pool exhaustion, per-endpoint latency creep, degradation point
by concurrent-user count), not just confirm the happy path works at volume.

## Locust scenario design

`locustfile.py` (new, lives at repo root or `loadtest/locustfile.py`):

- **CashierUser** (`HttpUser`): on start, logs in as one of the 4
  cashier_user accounts for its assigned shop (round-robined across the 20
  cashier slots — 4 × 5 shops) using the shop's shared device_key. Tasks:
  - weighted random cart size 1/2/3 items (roughly matching the manual test:
    single item, 2-item, 3-item-with-split-payment) drawn from that shop's
    seeded catalog.
  - `POST /invoices` (or whatever the finalize endpoint is — confirming
    exact path from `app/api` before writing the script) to finalize.
- **ReceiverUser** (`HttpUser`): logs in as one of the 2 receiver_user
  accounts per shop, periodically posts a receiving lot to keep stock from
  running out during the run (lower frequency than checkout).
- Shape: a Locust `LoadTestShape` stepping concurrent users up over time
  (e.g. 5 → 10 → 20 → 30 → 45 → 60, several minutes per step) rather than a
  single flat `--users`/`--spawn-rate` run, so we get a latency-vs-concurrency
  curve and can see where it bends (expected candidate: near 30 concurrent,
  given the DB pool ceiling above). The ~10,000-invoice figure is the
  cumulative volume produced across all steps, not a stopping condition —
  I'll cap total run time so we don't wildly overshoot it, but the point of
  the run is the curve, not hitting an exact count.

## Commands I expect to run

```bash
# Discovery / provisioning
railway status
railway variables --service backend --environment dev --kv
railway variables --service Postgres --environment dev --kv
psql "$DATABASE_PUBLIC_URL" -c "..."          # provisioning inserts/checks
DATABASE_URL=postgresql+asyncpg://... uv run barstock createshop ...

# Verification
curl https://barstock-dev.nexiohyper.com/healthz
curl -X POST https://barstock-dev.nexiohyper.com/auth/login -d '...'

# Load test
uv pip install locust   # or add to pyproject dev deps
locust -f loadtest/locustfile.py --host https://barstock-dev.nexiohyper.com \
  --users <N> --spawn-rate <R> --run-time <T> --headless \
  --csv loadtest/results/run1
```

## Open items before I execute

1. **Confirm the finalize-checkout and receiving endpoint paths/payloads**
   exactly (I'll read `app/api/invoices.py` / `lots.py` rather than guess).
2. **Password policy** — I'll generate the 35 staff passwords and record
   them in a local, gitignored file (`loadtest/.credentials.json`), not in
   chat, since they're real (if low-stakes) UAT secrets.
3. **Cleanup plan** — after the run, all loadtest data lives under shops
   coded `loadtest-shop-1..5`; a teardown script (`DELETE FROM shops WHERE
   code LIKE 'loadtest-shop-%' CASCADE`-equivalent, respecting FK order) can
   remove it in one shot when you're done reviewing results. I will **not**
   run teardown automatically — that's a destructive action against
   production data and needs your explicit go-ahead when you're ready.
4. **Rate/impact ceiling** — 10,000 invoices is the target; I'll start with
   a short calibration run (~50-100 invoices) to confirm correctness and
   measure throughput before committing to the full run, so a scenario bug
   doesn't spam 10k broken invoices into UAT.

Let me know if this matches what you want before I start provisioning.
