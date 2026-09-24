import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Download, FileUp, PackageCheck, RefreshCw, Save, ShieldCheck, XCircle } from "lucide-react";
import { toUserMessage } from "../api/client";
import {
  cancelPurchaseOrder,
  confirmPurchaseOrder,
  downloadPurchaseOrder,
  importPurchaseOrder,
  listPurchaseOrders,
  updatePurchaseOrder,
  type PurchaseOrder,
} from "../api/purchase-orders";
import { useAuth } from "../auth/AuthProvider";
import { useShopScope } from "../auth/ShopScopeProvider";

export function PurchaseOrdersPage() {
  const { user } = useAuth();
  const { actingShopId } = useShopScope();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [selected, setSelected] = useState<PurchaseOrder | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const blocked = user?.role === "superadmin" && actingShopId == null;
  const canConfirm = user?.role === "owner" || user?.role === "superadmin";

  const refresh = useCallback(async () => {
    if (blocked) return;
    setBusy(true);
    try {
      const response = await listPurchaseOrders(actingShopId);
      setOrders(response.purchase_orders);
      setSelected((current) => current ? response.purchase_orders.find((row) => row.id === current.id) ?? null : null);
      setError(null);
    } catch (e) {
      setError(toUserMessage(e, "Could not load purchase orders."));
    } finally {
      setBusy(false);
    }
  }, [actingShopId, blocked]);

  useEffect(() => { void refresh(); }, [refresh]);

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const order = await importPurchaseOrder(file, actingShopId);
      setSelected(order);
      setInfo(`Imported ${file.name} as draft PO #${order.id}.`);
      await refresh();
    } catch (e) {
      setError(toUserMessage(e, "Import failed."));
    } finally {
      setBusy(false);
    }
  };

  const mutate = async (action: () => Promise<PurchaseOrder>, message: string) => {
    setBusy(true);
    setError(null);
    try {
      const order = await action();
      setSelected(order);
      setInfo(message);
      await refresh();
    } catch (e) {
      setError(toUserMessage(e, "Action failed."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 font-sans">
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white/70 p-6 shadow-sm">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">OSBCL Purchase Orders</h1>
          <p className="mt-1 text-sm text-slate-500">Import, review, confirm, and reconcile ordered stock.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => void refresh()} disabled={busy || blocked} className="app-button-secondary flex items-center gap-2"><RefreshCw className="h-4 w-4" /> Refresh</button>
          <label className={`app-button-primary flex cursor-pointer items-center gap-2 ${busy || blocked ? "pointer-events-none opacity-50" : ""}`}>
            <FileUp className="h-4 w-4" /> Import OSBCL PDF
            <input type="file" accept="application/pdf,.pdf" className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ""; }} />
          </label>
        </div>
      </header>

      {blocked && <Notice text="Pick a shop first (top of the sidebar)." tone="warning" />}
      {error && <Notice text={error} tone="error" />}
      {info && <Notice text={info} tone="success" />}

      <div className="grid gap-6 xl:grid-cols-[minmax(320px,0.8fr)_minmax(0,2fr)]">
        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4 font-bold">Orders</div>
          {orders.length === 0 ? <p className="p-6 text-sm text-slate-500">No purchase orders imported.</p> : (
            <div className="divide-y divide-slate-100">
              {orders.map((order) => (
                <button key={order.id} type="button" onClick={() => setSelected(order)} className={`w-full p-5 text-left hover:bg-slate-50 ${selected?.id === order.id ? "bg-amber-50" : ""}`}>
                  <div className="flex items-center justify-between gap-2"><span className="font-bold">#{order.id} {order.osbcl_token ?? "Token needs review"}</span><Status value={order.status} /></div>
                  <div className="mt-2 text-sm text-slate-500">{order.order_date ?? "No date"} · {order.lines.length} lines · ₹{money(order.order_total)}</div>
                </button>
              ))}
            </div>
          )}
        </section>

        <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          {!selected ? <p className="p-10 text-center text-sm text-slate-500">Select an order to review it.</p> : (
            <OrderReview
              order={selected}
              canConfirm={canConfirm}
              busy={busy}
              onChange={setSelected}
              onSave={() => void mutate(() => updatePurchaseOrder(selected), "Draft saved.")}
              onConfirm={() => void mutate(() => confirmPurchaseOrder(selected.id), "Purchase order confirmed.")}
              onCancel={() => { const reason = window.prompt("Cancellation reason"); if (reason?.trim()) void mutate(() => cancelPurchaseOrder(selected.id, reason.trim()), "Purchase order cancelled."); }}
              onDownload={() => void downloadPurchaseOrder(selected.id, selected.source_filename)}
              onReceive={() => navigate(`/receiving?purchase_order_id=${selected.id}`)}
            />
          )}
        </section>
      </div>
    </div>
  );
}

