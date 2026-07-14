import { useCallback, useEffect, useState } from "react";
import { ShieldAlert, RefreshCw, CheckCircle2, XCircle } from "lucide-react";
import { toUserMessage } from "../api/client";
import { getInvoice, type InvoicePublic } from "../api/checkout";
import { approveVoid, listPendingVoids, rejectVoid } from "../api/voids";
import { notifyVoidApprovalsChanged } from "../api/void-approvals-events";
import { useShopScope, useShopScopeGuard } from "../auth/ShopScopeProvider";

function moneyFmt(s: string): string {
  return `₹${s}`;
}

export function VoidApprovalsPage() {
  const { actingShopId } = useShopScope();
  const shopScopeGuard = useShopScopeGuard();
  const [items, setItems] = useState<InvoicePublic[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (shopScopeGuard.blocked) {
      setItems(null);
      return;
    }
    setItems(null);
    try {
      const res = await listPendingVoids(actingShopId);
      setItems(res.invoices);
    } catch (e) {
      setError(toUserMessage(e, "Load failed."));
    }
  }, [actingShopId, shopScopeGuard.blocked]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const act = async (id: number, fn: () => Promise<unknown>, label: string) => {
    setBusyId(id);
    setError(null);
    setInfo(null);
    try {
      await fn();
      setInfo(`${label} on invoice #${id} succeeded.`);
      await reload();
      notifyVoidApprovalsChanged();
    } catch (e) {
      setError(`${label} failed: ${toUserMessage(e, "unknown error")}`);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex flex-col gap-8 font-sans">
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-[24px] border border-slate-200/50 bg-white/60 p-6 shadow-[0_8px_30px_rgb(0,0,0,0.02)] backdrop-blur-xl">
        <h1 className="flex items-center gap-3 text-2xl font-light tracking-tight text-slate-900">
          <ShieldAlert className="h-6 w-6 text-action" /> Void approvals
        </h1>
        <button
          type="button"
          onClick={() => void reload()}
          className="group flex h-10 items-center justify-center rounded-xl bg-white px-5 text-sm font-semibold tracking-wide text-slate-700 shadow-sm ring-1 ring-slate-200 transition-all duration-300 hover:scale-[1.02] hover:bg-slate-50 hover:shadow-md active:scale-95"
        >
          <RefreshCw className="h-4 w-4 text-slate-400 transition-transform duration-300 group-hover:rotate-180" />
          <span className="ml-2">Refresh</span>
        </button>
      </header>

      {error && (
        <div role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600 ring-1 ring-red-200">
          {error}
        </div>
      )}
      {info && (
        <div role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-600 ring-1 ring-emerald-200">
          {info}
        </div>
      )}

      {items === null ? (
        <div className="flex h-32 items-center justify-center rounded-[24px] border border-slate-200/50 bg-white/60 p-6 shadow-[0_8px_30px_rgb(0,0,0,0.02)] backdrop-blur-xl">
          <div className="text-sm font-medium text-slate-500">Loading…</div>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white/50 py-12 text-center text-sm font-medium text-slate-500">
          No invoices are awaiting void approval.
        </div>
      ) : (
        <ul className="flex flex-col gap-4">
          {items.map((it) => (
            <li
              key={it.id}
              className="flex flex-wrap items-center justify-between gap-6 rounded-[24px] border border-slate-200/50 bg-white/60 p-6 shadow-[0_8px_30px_rgb(0,0,0,0.02)] backdrop-blur-xl transition-all duration-300 hover:shadow-md"
            >
              <div className="flex flex-col">
                <span className="text-xl font-bold tracking-tight text-slate-900">Invoice #{it.invoice_number}</span>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  <span className="font-mono text-slate-700">id {it.id}</span>
                  <span aria-hidden="true" className="text-slate-300">·</span>
                  <span className="font-mono text-slate-700">{moneyFmt(it.total_amount)}</span>
                  <span aria-hidden="true" className="text-slate-300">·</span>
                  <span>finalized {new Date(it.finalized_at).toLocaleString()}</span>
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  type="button"
                  disabled={busyId === it.id}
                  onClick={() => void act(it.id, () => approveVoid(it.id), "Approve")}
                  className="flex h-10 items-center justify-center gap-2 rounded-xl bg-action px-5 text-sm font-bold tracking-wide text-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--color-action)]/30 active:scale-95 disabled:pointer-events-none disabled:opacity-50"
                >
                  <CheckCircle2 className="h-4 w-4" /> Approve
                </button>
                <button
                  type="button"
                  disabled={busyId === it.id}
                  onClick={() => void act(it.id, () => rejectVoid(it.id), "Reject")}
                  className="flex h-10 items-center justify-center gap-2 rounded-xl bg-red-50 px-5 text-sm font-semibold tracking-wide text-red-600 shadow-sm ring-1 ring-red-200 transition-all duration-200 hover:bg-red-100 disabled:opacity-50"
                >
                  <XCircle className="h-4 w-4" /> Reject
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
