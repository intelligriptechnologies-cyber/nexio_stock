import { useEffect, useState } from "react";
import {
  getEodHistory,
  getEodTotals,
  getLowStock,
  signOffEod,
  type EodTotalsResponse,
  type LowStockResponse,
  type SignOffResponse,
} from "../api/dashboard";
import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthProvider";
import { useShopScope } from "../auth/ShopScopeProvider";

function moneyFmt(s: string): string {
  return `₹${Number(s).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export function DashboardPage() {
  const { user } = useAuth();
  const { actingShopId } = useShopScope();
  const [today, setToday] = useState<EodTotalsResponse | null>(null);
  const [lowStock, setLowStock] = useState<LowStockResponse | null>(null);
  const [history, setHistory] = useState<SignOffResponse[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    if (user?.role === "superadmin" && actingShopId === null) {
      setToday(null);
      setLowStock(null);
      setHistory(null);
      return;
    }
    setError(null);
    setInfo(null);
    try {
      const [t, l, h] = await Promise.all([
        getEodTotals(undefined, actingShopId),
        getLowStock(undefined, actingShopId),
        getEodHistory(20, actingShopId),
      ]);
      setToday(t);
      setLowStock(l);
      setHistory(h.signoffs);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed.");
    }
  };

  useEffect(() => {
    void reload();
  }, [actingShopId]);

  const signOff = async () => {
    if (!today) return;
    if (!confirm(`Mark ${today.business_date} as end-of-day? This locks the day's sales.`)) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const res = await signOffEod(today.business_date, actingShopId);
      setInfo(`Signed off ${res.business_date} — ${res.invoices_signed_off} invoices locked.`);
      await reload();
    } catch (e) {
      if (e instanceof ApiError) setError(`EOD sign-off failed: ${e.detail}`);
      else setError(e instanceof Error ? e.message : "EOD sign-off failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-gutter">
      <header className="flex flex-wrap items-center justify-between gap-stack-gap">
        <h1 className="text-headline-lg text-primary">Owner Dashboard</h1>
        <button
          type="button"
          onClick={() => void reload()}
          className="min-h-touchTarget-sm rounded-md bg-surface-container-high px-stack-gap text-label-md"
        >
          Refresh
        </button>
      </header>

      {user?.role === "superadmin" && actingShopId === null && (
        <div className="rounded-md bg-surface-container p-stack-gap text-on-surface-variant">
          Pick a shop first (top of the sidebar).
        </div>
      )}
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

      {/* KPI cards */}
      <section className="grid grid-cols-1 gap-stack-gap md:grid-cols-2 xl:grid-cols-4">
        <KpiCard title="Business date" value={today?.business_date ?? "—"} accent="primary" />
        <KpiCard
          title="Revenue"
          value={today ? moneyFmt(today.revenue) : "—"}
          accent="primary"
          sub={`${today?.invoice_count ?? 0} invoice(s)`}
        />
        <KpiCard
          title="Voids"
          value={`${(today?.voided_count ?? 0) + (today?.reversal_count ?? 0)}`}
          accent="warning"
          sub={`${today?.voided_count ?? 0} voided + ${today?.reversal_count ?? 0} reversed`}
        />
        <KpiCard
          title="EOD status"
          value={today?.signed_off ? "Signed off" : "Open"}
          accent={today?.signed_off ? "success" : "warning"}
        />
      </section>

      {/* Payment mode split */}
      <section className="rounded-lg bg-surface-container p-gutter">
        <h2 className="mb-stack-gap text-headline-md text-primary">Payment mode split</h2>
        {today && today.payments_by_mode.length > 0 ? (
          <ul className="flex flex-col gap-stack-gap">
            {today.payments_by_mode.map((p) => (
              <li
                key={p.mode}
                className="flex items-center justify-between rounded-md bg-surface px-stack-gap py-2 text-label-md"
              >
                <span className="text-label-xl">{p.mode}</span>
                <span className="font-mono">
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
      <section className="rounded-lg bg-surface-container p-gutter">
        <h2 className="mb-stack-gap text-headline-md text-primary">Low stock</h2>
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
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-outline text-label-md text-on-surface-variant">
                <th className="py-2 text-left">Product</th>
                <th className="py-2 text-left">Barcode</th>
                <th className="py-2 text-right">Stock</th>
                <th className="py-2 text-right">Threshold</th>
              </tr>
            </thead>
            <tbody>
              {lowStock.items.map((it) => (
                <tr key={it.product_id} className="border-b border-outline/40">
                  <td className="py-2">{it.brand} {it.size_label}</td>
                  <td className="py-2 font-mono text-label-md">{it.barcode}</td>
                  <td className="py-2 text-right font-mono">{it.current_stock}</td>
                  <td className="py-2 text-right font-mono">{it.effective_threshold}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Mark day end */}
      <section className="flex items-center justify-between rounded-lg bg-surface-container p-gutter">
        <div>
          <h2 className="text-headline-md text-primary">Mark day end</h2>
          <p className="text-label-md text-on-surface-variant">
            Closes out today&apos;s sales. Subsequent same-day invoices are rejected.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void signOff()}
          disabled={!today || today.signed_off || busy}
          className="min-h-touchTarget rounded-md bg-primary px-gutter text-label-xl text-on-primary disabled:opacity-50"
        >
          {busy ? "Signing off…" : today?.signed_off ? "Already signed off" : "MARK DAY END"}
        </button>
      </section>

      {/* Past sign-offs */}
      <section className="rounded-lg bg-surface-container p-gutter">
        <h2 className="mb-stack-gap text-headline-md text-primary">Past sign-offs</h2>
        {history === null ? (
          <div className="text-on-surface-variant">Loading…</div>
        ) : history.length === 0 ? (
          <div className="text-on-surface-variant">No prior EOD sign-offs recorded.</div>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-outline text-label-md text-on-surface-variant">
                <th className="py-2 text-left">Business date</th>
                <th className="py-2 text-left">Signed off at</th>
                <th className="py-2 text-right">Invoices locked</th>
              </tr>
            </thead>
            <tbody>
              {history.map((s) => (
                <tr key={s.business_date} className="border-b border-outline/40">
                  <td className="py-2">{s.business_date}</td>
                  <td className="py-2">{new Date(s.signed_off_at).toLocaleString()}</td>
                  <td className="py-2 text-right font-mono">{s.invoices_signed_off}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function KpiCard({
  title,
  value,
  sub,
  accent,
}: {
  title: string;
  value: string;
  sub?: string;
  accent: "primary" | "success" | "warning";
}) {
  const bg =
    accent === "success"
      ? "bg-success text-on-secondary"
      : accent === "warning"
      ? "bg-warning text-on-accent"
      : "bg-primary text-on-primary";
  return (
    <div className={`flex flex-col gap-1 rounded-lg p-gutter ${bg}`}>
      <div className="text-label-md uppercase opacity-90">{title}</div>
      <div className="font-mono text-headline-md">{value}</div>
      {sub && <div className="text-label-md opacity-90">{sub}</div>}
    </div>
  );
}