function OrderReview({ order, canConfirm, busy, onChange, onSave, onConfirm, onCancel, onDownload, onReceive }: {
  order: PurchaseOrder; canConfirm: boolean; busy: boolean; onChange: (order: PurchaseOrder) => void; onSave: () => void; onConfirm: () => void; onCancel: () => void; onDownload: () => void; onReceive: () => void;
}) {
  const draft = order.status === "draft";
  const setHeader = (key: keyof PurchaseOrder, value: string) => onChange({ ...order, [key]: value || null });
  const setLine = (index: number, patch: Partial<PurchaseOrder["lines"][number]>) => onChange({ ...order, lines: order.lines.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line) });
  return <>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-5">
      <div><h2 className="text-lg font-bold">PO #{order.id}</h2><p className="text-xs text-slate-500">{order.source_filename} · {order.page_count} pages · OCR {order.extraction_confidence ? `${(Number(order.extraction_confidence) * 100).toFixed(1)}%` : "unavailable"}</p></div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className="app-button-secondary flex items-center gap-1" onClick={onDownload}><Download className="h-4 w-4" /> Original</button>
        {draft && <button type="button" disabled={busy} className="app-button-secondary flex items-center gap-1" onClick={onSave}><Save className="h-4 w-4" /> Save draft</button>}
        {draft && canConfirm && <button type="button" disabled={busy} className="app-button-primary flex items-center gap-1" onClick={onConfirm}><ShieldCheck className="h-4 w-4" /> Confirm</button>}
        {!draft && order.status !== "cancelled" && <button type="button" className="app-button-primary flex items-center gap-1" onClick={onReceive}><PackageCheck className="h-4 w-4" /> Receive</button>}
        {canConfirm && order.status !== "cancelled" && <button type="button" className="app-button-secondary flex items-center gap-1 text-red-700" onClick={onCancel}><XCircle className="h-4 w-4" /> Cancel</button>}
      </div>
    </div>
    {order.review_flags.length > 0 && <div className="m-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><strong>Review required:</strong><ul className="mt-1 list-disc pl-5">{order.review_flags.map((flag) => <li key={flag}>{flag}</li>)}</ul></div>}
    <div className="grid gap-3 p-5 sm:grid-cols-3">
      <Field label="Token" value={order.osbcl_token ?? ""} disabled={!draft} onChange={(value) => setHeader("osbcl_token", value)} />
      <Field label="Order date" type="date" value={order.order_date ?? ""} disabled={!draft} onChange={(value) => setHeader("order_date", value)} />
      <Field label="Order type" value={order.order_type ?? ""} disabled={!draft} onChange={(value) => setHeader("order_type", value)} />
      <Field label="Retailer code" value={order.retailer_code ?? ""} disabled={!draft} onChange={(value) => setHeader("retailer_code", value)} />
      <Field label="Vehicle" value={order.vehicle_number ?? ""} disabled={!draft} onChange={(value) => setHeader("vehicle_number", value)} />
      <Field label="Order total" value={order.order_total ?? ""} disabled={!draft} onChange={(value) => setHeader("order_total", value)} />
    </div>
    <div className="overflow-x-auto border-t border-slate-200">
      <table className="min-w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="p-3">Item / product</th><th className="p-3">Size</th><th className="p-3">Cases + loose</th><th className="p-3">Ordered</th><th className="p-3">Delivered / accepted / broken</th><th className="p-3">Remaining / excess</th><th className="p-3">Amount</th></tr></thead>
      <tbody className="divide-y divide-slate-100">{order.lines.map((line, index) => <tr key={line.id} className={!line.product_id || !line.pack_size_snapshot ? "bg-amber-50/60" : ""}>
        <td className="min-w-72 p-3"><div className="font-medium">{line.source_item_name}</div>{draft ? <select aria-label={`Product match for ${line.source_item_name}`} className="mt-2 w-full rounded border border-slate-300 p-2" value={line.product_id ?? ""} onChange={(event) => setLine(index, { product_id: event.target.value ? Number(event.target.value) : null })}><option value="">Select active product…</option>{line.match_candidates.map((candidate) => <option key={candidate.product_id} value={candidate.product_id}>{candidate.brand} {candidate.size_label} ({Math.round(candidate.score * 100)}%)</option>)}</select> : <div className="mt-1 text-xs text-slate-500">{line.product_brand ?? "No product"} {line.product_size_label ?? ""}</div>}</td>
        <td className="p-3">{draft ? <input aria-label="Bottle size ml" type="number" className="w-20 rounded border p-2" value={line.size_ml ?? ""} onChange={(event) => setLine(index, { size_ml: event.target.value ? Number(event.target.value) : null })} /> : `${line.size_ml ?? "?"} ml`}<div className="text-xs text-slate-500">pack {line.pack_size_snapshot ?? "missing"}</div></td>
        <td className="p-3">{draft ? <div className="flex gap-1"><input aria-label="Cases" type="number" className="w-16 rounded border p-2" value={line.cases} onChange={(event) => setLine(index, { cases: Number(event.target.value) })} /><input aria-label="Loose bottles" type="number" className="w-16 rounded border p-2" value={line.loose_bottles} onChange={(event) => setLine(index, { loose_bottles: Number(event.target.value) })} /></div> : `${line.cases} + ${line.loose_bottles}`}</td>
        <td className="p-3 font-semibold">{line.ordered_bottles ?? "—"}</td><td className="p-3">{line.delivered_bottles} / {line.accepted_bottles} / {line.broken_bottles}</td><td className="p-3"><span className="text-emerald-700">{line.remaining_bottles}</span> / <span className="text-red-700">{line.excess_bottles}</span></td><td className="p-3">₹{money(line.amount)}</td>
      </tr>)}</tbody></table>
    </div>
  </>;
}

function Field({ label, value, onChange, disabled, type = "text" }: { label: string; value: string; onChange: (value: string) => void; disabled: boolean; type?: string }) { return <label className="text-xs font-bold uppercase text-slate-500">{label}<input type={type} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal normal-case text-slate-900 disabled:bg-slate-50" /></label>; }
function Status({ value }: { value: string }) { return <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-bold uppercase text-slate-600">{value.replace("_", " ")}</span>; }
function Notice({ text, tone }: { text: string; tone: "error" | "success" | "warning" }) { const colors = tone === "error" ? "border-red-200 bg-red-50 text-red-800" : tone === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"; return <div className={`rounded-xl border p-4 text-sm ${colors}`}>{text}</div>; }
function money(value: string | null): string { return value == null ? "—" : Number(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
