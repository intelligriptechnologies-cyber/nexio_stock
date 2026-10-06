# Purchase-order import operations

Deploy the tracked [`deploy/Caddyfile`](../deploy/Caddyfile) to the Hetzner host and set `SITE_ADDRESS`, `CORS_ALLOW_ORIGIN`, and (if needed) `BACKEND_UPSTREAM`. It permits 30 MiB at the proxy while the API retains its 25 MB PDF limit, and gives OCR work five minutes to return upstream response headers.

Every browser upload includes `X-Import-Attempt-ID`. Caddy writes it in its JSON access log; the API returns it in the response header and displays it as the support reference for an unsuccessful upload. API outcomes are appended to `runtime/logs/imports/imports-YYYY-MM-DD.jsonl`. Those records intentionally contain only IDs, sizes, page counts, timings, outcome/stage, and unexpected-error tracebacks—never PDF content or OCR text.

For a production smoke test, import a representative OSBCL PDF under 25 MB, retain the displayed attempt ID, and verify the same ID in the browser-visible response, Caddy access/error logs, and the import audit log. A failed upload is actionable when the audit row identifies whether it ended in validation, duplicate detection, OCR/parsing, cancellation, or an unexpected error.
