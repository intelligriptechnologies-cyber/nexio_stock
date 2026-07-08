// Invoice lookup + grid (issue #1 + issue #44).
//
// Two views on one page:
//   - Top: cashier-facing single-invoice lookup (issue #1 era) — enter
//     an invoice id, see the full invoice, request a void. Kept for
//     the cashier's "show me that exact invoice" flow which a grid
//     can't replicate without picking a row.
//   - Below: server-paginated, filterable invoices grid (issue #44,
//     R-v3-9, R-v3-15). Date range, payment mode, signed-off status,
//     cashier filter, page controls. Role-scoping happens server-side
//     (cashier/receiver see only their own invoices per R-v3-15).

import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../api/client";
import {
  getInvoice,
  listInvoices,
  type InvoiceListFilters,
  type InvoiceListResponse,
  type InvoicePublic,
} from "../api/checkout";
import { requestVoid } from "../api/voids";
import { useShopScope } from "../auth/ShopScopeProvider";

const PAGE_SIZE = 25;

export function InvoiceLookupPage() {
  const { actingShopId } = useShopScope();

  // --- Lookup-by-id state ---
  const [idInput, setIdInput] = useState("");
  const [invoice, setInvoice] = useState<InvoicePublic | null>(null);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookupInfo, setLookupInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // --- Grid state ---
  const [grid, setGrid] = useState<InvoiceListResponse | null>(null);
  const [gridError, setGridError] = useState<string | null>(null);
  const [filters, setFilters] = useState<InvoiceListFilters>({
    page: 1,
    limit: PAGE_SIZE,
  });

  const reloadGrid = useCallback(async () => {
    setGridError(null);
    try {
      const res = await listInvoices(filters, actingShopId);
      setGrid(res);
    } catch (e) {
      setGridError(e instanceof Error ? e.message : "Grid load failed.");
    }
  }, [actingShopId, filters]);

  useEffect(() => {
    void reloadGrid();
  }, [reloadGrid]);

  const totalPages = grid ? Math.max(1, Math.ceil(grid.total / PAGE_SIZE)) : 1;

  // --- Handlers ---
  const lookup = async (e: React.FormEvent) => {
    e.preventDefault();
    setLookupError(null);
    setLookupInfo(null);
    setInvoice(null);
    const id = Number(idInput);
    if (!Number.isInteger(id) || id <= 0) {
      setLookupError("Enter a valid invoice id.");
      return;
    }
    setBusy(true);
    try {
      setInvoice(await getInvoice(id));
    } catch (e) {
      if (e instanceof ApiError && e.status === 404)
        setLookupError(`Invoice #${id} not found.`);
      else setLookupError(e instanceof Error ? e.message : "Lookup failed.");
    } finally {
      setBusy(false);
    }
  };

  const requestVoidForInvoice = async () => {
    if (!invoice) return;
    setBusy(true);
    setLookupError(null);
    setLookupInfo(null);
    try {
      const updated = await requestVoid(invoice.id);
      setInvoice(updated);
      setLookupInfo(
        updated.status === "voided"
          ? `Invoice #${updated.invoice_number} voided.`
          : updated.status === "reversed"
            ? `Invoice #${updated.invoice_number} reversed.`
            : `Void requested for invoice #${updated.invoice_number} — awaiting owner approval.`,
      );
      void reloadGrid();
    } catch (e) {
      if (e instanceof ApiError)
        setLookupError(`Void request failed: ${e.detail}`);
      else setLookupError(e instanceof Error ? e.message : "Void request failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-gutter">
      <header>
        <h1 className="text-headline-lg text-primary">Invoices</h1>
      </header>

      {/* Lookup form (cashier-focused single-invoice flow). */}
      <section className="rounded-lg bg-surface-container p-gutter">
        <h2 className="mb-stack-gap text-headline-md text-primary">
          Look up a specific invoice
        </h2>
        <form onSubmit={lookup} className="flex gap-stack-gap">
          <input
            type="number"
            min={1}
            value={idInput}
            onChange={(e) => setIdInput(e.target.value)}
            placeholder="Invoice id"
            className="min-h-touchTarget flex-1 rounded-md border border-outline bg-surface px-stack-gap text-body-lg"
          />
          <button
            type="submit"
            disabled={busy}
            className="min-h-touchTarget rounded-md bg-primary px-gutter text-label-xl text-on-primary disabled:opacity-50"
          >
            {busy ? "Loading…" : "LOOKUP"}
          </button>
        </form>

        {lookupError && (
          <div role="alert" className="mt-stack-gap rounded-md bg-error px-stack-gap py-3 text-on-error">
            {lookupError}
          </div>
        )}
        {lookupInfo && (
          <div role="status" className="mt-stack-gap rounded-md bg-success px-stack-gap py-3 text-on-secondary">
            {lookupInfo}
          </div>
        )}

        {invoice && (
          <div className="mt-stack-gap flex flex-col gap-stack-gap rounded-md bg-surface p-gutter">
            <header className="flex flex-wrap items-center justify-between gap-stack-gap">
              <div>
                <div className="text-headline-md text-primary">
                  Invoice #{invoice.invoice_number}
                </div>
                <div className="text-label-md text-on-surface-variant">
                  Status: <strong>{invoice.status}</strong> · finalized{" "}
                  {new Date(invoice.finalized_at).toLocaleString()}
                </div>
              </div>
              {invoice.status === "finalized" && (
                <button
                  type="button"
                  onClick={() => void requestVoidForInvoice()}
                  disabled={busy}
                  className="min-h-touchTarget rounded-md bg-error px-gutter text-label-xl text-on-error disabled:opacity-50"
                >
                  REQUEST VOID
                </button>
              )}
            </header>

            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-outline text-label-md text-on-surface-variant">
                  <th className="py-2 text-left">Product</th>
                  <th className="py-2 text-right">Qty</th>
                  <th className="py-2 text-right">Unit</th>
                  <th className="py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {invoice.lines.map((l) => (
                  <tr key={l.id} className="border-b border-outline/40">
                    <td className="py-2">{l.product_brand} {l.product_size_label}</td>
                    <td className="py-2 text-right font-mono">{l.quantity}</td>
                    <td className="py-2 text-right font-mono">₹{l.unit_price}</td>
                    <td className="py-2 text-right font-mono">₹{l.line_total}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3} className="py-3 text-right text-label-xl">Total</td>
                  <td className="py-3 text-right font-mono text-headline-md">
                    ₹{invoice.total_amount}
                  </td>
                </tr>
              </tfoot>
            </table>

            <div>
              <div className="text-label-md uppercase text-on-surface-variant">Payments</div>
              {invoice.payments.map((p) => (
                <div key={p.id} className="flex justify-between text-body-md">
                  <span>{p.mode}</span>
                  <span className="font-mono">₹{p.amount}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Grid (issue #44). Filterable, server-paginated, role-scoped. */}
      <section className="rounded-lg bg-surface-container p-gutter">
        <h2 className="mb-stack-gap text-headline-md text-primary">
          Invoices grid
        </h2>

        <div className="mb-stack-gap grid grid-cols-1 gap-stack-gap md:grid-cols-5">
          <label className="flex flex-col gap-1 text-label-md">
            From date
            <input
              type="date"
              value={filters.from_date ?? ""}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  page: 1,
                  from_date: e.target.value || undefined,
                }))
              }
              className="min-h-touchTarget-sm rounded-md border border-outline bg-surface px-stack-gap text-body-md"
            />
          </label>
          <label className="flex flex-col gap-1 text-label-md">
            To date
            <input
              type="date"
              value={filters.to_date ?? ""}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  page: 1,
                  to_date: e.target.value || undefined,
                }))
              }
              className="min-h-touchTarget-sm rounded-md border border-outline bg-surface px-stack-gap text-body-md"
            />
          </label>
          <label className="flex flex-col gap-1 text-label-md">
            Payment mode
            <select
              value={filters.payment_mode ?? ""}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  page: 1,
                  payment_mode:
                    e.target.value === ""
                      ? undefined
                      : (e.target.value as "cash" | "upi" | "card"),
                }))
              }
              className="min-h-touchTarget-sm rounded-md border border-outline bg-surface px-stack-gap text-body-md"
            >
              <option value="">Any</option>
              <option value="cash">Cash</option>
              <option value="upi">UPI</option>
              <option value="card">Card</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-label-md">
            Signed off
            <select
              value={
                filters.signed_off === undefined
                  ? ""
                  : filters.signed_off
                    ? "true"
                    : "false"
              }
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  page: 1,
                  signed_off:
                    e.target.value === ""
                      ? undefined
                      : e.target.value === "true",
                }))
              }
              className="min-h-touchTarget-sm rounded-md border border-outline bg-surface px-stack-gap text-body-md"
            >
              <option value="">Any</option>
              <option value="false">Open</option>
              <option value="true">Signed off</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-label-md">
            Cashier user id
            <input
              type="number"
              min={1}
              value={filters.cashier_user_id ?? ""}
              onChange={(e) =>
                setFilters((f) => ({
                  ...f,
                  page: 1,
                  cashier_user_id: e.target.value
                    ? Number(e.target.value)
                    : undefined,
                }))
              }
              className="min-h-touchTarget-sm rounded-md border border-outline bg-surface px-stack-gap text-body-md font-mono"
            />
          </label>
        </div>

        {gridError && (
          <div role="alert" className="mb-stack-gap rounded-md bg-error px-stack-gap py-3 text-on-error">
            {gridError}
          </div>
        )}

        {grid === null ? (
          <div className="text-on-surface-variant">Loading…</div>
        ) : grid.invoices.length === 0 ? (
          <div className="text-on-surface-variant">
            No invoices match the current filters.
          </div>
        ) : (
          <>
            <div className="overflow-x-auto rounded-md bg-surface">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-outline text-label-md text-on-surface-variant">
                    <th className="px-stack-gap py-2 text-right">Invoice #</th>
                    <th className="px-stack-gap py-2 text-left">Date</th>
                    <th className="px-stack-gap py-2 text-left">Cashier</th>
                    <th className="px-stack-gap py-2 text-left">Status</th>
                    <th className="px-stack-gap py-2 text-right">Total</th>
                    <th className="px-stack-gap py-2 text-left">EOD</th>
                  </tr>
                </thead>
                <tbody>
                  {grid.invoices.map((row) => (
                    <tr key={row.id} className="border-b border-outline/40">
                      <td className="px-stack-gap py-2 text-right font-mono">
                        {row.invoice_number}
                      </td>
                      <td className="px-stack-gap py-2">
                        {new Date(row.finalized_at).toLocaleString()}
                      </td>
                      <td className="px-stack-gap py-2">{row.cashier_name}</td>
                      <td className="px-stack-gap py-2">{row.status}</td>
                      <td className="px-stack-gap py-2 text-right font-mono">
                        ₹{row.total_amount}
                      </td>
                      <td className="px-stack-gap py-2">
                        {row.eod_signed_off ? "yes" : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-stack-gap flex items-center justify-between text-label-md">
              <span className="text-on-surface-variant">
                Page {grid.page} of {totalPages} · {grid.total} invoice
                {grid.total === 1 ? "" : "s"} total
              </span>
              <div className="flex gap-stack-gap">
                <button
                  type="button"
                  disabled={grid.page <= 1}
                  onClick={() =>
                    setFilters((f) => ({ ...f, page: Math.max(1, (f.page ?? 1) - 1) }))
                  }
                  className="min-h-touchTarget-sm rounded-md bg-surface-container-high px-stack-gap text-label-md disabled:opacity-50"
                >
                  Prev
                </button>
                <button
                  type="button"
                  disabled={grid.page >= totalPages}
                  onClick={() =>
                    setFilters((f) => ({
                      ...f,
                      page: Math.min(totalPages, (f.page ?? 1) + 1),
                    }))
                  }
                  className="min-h-touchTarget-sm rounded-md bg-surface-container-high px-stack-gap text-label-md disabled:opacity-50"
                >
                  Next
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}