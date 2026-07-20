import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, PackagePlus, RefreshCw, ShieldAlert, XCircle } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import type { InvoicePublic } from "../api/checkout";
import { toUserMessage } from "../api/client";
import { approveLot, rejectLot, type LotPublic } from "../api/lots";
import { approveVoid, rejectVoid } from "../api/voids";
import { listPendingApprovals } from "../api/approvals";
import { notifyApprovalsChanged } from "../api/approvals-events";
import { useShopScope, useShopScopeGuard } from "../auth/ShopScopeProvider";
import { AppTabButton } from "../components/AppTabs";

type ApprovalTab = "voids" | "inward";

function moneyFmt(amount: string): string {
  return `Rs ${amount}`;
}

function cashierLabel(invoice: InvoicePublic): string {
  return invoice.cashier_name?.trim() || `User #${invoice.cashier_user_id}`;
}

function parseTab(value: string | null): ApprovalTab {
  return value === "inward" ? "inward" : "voids";
}

function inwardTotalUnits(item: LotPublic): number {
  return item.lines.reduce((sum, line) => sum + line.quantity, 0);
}

export function ApprovalsPage() {
  const { actingShopId } = useShopScope();
  const shopScopeGuard = useShopScopeGuard();
  const [searchParams, setSearchParams] = useSearchParams();
  const [voidItems, setVoidItems] = useState<InvoicePublic[] | null>(null);
  const [inwardItems, setInwardItems] = useState<LotPublic[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const activeTab = parseTab(searchParams.get("tab"));
  const setActiveTab = useCallback(
    (tab: ApprovalTab) => {
      setSearchParams({ tab });
    },
    [setSearchParams]
  );

  const reload = useCallback(async () => {
    if (shopScopeGuard.blocked) {
      setVoidItems(null);
      setInwardItems(null);
      return;
    }
    setVoidItems(null);
    setInwardItems(null);
    setError(null);
    try {
      const pending = await listPendingApprovals(actingShopId);
      setVoidItems(pending.voids);
      setInwardItems(pending.inward);
    } catch (e) {
      setError(toUserMessage(e, "Could not load approvals."));
    }
  }, [actingShopId, shopScopeGuard.blocked]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const act = async (
    key: string,
    fn: () => Promise<unknown>,
    label: string,
    successMessage: string
  ) => {
    setBusyKey(key);
    setError(null);
    setInfo(null);
    try {
      await fn();
      setInfo(successMessage);
      await reload();
      notifyApprovalsChanged();
    } catch (e) {
      setError(`${label} failed: ${toUserMessage(e, "unknown error")}`);
    } finally {
      setBusyKey(null);
    }
  };

  const visibleItems = useMemo(
    () => (activeTab === "voids" ? voidItems : inwardItems),
    [activeTab, inwardItems, voidItems]
  );
  const voidCount = voidItems?.length ?? 0;
  const inwardCount = inwardItems?.length ?? 0;
  const totalCount = voidCount + inwardCount;

  return (
    <div className="flex flex-col gap-8 font-sans">
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200/50 bg-white/60 p-6 shadow-[0_8px_30px_rgb(0,0,0,0.02)] backdrop-blur-xl">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-bold tracking-tight text-slate-900">
            <ShieldAlert className="h-6 w-6 text-action" /> Approvals
          </h1>
          <p className="mt-1 text-sm font-medium text-slate-500">
            {totalCount > 0
              ? `${totalCount} approval request${totalCount === 1 ? "" : "s"} pending.`
              : "No approval requests are waiting right now."}
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

      {shopScopeGuard.blocked && (
        <div className="rounded-xl bg-slate-50 p-4 text-sm font-medium text-slate-500 ring-1 ring-slate-200">
          {shopScopeGuard.message}
        </div>
      )}
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

      <div className="flex flex-col">
        <div className="app-tab-strip">
          <AppTabButton active={activeTab === "voids"} onClick={() => setActiveTab("voids")}>
            Void Approvals ({voidCount})
          </AppTabButton>
          <AppTabButton active={activeTab === "inward"} onClick={() => setActiveTab("inward")}>
            Inward Approvals ({inwardCount})
          </AppTabButton>
        </div>

        <div className="app-tab-panel">
          {visibleItems === null ? (
            <div className="flex h-32 items-center justify-center rounded-xl border border-slate-200/50 bg-white/60 p-6 shadow-[0_8px_30px_rgb(0,0,0,0.02)] backdrop-blur-xl">
              <div className="text-sm font-medium text-slate-500">Loading...</div>
            </div>
          ) : visibleItems.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white/50 py-12 text-center text-sm font-medium text-slate-500">
              {activeTab === "voids"
                ? "No invoices are awaiting void approval."
                : "No stock inward requests are waiting for approval."}
            </div>
          ) : (
            <ul className="flex flex-col gap-4">
              {activeTab === "voids"
                ? voidItems?.map((invoice) => (
                <li
                  key={`void-${invoice.id}`}
                  className="flex flex-wrap items-center justify-between gap-6 rounded-xl border border-slate-200/50 bg-white/60 p-6 shadow-[0_8px_30px_rgb(0,0,0,0.02)] backdrop-blur-xl transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:shadow-md"
                >
                  <div className="flex flex-col">
                    <span className="text-xl font-bold tracking-tight text-slate-900">Invoice #{invoice.invoice_number}</span>
                    <div className="mt-2 flex flex-wrap items-center gap-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700">Void request</span>
                      <span className="font-mono text-slate-700">id {invoice.id}</span>
                      <span aria-hidden="true" className="text-slate-300">
                        ·
                      </span>
                      <span className="font-mono text-slate-700">{moneyFmt(invoice.total_amount)}</span>
                      <span aria-hidden="true" className="text-slate-300">
                        ·
                      </span>
                      <span>finalized {new Date(invoice.finalized_at).toLocaleString()}</span>
                      <span aria-hidden="true" className="text-slate-300">
                        ·
                      </span>
                      <span>by {cashierLabel(invoice)}</span>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      disabled={busyKey === `void:${invoice.id}`}
                      onClick={() =>
                        void act(
                          `void:${invoice.id}`,
                          () => approveVoid(invoice.id),
                          "Approve",
                          `Approved invoice #${invoice.invoice_number}.`
                        )
                      }
                      className="flex h-10 items-center justify-center gap-2 rounded-xl bg-action px-5 text-sm font-bold tracking-wide text-white shadow-sm transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[var(--color-action)]/30 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50"
                    >
                      <CheckCircle2 className="h-4 w-4" /> Approve
                    </button>
                    <button
                      type="button"
                      disabled={busyKey === `void:${invoice.id}`}
                      onClick={() =>
                        void act(
                          `void:${invoice.id}`,
                          () => rejectVoid(invoice.id),
                          "Reject",
                          `Rejected invoice #${invoice.invoice_number}.`
                        )
                      }
                      className="flex h-10 items-center justify-center gap-2 rounded-xl bg-red-50 px-5 text-sm font-semibold tracking-wide text-red-600 shadow-sm ring-1 ring-red-200 transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:bg-red-100 disabled:opacity-50"
                    >
                      <XCircle className="h-4 w-4" /> Reject
                    </button>
                  </div>
                </li>
                ))
                : inwardItems?.map((item) => (
                <li
                  key={`inward-${item.id}`}
                  className="rounded-xl border border-slate-200/50 bg-white/60 p-6 shadow-[0_8px_30px_rgb(0,0,0,0.02)] backdrop-blur-xl transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:shadow-md"
                >
                  <div className="flex flex-wrap items-start justify-between gap-6">
                    <div className="flex flex-col gap-2">
                      <span className="flex items-center gap-3 text-xl font-bold tracking-tight text-slate-900">
                        <PackagePlus className="h-5 w-5 text-action" /> Inward #{item.id}
                      </span>
                      <div className="flex flex-wrap items-center gap-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-700">Pending inward</span>
                        <span className="font-mono text-slate-700">shop {item.shop_id}</span>
                        <span aria-hidden="true" className="text-slate-300">
                          ·
                        </span>
                        <span>created {new Date(item.created_at).toLocaleString()}</span>
                        <span aria-hidden="true" className="text-slate-300">
                          ·
                        </span>
                        <span>by {item.created_by_name ?? `user #${item.received_by_user_id}`}</span>
                      </div>
                      <div className="text-sm font-medium text-slate-600">
                        {item.vendor?.name ?? "No vendor linked"} · Ref {item.reference ?? "--"}
                      </div>
                    </div>
                    <div className="flex gap-3">
                      <button
                        type="button"
                        disabled={busyKey === `inward:${item.id}`}
                        onClick={() =>
                          void act(
                            `inward:${item.id}`,
                            () => approveLot(item.id),
                            "Approve",
                            `Approved inward #${item.id}.`
                          )
                        }
                        className="flex h-10 items-center justify-center gap-2 rounded-xl bg-action px-5 text-sm font-bold tracking-wide text-white shadow-sm transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[var(--color-action)]/30 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50"
                      >
                        <CheckCircle2 className="h-4 w-4" /> Approve
                      </button>
                      <button
                        type="button"
                        disabled={busyKey === `inward:${item.id}`}
                        onClick={() =>
                          void act(
                            `inward:${item.id}`,
                            () => rejectLot(item.id),
                            "Reject",
                            `Rejected inward #${item.id}.`
                          )
                        }
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
                        {item.lines.length} / {inwardTotalUnits(item)}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
