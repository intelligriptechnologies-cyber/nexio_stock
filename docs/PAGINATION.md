# Pagination contract

Persistent list endpoints retain their pre-pagination JSON response bodies. Clients opt into pages with:

- `limit`: positive integer bounded by the endpoint (grid UIs use 25, 50, or 100; dashboard widgets use 10, 25, or 50).
- `offset`: zero-based row offset. The UI's one-based page maps to `(page - 1) * limit`.
- `X-Total-Count`: total rows after authorization and filters, before `limit` and `offset`.

CORS exposes `X-Total-Count` and `Content-Disposition`. Invalid limits and negative offsets return FastAPI's normal 422 validation response. Every paged query has a stable ID tie-breaker.

## URL state

Standard pages use `page` and `pageSize`. Search/filter/sort/tab state is stored alongside them and changing any of those dimensions resets `page` to 1. Search URL updates are debounced by 300 ms and replace browser history; page navigation pushes a history entry.

The dashboard lists are independent:

- Low Stock: `lowPage`, `lowPageSize`
- Stock Across Shops: `stockPage`, `stockPageSize`
- Past Sign-offs: `historyPage`, `historyPageSize`

Shop Master uses `shopPage`, `userPage`, `inventoryPage`, `devicePage`, and
`activationPage`, with matching `*PageSize` parameters. Its selected tab, shop,
role/status filters, and inventory search/inactive filter are URL-restorable too.

Stock Across Shops is globally paged in deterministic shop/product order. A returned page is regrouped under the existing shop headings.

## Covered data

The shared server contract covers products, derived inventory, current/past invoices, reconciliations, EOD history, low stock, cross-shop stock, stock inward history and queues, pending voids, log files and business logs, vendors, staff, shops, allotted shop users, devices, authenticator activations, and pending products.

Checkout carts, receiving forms, detail-dialog lines, KPI/payment summaries, dropdown options, and transient import results remain unpaginated. Scanner catalog prefetch follows all product pages and barcode cache misses use `/products/lookup`, so products beyond the first 500 remain resolvable.

## Loading and accessibility

The shared control provides first, previous, numbered, next, and last navigation, an `Items X–Y of Z` summary, a page-size selector, native keyboard behavior, `aria-current="page"`, labelled navigation, and a polite live results announcement. Existing rows remain visible under a subtle busy state while requests run. Abort signals reject stale product/inventory requests. After a successful page change, focus and scroll return to the nearest list heading. If a mutation removes the last row on a page, the control navigates to the last valid page.

## Exports

Grid CSV actions call dedicated server exports and always include the complete filtered, authorized dataset rather than the visible page. This applies to products, inventory, current/past invoices, reconciliations, stock tracking, and vendors. Individual operational log files retain their existing authenticated downloads.
