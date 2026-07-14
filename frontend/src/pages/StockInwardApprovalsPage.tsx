import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, RefreshCw, XCircle, PackagePlus } from "lucide-react";
import { toUserMessage } from "../api/client";
import { approveLot, listStockInwards, rejectLot, type LotPublic } from "../api/lots";
import { useShopScope } from "../auth/ShopScopeProvider";

function statusLabel(status: LotPublic["status"]): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    case "completed":
      return "Completed";
  }
}

export function StockInwardApprovalsPage() {
  const { actingShopId } = useShopScope();
  const [items, setItems] = useState<LotPublic[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const result = await listStockInwards(actingShopId, 100, "pending");
      setItems(result.lots);
    } catch (e) {
      setError(toUserMessage(e, "Could not load stock inward queue."));
    }
  }, [actingShopId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const act = async (id: number, fn: () => Promise<unknown>, label: string) => {
    setBusyId(id);
    setError(null);
    setInfo(null);
    try {
      await fn();
      setInfo(`${label} on inward #${id} succeeded.`);
      await reload();
    } catch (e) {
      setError(`${label} failed: ${toUserMessage(e, "unknown error")}`);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex flex-col gap-8 font-sans">
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200/50 bg-white/60 p-6 shadow-[0_8px_30px_rgb(0,0,0,0.02)] backdrop-blur-xl">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-bold tracking-tight text-slate-900">
            <PackagePlus className="h-6 w-6 text-action" /> Stock Inward Queue
          </h1>
          <p className="mt-1 text-sm font-medium text-slate-500">
            Pending entries awaiting owner approval before inventory changes.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void reload()}
          className="group flex h-10 items-center justify-center rounded-xl bg-white px-5 text-sm font-semibold tracking-wide text-slate-700 shadow-sm ring-1 ring-slate-200 transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:scale-[1.02] hover:bg-slate-50 hover:shadow-md active:scale-[0.97]"
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
        <div className="flex h-32 items-center justify-center rounded-xl border border-slate-200/50 bg-white/60 p-6 shadow-[0_8px_30px_rgb(0,0,0,0.02)] backdrop-blur-xl">
          <div className="text-sm font-medium text-slate-500">Loading...</div>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white/50 py-12 text-center text-sm font-medium text-slate-500">
          No stock inward requests are waiting for approval.
        </div>
      ) : (
        <ul className="flex flex-col gap-4">
          {items.map((item) => (
            <li
              key={item.id}
              className="rounded-xl border border-slate-200/50 bg-white/60 p-6 shadow-[0_8px_30px_rgb(0,0,0,0.02)] backdrop-blur-xl transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:shadow-md"
            >
              <div className="flex flex-wrap items-start justify-between gap-6">
                <div className="flex flex-col gap-2">
                  <span className="text-xl font-bold tracking-tight text-slate-900">Inward #{item.id}</span>
                  <div className="flex flex-wrap items-center gap-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700">{statusLabel(item.status)}</span>
                    <span className="font-mono text-slate-700">shop {item.shop_id}</span>
                    <span>created {new Date(item.created_at).toLocaleString()}</span>
                    <span>by {item.created_by_name ?? `user #${item.received_by_user_id}`}</span>
                  </div>
                  <div className="text-sm font-medium text-slate-600">
                    {item.vendor?.name ?? "No vendor linked"} - Ref {item.reference ?? "--"}
                  </div>
                </div>
                <div className="flex gap-3">
                  <button
                    type="button"
                    disabled={busyId === item.id}
                    onClick={() => void act(item.id, () => approveLot(item.id), "Approve")}
                    className="flex h-10 items-center justify-center gap-2 rounded-xl bg-action px-5 text-sm font-bold tracking-wide text-white shadow-sm transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[var(--color-action)]/30 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50"
                  >
                    <CheckCircle2 className="h-4 w-4" /> Approve
                  </button>
                  <button
                    type="button"
                    disabled={busyId === item.id}
                    onClick={() => void act(item.id, () => rejectLot(item.id), "Reject")}
                    className="flex h-10 items-center justify-center gap-2 rounded-xl bg-red-50 px-5 text-sm font-semibold tracking-wide text-red-600 shadow-sm ring-1 ring-red-200 transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:bg-red-100 disabled:opacity-50"
                  >
                    <XCircle className="h-4 w-4" /> Reject
                  </button>
                </div>
              </div>

              <div className="mt-5 grid gap-3 rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200/50 md:grid-cols-3">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">Invoice</div>
                  <div className="mt-1 font-mono text-slate-900">{item.vendor_invoice_number}</div>
                </div>
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">Purchase date</div>
                  <div className="mt-1 text-slate-900">{item.purchase_date}</div>
                </div>
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">Lines / units</div>
                  <div className="mt-1 text-slate-900">
                    {item.lines.length} / {item.lines.reduce((sum, line) => sum + line.quantity, 0)}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
