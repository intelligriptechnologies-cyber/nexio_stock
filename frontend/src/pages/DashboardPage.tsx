import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  getEodHistory,
  getEodTotals,
  getLowStock,
  getStockOverview,
  type EodTotalsResponse,
  type LowStockResponse,
  type SignOffResponse,
  type StockOverviewResponse,
} from "../api/dashboard";
import { toUserMessage } from "../api/client";
import { listPendingProducts } from "../api/products";
import { listPendingVoids } from "../api/voids";
import { useShopScope, useShopScopeGuard } from "../auth/ShopScopeProvider";
import { Calendar, Banknote, ShieldAlert, CheckCircle2, RefreshCw, Box, Map, History, LayoutDashboard } from "lucide-react";

function moneyFmt(s: string): string {
  return `₹${Number(s).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export function DashboardPage() {
  const { actingShopId } = useShopScope();
  const shopScopeGuard = useShopScopeGuard();
  const [today, setToday] = useState<EodTotalsResponse | null>(null);
  const [lowStock, setLowStock] = useState<LowStockResponse | null>(null);
  const [history, setHistory] = useState<SignOffResponse[] | null>(null);
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [voidApprovalCount, setVoidApprovalCount] = useState<number | null>(null);
  // Issue #41 — cross-shop stock overview (owner/superadmin only).
  // null while loading or for non-authorized roles; the section
  // renders nothing in those cases.
  const [stockOverview, setStockOverview] = useState<StockOverviewResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = async () => {
    if (shopScopeGuard.blocked) {
      setToday(null);
      setLowStock(null);
      setHistory(null);
      setPendingCount(null);
      setVoidApprovalCount(null);
      setStockOverview(null);
      return;
    }
    setError(null);
    try {
      // Issue #41 — stock overview is owner/superadmin only; for
      // other roles the call 403s and we render an empty section.
      // The catch keeps the rest of the batch alive (mirrors how
      // listPendingProducts is wrapped below).
      const [t, l, h, p, v, so] = await Promise.all([
        getEodTotals(undefined, actingShopId),
        getLowStock(undefined, actingShopId),
        getEodHistory(20, actingShopId),
        // Issue #25 — the pending-products badge count. Fetched
        // alongside the other dashboard data so the badge appears
        // immediately when the dashboard mounts.
        listPendingProducts(actingShopId).catch(() => []),
        listPendingVoids(actingShopId).catch(() => ({ invoices: [] })),
        getStockOverview().catch(() => null),
      ]);
      setToday(t);
      setLowStock(l);
      setHistory(h.signoffs);
      setPendingCount(p.length);
      setVoidApprovalCount(v.invoices.length);
      setStockOverview(so);
    } catch (e) {
      setError(toUserMessage(e, "Load failed."));
    }
  };

  useEffect(() => {
    void reload();
  }, [actingShopId]);
  return (
    <div className="flex flex-col gap-section-gap p-6 font-sans">
      <header className="flex flex-wrap items-center justify-between gap-stack-gap rounded-xl border border-slate-200/50 bg-white/60 p-6 shadow-sm backdrop-blur-xl">
        <h1 className="flex items-center gap-3 text-2xl font-light tracking-tight text-slate-900">
          <LayoutDashboard className="h-6 w-6 text-action" /> Owner Dashboard
        </h1>
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
      {/* Pending Products badge (issue #25). Surfaces the count of
          products awaiting a price; clicking jumps to the activation
          screen. Hidden when the count is zero (no need to nag) and
          when the user hasn't picked a shop yet. */}
      {pendingCount != null && pendingCount > 0 && (
        <Link
          to="/admin/pending"
          className="flex items-center justify-between rounded-2xl bg-amber-50 p-6 text-amber-950 shadow-sm ring-1 ring-amber-200 transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-md active:scale-[0.97]"
          data-testid="pending-badge"
          role="status"
        >
          <div>
            <div className="text-lg font-bold tracking-tight">
              {pendingCount} product{pendingCount === 1 ? "" : "s"} awaiting a price
            </div>
            <div className="text-sm font-medium text-amber-800">
              Tap to open Pending and set their prices.
            </div>
          </div>
          <span aria-hidden="true" className="text-2xl font-light">→</span>
        </Link>
      )}
      {voidApprovalCount != null && voidApprovalCount > 0 && (
        <Link
          to="/admin/voids"
          className="flex items-center justify-between rounded-2xl bg-amber-50 p-6 text-amber-950 shadow-sm ring-1 ring-amber-200 transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-md active:scale-[0.97]"
          role="status"
        >
          <div>
            <div className="text-lg font-bold tracking-tight">
              {voidApprovalCount} void approval{voidApprovalCount === 1 ? "" : "s"} pending
            </div>
            <div className="text-sm font-medium text-amber-800">
              Resolve approvals before closing EOD.
            </div>
          </div>
          <span aria-hidden="true" className="text-2xl font-light">→</span>
        </Link>
      )}

      {/* KPI cards */}
      <section className="grid grid-cols-1 gap-section-gap md:grid-cols-2 xl:grid-cols-4">
        <KpiCard icon={<Calendar className="h-5 w-5" />} title="Business date" value={today?.business_date ?? "—"} accent="primary" delayMs={0} />
        <KpiCard
          icon={<Banknote className="h-5 w-5" />}
          title="Revenue"
          value={today ? moneyFmt(today.revenue) : "—"}
          accent="primary"
          sub={`${today?.invoice_count ?? 0} invoice(s)`}
          delayMs={60}
        />
        <KpiCard
          icon={<ShieldAlert className="h-5 w-5" />}
          title="Voids"
          value={`${(today?.voided_count ?? 0) + (today?.reversal_count ?? 0)}`}
          accent="warning"
          sub={`${today?.voided_count ?? 0} voided + ${today?.reversal_count ?? 0} reversed`}
          delayMs={120}
        />
        <KpiCard
          icon={<CheckCircle2 className="h-5 w-5" />}
          title="EOD status"
          value={today?.signed_off ? "Signed off" : "Open"}
          accent={today?.signed_off ? "success" : "warning"}
          delayMs={180}
        />
      </section>

      {/* Payment mode split */}
      <section className="rounded-xl border border-slate-200/50 bg-white/60 p-8 shadow-[0_8px_30px_rgb(0,0,0,0.02)] backdrop-blur-xl transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:shadow-[0_8px_40px_rgb(0,0,0,0.04)]">
        <h2 className="mb-6 flex items-center gap-2 text-xl font-light tracking-tight text-slate-900">
          <Banknote className="h-5 w-5 text-slate-400" /> Payment Mode Split
        </h2>
        {today && today.payments_by_mode.length > 0 ? (
          <ul className="flex flex-col gap-3">
            {today.payments_by_mode.map((p) => (
              <li
                key={p.mode}
                className="flex items-center justify-between rounded-xl bg-slate-50 p-4 shadow-sm ring-1 ring-slate-200"
              >
                <span className="font-semibold text-slate-900">{p.mode}</span>
                <span className="font-mono font-medium text-slate-700">
                  {moneyFmt(p.amount)} · {p.count} txn(s)
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-on-surface-variant">No payments recorded yet today.</div>
        )}
      </section>

      {/* Low-stock list */}
      <section className="rounded-xl border border-slate-200/50 bg-white/60 p-8 shadow-[0_8px_30px_rgb(0,0,0,0.02)] backdrop-blur-xl transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:shadow-[0_8px_40px_rgb(0,0,0,0.04)]">
        <h2 className="mb-6 flex items-center gap-2 text-xl font-light tracking-tight text-slate-900">
          <Box className="h-5 w-5 text-slate-400" /> Low Stock
        </h2>
        {lowStock === null ? (
          <div className="text-on-surface-variant">Loading…</div>
        ) : lowStock.items.length === 0 ? (
          <div className="text-on-surface-variant">
            No products at or below threshold.
            <div className="text-label-md">
              Evaluated {new Date(lowStock.evaluated_at).toLocaleString()}.
            </div>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-200/60 bg-white shadow-sm">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50/80 text-[11px] uppercase tracking-widest text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-semibold">Product</th>
                  <th className="px-5 py-3 font-semibold">Barcode</th>
                  <th className="px-5 py-3 text-right font-semibold">Stock</th>
                  <th className="px-5 py-3 text-right font-semibold">Threshold</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {lowStock.items.map((it) => (
                  <tr key={it.product_id} className="group bg-white transition-colors duration-200 hover:bg-slate-50/50">
                    <td className="px-5 py-3 font-medium text-slate-900 transition-colors group-hover:text-slate-700">
                      {it.brand} <span className="font-normal text-slate-500">{it.size_label}</span>
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-slate-400">{it.barcode}</td>
                    <td className="px-5 py-3 text-right font-mono text-slate-900 font-medium">
                      <span className="inline-flex items-center rounded-md bg-error/10 px-2 py-1 text-xs font-semibold text-error">
                        {it.current_stock}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right font-mono text-slate-500">{it.effective_threshold}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Issue #41 — cross-shop stock overview (owner/superadmin only).
          Hidden for other roles: stockOverview is null on 403. */}
      {stockOverview && stockOverview.shops.length > 0 && (
        <section className="rounded-xl border border-slate-200/50 bg-white/60 p-8 shadow-[0_8px_30px_rgb(0,0,0,0.02)] backdrop-blur-xl transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:shadow-[0_8px_40px_rgb(0,0,0,0.04)]">
          <h2 className="mb-6 flex items-center gap-2 text-xl font-light tracking-tight text-slate-900">
            <Map className="h-5 w-5 text-slate-400" /> Stock Across All Shops
          </h2>
          {stockOverview.shops.map((g) => (
            <div key={g.shop_id} className="mb-8">
              <h3 className="mb-3 ml-2 text-[13px] font-bold uppercase tracking-widest text-slate-500">
                {g.shop_name}
              </h3>
              {g.items.length === 0 ? (
                <div className="text-on-surface-variant">
                  No products in this shop.
                </div>
              ) : (
                <div className="overflow-hidden rounded-2xl border border-slate-200/60 bg-white shadow-sm">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-slate-50/80 text-[11px] uppercase tracking-widest text-slate-500">
                      <tr>
                        <th className="px-5 py-3 font-semibold">Product</th>
                        <th className="px-5 py-3 font-semibold">Barcode</th>
                        <th className="px-5 py-3 text-right font-semibold">Stock</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {g.items.map((it) => (
                        <tr
                          key={`${g.shop_id}-${it.product_id}`}
                          className="group bg-white transition-colors duration-200 hover:bg-slate-50/50"
                        >
                          <td className="px-5 py-3 font-medium text-slate-900 transition-colors group-hover:text-slate-700">
                            {it.brand} <span className="font-normal text-slate-500">{it.size_label}</span>
                          </td>
                          <td className="px-5 py-3 font-mono text-xs text-slate-400">
                            {it.barcode}
                          </td>
                          <td className="px-5 py-3 text-right font-mono text-slate-900 font-medium">
                            {it.current_stock}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
          <div className="mt-6 flex items-center gap-2 text-xs font-medium text-slate-400">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
            </span>
            Evaluated {new Date(stockOverview.evaluated_at).toLocaleString()}
          </div>
        </section>
      )}
      {/* Past sign-offs */}
      <section className="rounded-xl border border-slate-200/50 bg-white/60 p-8 shadow-[0_8px_30px_rgb(0,0,0,0.02)] backdrop-blur-xl transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:shadow-[0_8px_40px_rgb(0,0,0,0.04)]">
        <h2 className="mb-6 flex items-center gap-2 text-xl font-light tracking-tight text-slate-900">
          <History className="h-5 w-5 text-slate-400" /> Past Sign-offs
        </h2>
        {history === null ? (
          <div className="text-on-surface-variant">Loading…</div>
        ) : history.length === 0 ? (
          <div className="text-on-surface-variant">No prior EOD sign-offs recorded.</div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-slate-200/60 bg-white shadow-sm">
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50/80 text-[11px] uppercase tracking-widest text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-semibold">Business Date</th>
                  <th className="px-5 py-3 font-semibold">Signed Off At</th>
                  <th className="px-5 py-3 text-right font-semibold">Invoices Locked</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {history.map((s) => (
                  <tr key={s.business_date} className="group bg-white transition-colors duration-200 hover:bg-slate-50/50">
                    <td className="px-5 py-3 font-medium text-slate-900">{s.business_date}</td>
                    <td className="px-5 py-3 text-slate-500">{new Date(s.signed_off_at).toLocaleString()}</td>
                    <td className="px-5 py-3 text-right font-mono text-slate-900 font-medium">{s.invoices_signed_off}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function KpiCard({
  icon,
  title,
  value,
  sub,
  accent,
  delayMs = 0,
}: {
  icon?: React.ReactNode;
  title: string;
  value: string;
  sub?: string;
  accent: "primary" | "success" | "warning";
  delayMs?: number;
}) {
  const bg =
    accent === "success"
      ? "border border-emerald-200/60 bg-emerald-50/40 text-emerald-950 shadow-sm"
      : accent === "warning"
        ? "border border-amber-200/60 bg-amber-50/40 text-amber-950 shadow-sm"
        : "border border-slate-200/60 bg-white/60 text-slate-900 shadow-sm";
  return (
    <div
      style={{ animationDelay: `${delayMs}ms` }}
      className={`group relative flex flex-col gap-1.5 overflow-hidden rounded-xl p-6 backdrop-blur-xl opacity-0 transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out animate-fade-in hover:-translate-y-1 hover:shadow-[0_12px_40px_rgba(0,0,0,0.06)] ${bg}`}
    >
      <div className="pointer-events-none absolute -right-6 -top-6 h-28 w-28 rounded-full bg-gradient-to-br from-transparent to-slate-200/30 blur-2xl transition-transform duration-700 group-hover:scale-150" />
      <div className="relative z-10 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.15em] text-slate-500">
        {icon && <span className="opacity-70">{icon}</span>}
        {title}
      </div>
      <div className="relative z-10 font-mono text-[32px] font-light tracking-tight">{value}</div>
      {sub && <div className="relative z-10 mt-1 text-xs font-medium text-slate-400">{sub}</div>}
    </div>
  );
}
