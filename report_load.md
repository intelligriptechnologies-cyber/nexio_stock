# Barstock UAT Load Test — Report

Run date: 2026-07-13 (UTC), executed per `LOADTEST_PLAN.md` against the live
UAT backend at `https://backend-production-85df.up.railway.app` (Railway
project `barstock`, environment `dev`, service `backend`).

## What was executed

1. **Provisioning** (already complete on disk, `loadtest/.credentials.json`):
   5 shops (`loadtest-shop-1..5`), each with 1 owner, 4 cashiers, 2 receivers,
   a vendor, a 6-product catalog, and initial stock of 500 units/product.
2. **`loadtest/locustfile.py`** (new): `CashierUser` (checkout carts of
   1/2/3 items, weighted, with split cash+UPI payment on 3-item carts) and
   `ReceiverUser` (periodic restock via `POST /lots`), driven by a
   `StepLoadShape` ramping concurrent users 5 → 10 → 20 → 30 → 45 → 50 → 55 → 60
   over 18 minutes (3 min/step for the 6 named steps in the plan; Locust
   subdivides the spawn ramp into the 50/55 sub-steps on the way to 60).
3. **Calibration run**: 5 users, 60s flat, to confirm correctness before
   committing to the full run.
4. **Full ramp run**: the step shape above, ~18 minutes, results in
   `loadtest/results/run1_stats.csv` / `run1_stats_history.csv` / `run1.html`.
5. **Side-channel logs**: `railway logs --service backend` snapshots
   captured during/after the run (`loadtest/results/railway_logs_run1*.txt`).
   Caveat: Railway's CLI only returns a live ~500-line tail, not a queryable
   historical range, so the snapshots captured don't line up precisely with
   the failure window identified below — see Limitations.

## Calibration run (5 concurrent users, 60s)

| Endpoint | Requests | Failures | Median | p95 | p99 | Max |
|---|---|---|---|---|---|---|
| `/auth/login` | 20 | 0 | 4.2s | 5.4s | 5.4s | 5.4s |
| `/checkout/finalize` | 1,274 | 0 | 390ms | 590ms | 940ms | 2.3s |
| `/lots` | 25 | 0 | 380ms | 1.1s | 2.1s | 2.1s |

Zero failures at low concurrency. Two things stand out even here:
- **`/auth/login` is slow** — ~4.2s median, almost certainly bcrypt cost
  factor on password verify. Not a problem at low concurrency, but worth
  knowing since every simulated shift-start does this once.
- A handful of `/checkout/finalize` calls already tail out past 2s even at
  5 users, likely early row-lock contention on shared products.

## Full ramp run (5 → 60 concurrent users, 18 min, 9,509 requests)

| Endpoint | Requests | Failures | Median | p95 | p99 | p99.9 | Max |
|---|---|---|---|---|---|---|---|
| `/auth/login` | 60 | 0 (0%) | 4.3s | 5.7s | 6.2s | 6.2s | 6.2s |
| `/checkout/finalize` | 9,246 | 466 (5.0%) | 390ms | 700ms | 6.8s | 19.0s | 49.1s |
| `/lots` | 197 | 16 (8.1%) | 360ms | 3.9s | 19.0s | 19.0s | 19.3s |
| **Aggregated** | 9,503 | 482 (5.1%) | 390ms | 820ms | 7.1s | 19.0s | 49.1s |

### The failure burst, isolated

All 482 failures happened in a single ~49-second window at **t=756s–805s**,
entirely inside the 45-concurrent-user step (which ran t=721s–900s):

```
t=756s  users=45  cumulative failures=4
t=792s  users=45  cumulative failures=390  (+36 in one tick)
t=801s  users=45  cumulative failures=430  (+40 in one tick)
t=805s  users=45  cumulative failures=482  (last failure recorded)
```

No further failures occurred for the remaining ~275s of the run, including
the 50-, 55-, and 60-user steps that followed. Error breakdown:

```
430  POST /checkout/finalize: gaierror(11001, 'getaddrinfo failed')
 36  POST /checkout/finalize: RemoteDisconnected('Remote end closed connection without response')
  9  POST /lots: RemoteDisconnected(...)
  7  POST /lots: gaierror(11001, ...)
```

