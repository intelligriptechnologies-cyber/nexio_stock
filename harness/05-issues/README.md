# 05 — Issues

Vertical slices published to GitHub (`intelligriptechnologies-cyber/nexio_stock`), in dependency order. Each issue's acceptance criteria are testable external behavior; slices must not improvise architecture that contradicts `02-ledger.md`.

| # | Title | Blocked by | R-tags covered |
|---|---|---|---|
| [#1](https://github.com/intelligriptechnologies-cyber/nexio_stock/issues/1) | Foundation & Auth: project scaffold, schema, roles, logging | None | R-1, R-2, R-3, R-4, R-5, R-11, R-17, R-20, R-21, R-22, R-37, R-38, R-39 |
| [#2](https://github.com/intelligriptechnologies-cyber/nexio_stock/issues/2) | Product Catalog & Bulk Import | #1 | R-7, R-10, R-27, R-42 (D-52) |
| [#3](https://github.com/intelligriptechnologies-cyber/nexio_stock/issues/3) | Lot Receiving (stock check-in) | #1, #2 | R-6, R-25 |
| [#4](https://github.com/intelligriptechnologies-cyber/nexio_stock/issues/4) | Checkout & Invoicing | #1, #2, #3 | R-8 (open→finalized), R-9, R-12, R-13, R-14, R-24, R-31, R-40, R-43 |
| [#5](https://github.com/intelligriptechnologies-cyber/nexio_stock/issues/5) | Void & Reversal with Owner Approval | #4 | R-8 (void), R-41 |
| [#6](https://github.com/intelligriptechnologies-cyber/nexio_stock/issues/6) | EOD Reconciliation & Owner Dashboard | #4, #5 | R-15 (EOD portion), R-18, R-19, R-26, R-44 |
| [#7](https://github.com/intelligriptechnologies-cyber/nexio_stock/issues/7) | Low-Stock Alerts | #2, #3 | R-15 (low-stock portion), D-33, D-34 |
| [#8](https://github.com/intelligriptechnologies-cyber/nexio_stock/issues/8) | GST/Excise Invoice Line (stub, pending duty-structure confirmation) | #4 | R-33, R-34 |

Frontend slices (from `harness/prd_frontend.md`), in dependency order:

| # | Title | Blocked by | User stories covered |
|---|---|---|---|
| [#10](https://github.com/intelligriptechnologies-cyber/nexio_stock/issues/10) | Frontend Foundation & Auth Shell | None | 1, 14, 33, 34, 35, 36, 37 |
| [#11](https://github.com/intelligriptechnologies-cyber/nexio_stock/issues/11) | Checkout & Sales Counter | #10 | 2, 3, 4, 5, 6, 7, 8, 9, 10 |
| [#12](https://github.com/intelligriptechnologies-cyber/nexio_stock/issues/12) | Checkout Resilience — Offline Queue & Retry | #11 | 11, 12 |
| [#13](https://github.com/intelligriptechnologies-cyber/nexio_stock/issues/13) | Stock Receiving (New Lot) | #10 | 15, 16, 17 |
| [#14](https://github.com/intelligriptechnologies-cyber/nexio_stock/issues/14) | Product Catalog & Bulk Import | #10 | 24, 25, 26, 27, 28 |
| [#15](https://github.com/intelligriptechnologies-cyber/nexio_stock/issues/15) | Void Request & Approval | #11 | 13, 21 |
| [#16](https://github.com/intelligriptechnologies-cyber/nexio_stock/issues/16) | Owner Dashboard & EOD | #10 | 18, 19, 20, 22, 23 |
| [#17](https://github.com/intelligriptechnologies-cyber/nexio_stock/issues/17) | Staff Management | #10 | 29, 30, 31 |
| [#18](https://github.com/intelligriptechnologies-cyber/nexio_stock/issues/18) | Shop Config | #10 | 32 |

## Status

- [ ] #1 Foundation & Auth
- [ ] #2 Product Catalog & Bulk Import
- [ ] #3 Lot Receiving
- [ ] #4 Checkout & Invoicing
- [ ] #5 Void & Reversal
- [ ] #6 EOD Reconciliation & Owner Dashboard
- [ ] #7 Low-Stock Alerts
- [ ] #8 GST/Excise Invoice Line (stub)
- [ ] #10 Frontend Foundation & Auth Shell
- [ ] #11 Checkout & Sales Counter
- [ ] #12 Checkout Resilience — Offline Queue & Retry
- [ ] #13 Stock Receiving (New Lot)
- [ ] #14 Product Catalog & Bulk Import (frontend)
- [ ] #15 Void Request & Approval (frontend)
- [ ] #16 Owner Dashboard & EOD (frontend)
- [ ] #17 Staff Management (frontend)
- [ ] #18 Shop Config (frontend)
