// Cashier-side invoice lookup + void request. Cashiers enter an invoice
// id, see the finalized invoice, and can request a void against it.
// The backend decides pre-EOD direct void vs. post-EOD pending-approval.

import { useState } from "react";
import { ApiError } from "../api/client";
import { getInvoice, type InvoicePublic } from "../api/checkout";
import { requestVoid } from "../api/voids";

export function InvoiceLookupPage() {
  const [idInput, setIdInput] = useState("");
  const [invoice, setInvoice] = useState<InvoicePublic | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const lookup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setInvoice(null);
    const id = Number(idInput);
    if (!Number.isInteger(id) || id <= 0) {
      setError("Enter a valid invoice id.");
      return;
    }
    setBusy(true);
    try {
      setInvoice(await getInvoice(id));
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setError(`Invoice #${id} not found.`);
      else setError(e instanceof Error ? e.message : "Lookup failed.");
    } finally {
      setBusy(false);
    }
  };

  const requestVoidForInvoice = async () => {
    if (!invoice) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const updated = await requestVoid(invoice.id);
      setInvoice(updated);
      setInfo(
        updated.status === "voided"
          ? `Invoice #${updated.invoice_number} voided.`
          : updated.status === "reversed"
          ? `Invoice #${updated.invoice_number} reversed.`
          : `Void requested for invoice #${updated.invoice_number} — awaiting owner approval.`
      );
    } catch (e) {
      if (e instanceof ApiError) setError(`Void request failed: ${e.detail}`);
      else setError(e instanceof Error ? e.message : "Void request failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-stack-gap">
      <h1 className="text-headline-lg text-primary">Invoice lookup</h1>

      <form onSubmit={lookup} className="flex gap-stack-gap">
        <input
          type="number"
          min="1"
          value={idInput}
          onChange={(e) => setIdInput(e.target.value)}
          placeholder="Invoice id"
          className="min-h-touchTarget flex-1 rounded-md border border-outline bg-surface px-stack-gap text-body-lg"
          autoFocus
        />
        <button
          type="submit"
          disabled={busy}
          className="min-h-touchTarget rounded-md bg-primary px-gutter text-label-xl text-on-primary disabled:opacity-50"
        >
          {busy ? "Loading…" : "LOOKUP"}
        </button>
      </form>

      {error && (
        <div role="alert" className="rounded-md bg-error px-stack-gap py-3 text-on-error">
          {error}
        </div>
      )}
      {info && (
        <div role="status" className="rounded-md bg-success px-stack-gap py-3 text-on-secondary">
          {info}
        </div>
      )}

      {invoice && (
        <div className="flex flex-col gap-stack-gap rounded-lg bg-surface-container p-gutter">
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
                  <td className="py-2">{l.product_id}</td>
                  <td className="py-2 text-right font-mono">{l.quantity}</td>
                  <td className="py-2 text-right font-mono">₹{l.unit_price}</td>
                  <td className="py-2 text-right font-mono">₹{l.line_total}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} className="py-3 text-right text-label-xl">
                  Total
                </td>
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
    </div>
  );
}