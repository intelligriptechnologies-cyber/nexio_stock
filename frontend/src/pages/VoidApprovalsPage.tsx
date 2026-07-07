import { useEffect, useState } from "react";
import { ApiError } from "../api/client";
import { getInvoice, type InvoicePublic } from "../api/checkout";
import { approveVoid, listPendingVoids, rejectVoid, type PendingVoidInvoice } from "../api/voids";

function moneyFmt(s: string): string {
  return `₹${s}`;
}

export function VoidApprovalsPage() {
  const [items, setItems] = useState<PendingVoidInvoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const reload = async () => {
    setItems(null);
    try {
      const res = await listPendingVoids();
      setItems(res.pending);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed.");
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  const act = async (id: number, fn: () => Promise<unknown>, label: string) => {
    setBusyId(id);
    setError(null);
    setInfo(null);
    try {
      await fn();
      setInfo(`${label} on invoice #${id} succeeded.`);
      await reload();
    } catch (e) {
      if (e instanceof ApiError) setError(`${label} failed: ${e.detail}`);
      else setError(e instanceof Error ? e.message : `${label} failed.`);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex flex-col gap-stack-gap">
      <header className="flex items-center justify-between">
        <h1 className="text-headline-lg text-primary">Void approvals</h1>
        <button
          type="button"
          onClick={() => void reload()}
          className="min-h-touchTarget-sm rounded-md bg-surface-container-high px-stack-gap text-label-md"
        >
          Refresh
        </button>
      </header>

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

      {items === null ? (
        <div className="text-on-surface-variant">Loading…</div>
      ) : items.length === 0 ? (
        <div className="rounded-md bg-surface-container p-stack-gap text-on-surface-variant">
          No invoices are awaiting void approval.
        </div>
      ) : (
        <ul className="flex flex-col gap-stack-gap">
          {items.map((it) => (
            <li
              key={it.id}
              className="flex flex-wrap items-center justify-between gap-stack-gap rounded-md bg-surface-container px-stack-gap py-3"
            >
              <div className="flex flex-col">
                <span className="text-label-xl text-primary">Invoice #{it.invoice_number}</span>
                <span className="text-label-md text-on-surface-variant">
                  id {it.id} · {moneyFmt(it.total_amount)} · finalized{" "}
                  {new Date(it.finalized_at).toLocaleString()}
                </span>
              </div>
              <div className="flex gap-stack-gap">
                <button
                  type="button"
                  disabled={busyId === it.id}
                  onClick={() => void act(it.id, () => approveVoid(it.id), "Approve")}
                  className="min-h-touchTarget-sm rounded-md bg-success px-stack-gap text-label-md text-on-secondary disabled:opacity-50"
                >
                  Approve
                </button>
                <button
                  type="button"
                  disabled={busyId === it.id}
                  onClick={() => void act(it.id, () => rejectVoid(it.id), "Reject")}
                  className="min-h-touchTarget-sm rounded-md bg-error px-stack-gap text-label-md text-on-error disabled:opacity-50"
                >
                  Reject
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Re-exported so other pages (e.g. an invoice-lookup page for cashiers)
// can call into the same module.
export { getInvoice };
export type { InvoicePublic };