**Read on this**: `gaierror 11001` is a DNS-resolution failure raised by the
Windows sockets layer on the *client* (the machine running Locust), not an
HTTP-level error from the server. It clusters into a single short burst and
then never recurs even as concurrency climbs further (45 → 60 users) —
if this were the backend's DB-connection-pool ceiling (`pool_size=10,
max_overflow=20` = 30, per `app/db.py:50-52`) being hit, we'd expect failures
to persist or worsen as concurrency increased past that point, not vanish
for the rest of the run. The pattern instead looks like the Windows client
machine transiently exhausted DNS-resolution/socket capacity under a burst
of near-simultaneous new HTTPS connections to the same hostname — a known
Windows-client artifact under high concurrent outbound-connection churn,
not a backend defect. This is a plausible read, not a confirmed one — see
Limitations.

### Latency vs. concurrency

Excluding the failure-burst window, checkout latency degrades gradually and
smoothly with concurrency rather than showing a sharp knee at the DB-pool
boundary (30 connections): p95 goes from **590ms at 5 users** (calibration)
to **700ms cumulative** across the full 5→60 ramp, with the tail (p99/p99.9)
almost entirely explained by the failure-burst window's slow/timed-out
requests. This run did **not** clearly demonstrate the DB-pool-exhaustion
failure mode hypothesized in the plan — either the backend handles this
level of concurrency within its pool comfortably, or the client-side burst
masked it. A rerun from a non-Windows load-generation host (see below)
would be needed to rule this out definitively.

## Backend-side signal

`railway logs --service backend` snapshots taken during and shortly after
the run show no pool-exhaustion, timeout, or exception log lines (grepped
for `error|warn|timeout|pool|exception|traceback|disconnect`across ~500
lines each). However, Railway's CLI only exposes a rolling live tail, not a
historical range query, so these snapshots do not reliably cover the exact
t=756–805s failure window — this is a real gap, not a clean "backend was
fine" confirmation. See Limitations.

## Fix applied to the harness

`loadtest/locustfile.py` originally called `self.environment.runner.quit()`
on a failed login inside `on_start`, which would have killed the *entire*
swarm on any single account's login failure rather than just retiring that
one simulated user. Changed to `self.stop(force=True)` (Locust's per-user
stop). This run had zero login failures so the bug didn't affect these
results, but it was a latent correctness issue in the harness worth fixing
before any future run.

## Limitations / what this run does not tell us

1. **Client-vs-server ambiguity on the failure burst.** The `gaierror`
   pattern strongly suggests a client-side (Windows load-gen machine) DNS/
   socket hiccup, not a backend fault, but this isn't independently
   confirmed by server-side logs due to the Railway CLI's log-window gap
   above.
2. **DB-pool ceiling not clearly exercised.** The plan's core hypothesis
   (30-connection ceiling causing a visible latency/error knee near 30
   concurrent users) wasn't clearly demonstrated — degradation was gradual,
   not steep, across the tested range.
3. **Client-observed latency, not pure server time.** As noted in the plan,
   Locust ran from a local machine, so measured latency includes network
   RTT to Railway's region.
4. **Invoice volume**: ~9,250 checkout invoices were produced in this run
   (short of the 10,000-invoice target) since the run was time-boxed to the
   18-minute ramp shape rather than run to a fixed invoice count, per the
   plan's own reframing ("the point of the run is the curve, not hitting an
   exact count").

## Suggested follow-up (not executed)

- Rerun the same `locustfile.py` from a Linux host (or with Python's
  resolver/connection-pool tuned) to rule out the client-side DNS
  explanation for the failure burst.
- If failures reproduce on a non-Windows host at the same ~45-user mark,
  that would confirm a genuine backend limit worth investigating via
  Railway's dashboard metrics (CPU/instance count) during the run — the
  plan flagged this as something to have open live, which wasn't done for
  this run.
- Teardown of `loadtest-shop-1..5` data is **not** done — per the plan,
  that's a destructive action against UAT data requiring explicit go-ahead.
