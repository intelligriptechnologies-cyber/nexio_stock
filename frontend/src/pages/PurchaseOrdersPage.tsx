import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Download, FileUp, RefreshCw, Save, Search, ShieldCheck, X, XCircle } from "lucide-react";
import { ApiError, toUserMessage } from "../api/client";
import { cancelPurchaseOrder, deletePurchaseOrder, downloadPurchaseOrder, finalizePurchaseOrder, importPurchaseOrder, listPurchaseOrders, updatePurchaseOrder, type PurchaseOrder } from "../api/purchase-orders";
import { prefetchCatalog, type CatalogProduct } from "../api/catalog";
import { useAuth } from "../auth/AuthProvider";
import { useShopScope } from "../auth/ShopScopeProvider";
import { ModalDialog } from "../components/ModalDialog";

type Filters = { query: string; status: string; from: string; to: string };
const emptyFilters: Filters = { query: "", status: "", from: "", to: "" };

export function PurchaseOrdersPage() {
  const { user } = useAuth();
  const { actingShopId } = useShopScope();
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [selected, setSelected] = useState<PurchaseOrder | null>(null);
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [importProgress, setImportProgress] = useState<{
    percent: number;
    stage: string;
  } | null>(null);
  const [importInProgress, setImportInProgress] = useState(false);
  const blocked = user?.role === "superadmin" && actingShopId == null;
  const canConfirm = user?.role === "owner" || user?.role === "superadmin";
  const refresh = useCallback(async () => {
    if (blocked) return;
    setBusy(true);
    try {
      const response = await listPurchaseOrders(actingShopId);
      setOrders(response.purchase_orders);
      setSelected((current) => (current ? (response.purchase_orders.find((row) => row.id === current.id) ?? current) : null));
      setError(null);
    } catch (e) {
      setError(toUserMessage(e, "Could not load purchase orders."));
    } finally {
      setBusy(false);
    }
  }, [actingShopId, blocked]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (!blocked)
      void prefetchCatalog(actingShopId)
        .then((catalog) => setProducts([...catalog.values()]))
        .catch((e) => setError(toUserMessage(e, "Could not load the active product catalog.")));
  }, [actingShopId, blocked]);
  useEffect(() => {
    if (!importInProgress) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [importInProgress]);
  const filteredOrders = useMemo(() => {
    const query = filters.query.trim().toLocaleLowerCase();
    return orders.filter((order) => {
      const queryMatches =
        !query ||
        [order.id, order.osbcl_token, order.retailer_name, order.vendor_invoice_number].some((value) =>
          String(value ?? "")
            .toLocaleLowerCase()
            .includes(query),
        );
      return queryMatches && (!filters.status || order.status === filters.status) && (!filters.from || (order.order_date != null && order.order_date >= filters.from)) && (!filters.to || (order.order_date != null && order.order_date <= filters.to));
    });
  }, [filters, orders]);
  const upload = async (file: File) => {
    setBusy(true);
    setImportInProgress(true);
    setImportProgress({ percent: 10, stage: "Validating selected PDF" });
    setError(null);
    setInfo(null);
    const stages = [
      [30, "Extracting PDF", 300],
      [55, "Modulating and creating mapping", 800],
      [75, "Fetching quantity matches and pricing", 1300],
      [90, "Finalizing purchase order", 1800],
    ] as const;
    const timers = stages.map(([percent, stage, delay]) => window.setTimeout(() => setImportProgress({ percent, stage }), delay));
    let completed = false;
    try {
      const order = await importPurchaseOrder(file, actingShopId);
      completed = true;
      setImportProgress({
        percent: 100,
        stage: "Purchase order import complete",
      });
      setSelected(order);
      setInfo(`Imported ${file.name} as draft PO #${order.id}.`);
      await refresh();
    } catch (e) {
      const code = e instanceof ApiError && typeof e.body === "object" && e.body !== null && "detail" in e.body && typeof e.body.detail === "object" && e.body.detail !== null && "code" in e.body.detail ? e.body.detail.code : undefined;
      setError(e instanceof ApiError && e.status === 422 && code === "unsupported_po_content" ? "Could not retrieve expected information, please verify PDF content or contact System Admin." : toUserMessage(e, "Import failed."));
    } finally {
      timers.forEach(window.clearTimeout);
      setImportInProgress(false);
      setBusy(false);
      window.setTimeout(() => setImportProgress(null), completed ? 500 : 0);
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
  const deleteDraft = async (order: PurchaseOrder) => {
    if (!window.confirm("Delete this draft purchase order permanently? Its line items and original PDF will be removed. You can import the same PDF again afterward.")) return;
    setBusy(true);
    setError(null);
    try {
      await deletePurchaseOrder(order.id);
      setSelected(null);
      setInfo("Draft purchase order deleted. The original PDF can now be imported again.");
      await refresh();
    } catch (e) {
      setError(toUserMessage(e, "Could not delete the draft purchase order."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex min-w-0 flex-col gap-6 font-sans">
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white/70 p-6 shadow-sm">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">OSBCL Purchase Orders</h1>
          <p className="mt-1 text-sm text-slate-500">Import, review, confirm, and reconcile ordered stock.</p>
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => void refresh()} disabled={busy || blocked} className="app-button-secondary flex items-center gap-2">
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
          <label className={`app-button-primary flex cursor-pointer items-center gap-2 ${busy || blocked ? "pointer-events-none opacity-50" : ""}`}>
            <FileUp className="h-4 w-4" /> Import OSBCL PDF
            <input
              type="file"
              accept="application/pdf,.pdf"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload(file);
                event.target.value = "";
              }}
            />
          </label>
        </div>
      </header>
      {blocked && <Notice text="Pick a shop first (top of the sidebar)." tone="warning" />}
      {error && <Notice text={error} tone="error" />}
      {info && <Notice text={info} tone="success" />}
      {importProgress && (
        <section aria-live="polite" className="rounded-xl border border-blue-200 bg-blue-50 p-5 text-blue-950">
          <div className="flex items-center justify-between gap-4 text-sm font-semibold">
            <span>{importProgress.stage}</span>
            <span>{importProgress.percent}%</span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-blue-100">
            <div className="h-full rounded-full bg-blue-600 transition-all duration-300" style={{ width: `${importProgress.percent}%` }} />
          </div>
          {importInProgress && <p className="mt-3 text-sm text-blue-900">Import in progress. Please do not close or refresh this page.</p>}
        </section>
      )}
      <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-bold text-slate-900">Purchase orders</h2>
            <p aria-live="polite" className="text-sm text-slate-500">
              {filteredOrders.length} of {orders.length} orders
            </p>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(14rem,1fr)_11rem_10rem_10rem_auto]">
            <label className="relative">
              <span className="sr-only">Search purchase orders</span>
              <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
              <input
                aria-label="Search purchase orders"
                className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm"
                placeholder="PO, token, retailer, invoice…"
                value={filters.query}
                onChange={(e) =>
                  setFilters((current) => ({
                    ...current,
                    query: e.target.value,
                  }))
                }
              />
            </label>
            <label className="text-xs font-semibold text-slate-600">
              Status
              <select
                aria-label="Filter by status"
                className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal text-slate-900"
                value={filters.status}
                onChange={(e) =>
                  setFilters((current) => ({
                    ...current,
                    status: e.target.value,
                  }))
                }
              >
                <option value="">All statuses</option>
                {["draft", "open", "partially_received", "fulfilled", "closed_short", "cancelled"].map((status) => (
                  <option key={status} value={status}>
                    {status.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-semibold text-slate-600">
              Order date from
              <input
                aria-label="Order date from"
                type="date"
                className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal"
                value={filters.from}
                onChange={(e) =>
                  setFilters((current) => ({
                    ...current,
                    from: e.target.value,
                  }))
                }
              />
            </label>
            <label className="text-xs font-semibold text-slate-600">
              Order date to
              <input aria-label="Order date to" type="date" className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal" value={filters.to} onChange={(e) => setFilters((current) => ({ ...current, to: e.target.value }))} />
            </label>
            <button type="button" className="app-button-secondary self-end" onClick={() => setFilters(emptyFilters)}>
              Clear filters
            </button>
          </div>
        </div>
        {filteredOrders.length === 0 ? (
          <p className="p-8 text-center text-sm text-slate-500">{orders.length ? "No purchase orders match these filters." : "No purchase orders imported."}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3">PO / token</th>
                  <th className="px-5 py-3">Retailer</th>
                  <th className="px-5 py-3">Order date</th>
                  <th className="px-5 py-3 text-right">Lines</th>
                  <th className="px-5 py-3 text-right">Total</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">
                    <span className="sr-only">Action</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredOrders.map((order) => (
                  <tr key={order.id} className="hover:bg-slate-50">
                    <td className="px-5 py-4 font-semibold text-slate-900">
                      <div>#{order.id}</div>
                      <div className="mt-0.5 text-xs font-normal text-slate-500">{order.osbcl_token ?? "Token needs review"}</div>
                    </td>
                    <td className="px-5 py-4">
                      <div>{order.retailer_name ?? "—"}</div>
                      <div className="mt-0.5 text-xs text-slate-500">{order.retailer_code ?? "No retailer code"}</div>
                    </td>
                    <td className="whitespace-nowrap px-5 py-4">{order.order_date ?? "—"}</td>
                    <td className="px-5 py-4 text-right tabular-nums">{order.lines.length}</td>
                    <td className="whitespace-nowrap px-5 py-4 text-right font-medium tabular-nums">₹{money(order.order_total)}</td>
                    <td className="px-5 py-4">
                      <Status value={order.status} />
                    </td>
                    <td className="px-5 py-4 text-right">
                      <button type="button" disabled={busy} className="app-button-secondary whitespace-nowrap" onClick={() => setSelected(order)}>
                        {order.status === "draft" ? "Edit draft" : "View"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {selected && (
        <PurchaseOrderDialog
          order={selected}
          products={products}
          canConfirm={canConfirm}
          busy={busy}
          onDismiss={() => setSelected(null)}
          onChange={setSelected}
          onSave={() => void mutate(() => updatePurchaseOrder(selected), "Draft saved.")}
          onConfirm={() =>
            void mutate(async () => {
              await updatePurchaseOrder(selected);
              const result = await finalizePurchaseOrder(selected.id);
              setInfo(`Purchase order finalized. Stock inward #${result.stock_inward_id}; inventory lot #${result.lot_id}.`);
              return result.purchase_order;
            }, "Purchase order finalized.")
          }
          onCancel={() => {
            const reason = window.prompt("Cancellation reason");
            if (reason?.trim()) void mutate(() => cancelPurchaseOrder(selected.id, reason.trim()), "Purchase order cancelled.");
          }}
          onDelete={() => void deleteDraft(selected)}
          onDownload={() => void downloadPurchaseOrder(selected.id, selected.source_filename)}
        />
      )}
    </div>
  );
}

function PurchaseOrderDialog({ order, products, canConfirm, busy, onDismiss, onChange, onSave, onConfirm, onCancel, onDelete, onDownload }: { order: PurchaseOrder; products: CatalogProduct[]; canConfirm: boolean; busy: boolean; onDismiss: () => void; onChange: (order: PurchaseOrder) => void; onSave: () => void; onConfirm: () => void; onCancel: () => void; onDelete: () => void; onDownload: () => void }) {
  const draft = order.status === "draft";
  const setHeader = (key: keyof PurchaseOrder, value: string) => onChange({ ...order, [key]: value || null });
  const setLine = (index: number, patch: Partial<PurchaseOrder["lines"][number]>) =>
    onChange({
      ...order,
      lines: order.lines.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line)),
    });
  return (
    <ModalDialog labelledBy="purchase-order-dialog-title" onDismiss={onDismiss} className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-2 sm:p-4 backdrop-blur-sm transition-opacity">
      <article className="flex max-h-[calc(100dvh-1rem)] w-full max-w-none flex-col overflow-hidden rounded-xl bg-white shadow-2xl sm:max-h-[calc(100dvh-2rem)]" aria-label={`Purchase order ${order.id}`}>
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-5 py-4 sm:px-6">
          <div>
            <h2 id="purchase-order-dialog-title" className="text-lg font-bold text-slate-900">
              PO #{order.id}
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              {order.source_filename} · {order.page_count} pages · OCR {order.extraction_confidence ? `${(Number(order.extraction_confidence) * 100).toFixed(1)}%` : "unavailable"}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button type="button" disabled={busy} className="app-button-secondary flex items-center gap-1" onClick={onDownload}>
              <Download className="h-4 w-4" /> Original
            </button>
            {draft && (
              <button type="button" disabled={busy} className="app-button-secondary flex items-center gap-1" onClick={onSave}>
                <Save className="h-4 w-4" /> Save draft
              </button>
            )}
            {draft && canConfirm && (
              <button type="button" disabled={busy} className="app-button-primary flex items-center gap-1" onClick={onConfirm}>
                <ShieldCheck className="h-4 w-4" /> Finalize & create stock
              </button>
            )}
            {draft && canConfirm && (
              <button type="button" disabled={busy} className="app-button-secondary flex items-center gap-1 text-red-700" onClick={onDelete}>
                <XCircle className="h-4 w-4" /> Delete draft
              </button>
            )}
            {canConfirm && order.status !== "cancelled" && (
              <button type="button" disabled={busy} className="app-button-secondary flex items-center gap-1 text-red-700" onClick={onCancel}>
                <XCircle className="h-4 w-4" /> Cancel
              </button>
            )}
            <button type="button" aria-label="Close purchase order" className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" onClick={onDismiss}>
              <X className="h-5 w-5" />
            </button>
          </div>
        </header>
        <div className="min-w-0 overflow-y-auto overscroll-contain">
          <div className="space-y-5 p-5 sm:p-6">
            {order.review_flags.length > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                <strong>Review required:</strong>
                <ul className="mt-1 list-disc pl-5">
                  {order.review_flags.map((flag) => (
                    <li key={flag}>{flag}</li>
                  ))}
                </ul>
              </div>
            )}
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Token" value={order.osbcl_token ?? ""} disabled={busy || !draft} onChange={(value) => setHeader("osbcl_token", value)} />
              <Field label="Order date" type="date" value={order.order_date ?? ""} disabled={busy || !draft} onChange={(value) => setHeader("order_date", value)} />
              <Field label="Order type" value={order.order_type ?? ""} disabled={busy || !draft} onChange={(value) => setHeader("order_type", value)} />
              <Field label="Retailer name" value={order.retailer_name ?? ""} disabled={busy || !draft} onChange={(value) => setHeader("retailer_name", value)} />
              <Field label="Retailer code" value={order.retailer_code ?? ""} disabled={busy || !draft} onChange={(value) => setHeader("retailer_code", value)} />
              <Field label="Vehicle" value={order.vehicle_number ?? ""} disabled={busy || !draft} onChange={(value) => setHeader("vehicle_number", value)} />
              <Field
                label="Total cases"
                type="number"
                value={order.total_cases?.toString() ?? ""}
                disabled={busy || !draft}
                onChange={(value) =>
                  onChange({
                    ...order,
                    total_cases: value === "" ? null : Number(value),
                  })
                }
              />
              <Field
                label="Total loose bottles"
                type="number"
                value={order.total_loose_bottles?.toString() ?? ""}
                disabled={busy || !draft}
                onChange={(value) =>
                  onChange({
                    ...order,
                    total_loose_bottles: value === "" ? null : Number(value),
                  })
                }
              />
              <Field label="MGER total" type="number" value={order.mger_total ?? ""} disabled={busy || !draft} onChange={(value) => setHeader("mger_total", value)} />
              <Field label="Order total" value={order.order_total ?? ""} disabled={busy || !draft} onChange={(value) => setHeader("order_total", value)} />
              <Field
                label="Vendor ID"
                type="number"
                value={order.vendor_id?.toString() ?? ""}
                disabled={busy || !draft}
                onChange={(value) =>
                  onChange({
                    ...order,
                    vendor_id: value === "" ? null : Number(value),
                  })
                }
              />
              <Field label="Purchase date" type="date" value={order.purchase_date ?? ""} disabled={busy || !draft} onChange={(value) => setHeader("purchase_date", value)} />
              <Field label="Invoice number" value={order.vendor_invoice_number ?? ""} disabled={busy || !draft} onChange={(value) => setHeader("vendor_invoice_number", value)} />
              <Field label="Invoice value" type="number" value={order.invoice_value ?? ""} disabled={busy || !draft} onChange={(value) => setHeader("invoice_value", value)} />
            </section>
            {draft && order.lines.some((line) => line.delivered_bottles != null && line.accepted_bottles != null && line.delivered_bottles > line.accepted_bottles) && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
                <h3 className="font-semibold text-amber-950">Wastage declaration required</h3>
                <textarea
                  aria-label="Wastage reason"
                  className="mt-2 w-full rounded border p-2"
                  placeholder="Describe the breakage or wastage"
                  value={order.wastage_reason ?? ""}
                  onChange={(e) =>
                    onChange({
                      ...order,
                      wastage_reason: e.target.value || null,
                    })
                  }
                  disabled={busy}
                />
                <label className="mt-3 flex items-center gap-2 text-sm">
                  <input
                    aria-label="Attest wastage declaration"
                    type="checkbox"
                    checked={order.wastage_attested}
                    disabled={busy}
                    onChange={(e) =>
                      onChange({
                        ...order,
                        wastage_attested: e.target.checked,
                      })
                    }
                  />{" "}
                  I attest that this wastage declaration is accurate.
                </label>
              </div>
            )}
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-semibold text-slate-900">Line items</h3>
                <span className="text-sm text-slate-500">{order.lines.length} lines</span>
              </div>
              <div className="space-y-4">
                {order.lines.map((line, index) => (
                  <LineItem key={line.id} line={line} index={index} draft={draft} busy={busy} products={products} onPatch={setLine} />
                ))}
              </div>
            </section>
            {(order.status === "fulfilled" || order.status === "closed_short") && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                <strong>Receipt completed:</strong> {order.status === "fulfilled" ? "all ordered quantities were received." : "short delivery was closed; no further PO receipt can be added."} Inward #{order.receipt_stock_inward_id ?? "—"} · Lot #{order.receipt_lot_id ?? "—"}.
              </div>
            )}
          </div>
        </div>
      </article>
    </ModalDialog>
  );
}

function LineItem({ line, index, draft, busy, products, onPatch }: { line: PurchaseOrder["lines"][number]; index: number; draft: boolean; busy: boolean; products: CatalogProduct[]; onPatch: (index: number, patch: Partial<PurchaseOrder["lines"][number]>) => void }) {
  const input = "mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 disabled:bg-slate-50";
  const selectedProduct = products.find((product) => product.id === line.product_id);
  return (
    <article className={`min-w-0 rounded-lg border p-4 ${!line.product_id || !line.pack_size_snapshot ? "border-amber-200 bg-amber-50/40" : "border-slate-200 bg-slate-50/50"}`}>
      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(16rem,2fr)_repeat(4,minmax(8rem,1fr))]">
        <div className="min-w-0">
          <label className="text-xs font-bold uppercase text-slate-500">
            Item name
            {draft ? <input aria-label="Item name" disabled={busy} className={`${input} font-medium`} value={line.source_item_name} onChange={(event) => onPatch(index, { source_item_name: event.target.value })} /> : <span className="mt-1 block text-sm font-medium normal-case text-slate-900">{line.source_item_name}</span>}
          </label>
          {draft ? (
            <ProductMatchPicker disabled={busy} lineId={line.id} products={products} productId={line.product_id} sourceItemName={line.source_item_name} onChange={(product_id) => onPatch(index, { product_id })} />
          ) : (
            <p className="mt-2 text-xs text-slate-500">
              {line.product_brand ?? "No product"} {line.product_size_label ?? ""}
            </p>
          )}
        </div>
        <Value label="Size / pack">
          {draft ? (
            <input
              aria-label="Bottle size ml"
              disabled={busy}
              type="number"
              className={input}
              value={line.size_ml ?? ""}
              onChange={(event) =>
                onPatch(index, {
                  size_ml: event.target.value ? Number(event.target.value) : null,
                })
              }
            />
          ) : (
            <p>{line.size_ml ?? "?"} ml</p>
          )}
          <p className="mt-1 text-xs text-slate-500">pack {line.pack_size_snapshot ?? "missing"}</p>
        </Value>
        <Value label="Cases / loose">
          {draft ? (
            <div className="grid grid-cols-2 gap-2">
              <input aria-label="Cases" disabled={busy} type="number" className={input} value={line.cases} onChange={(e) => onPatch(index, { cases: Number(e.target.value) })} />
              <input aria-label="Loose bottles" disabled={busy} type="number" className={input} value={line.loose_bottles} onChange={(e) => onPatch(index, { loose_bottles: Number(e.target.value) })} />
            </div>
          ) : (
            <p>
              {line.cases} / {line.loose_bottles}
            </p>
          )}
        </Value>
        <Value label="Rate / MGER / amount">
          {draft ? (
            <div className="grid grid-cols-3 gap-2">
              <input aria-label="Case rate" type="number" disabled={busy} className={input} value={line.case_rate ?? ""} onChange={(e) => onPatch(index, { case_rate: e.target.value || null })} />
              <input aria-label="MGER" type="number" disabled={busy} className={input} value={line.mger ?? ""} onChange={(e) => onPatch(index, { mger: e.target.value || null })} />
              <input aria-label="Amount" type="number" disabled={busy} className={input} value={line.amount ?? ""} onChange={(e) => onPatch(index, { amount: e.target.value || null })} />
            </div>
          ) : (
            <p>
              {money(line.case_rate)} / {money(line.mger)} / {money(line.amount)}
            </p>
          )}
        </Value>
        <Value label="Ordered / balance">
          <p className="font-semibold tabular-nums">{line.ordered_bottles ?? "—"}</p>
          <p className="mt-1 text-xs text-slate-500">
            <span className="text-emerald-700">{line.remaining_bottles} remaining</span> · <span className="text-red-700">{line.excess_bottles} excess</span>
          </p>
        </Value>
      </div>
      <div className="mt-4 grid gap-4 border-t border-slate-200 pt-4 sm:grid-cols-2 lg:grid-cols-[repeat(3,minmax(9rem,1fr))_minmax(12rem,2fr)]">
        <Value label="Delivered">
          {draft ? (
            <input
              aria-label={`Delivered ${line.source_item_name}`}
              min="0"
              type="number"
              disabled={busy}
              className={input}
              value={line.delivered_bottles ?? ""}
              onChange={(e) =>
                onPatch(index, {
                  delivered_bottles: e.target.value === "" ? null : Number(e.target.value),
                })
              }
            />
          ) : (
            <p>{line.delivered_bottles ?? "—"}</p>
          )}
        </Value>
        <Value label="Accepted / broken">
          {draft ? (
            <input
              aria-label={`Accepted ${line.source_item_name}`}
              min="0"
              type="number"
              disabled={busy}
              className={`${input} ${line.delivered_bottles != null && line.accepted_bottles != null && line.accepted_bottles > line.delivered_bottles ? "border-red-500" : ""}`}
              value={line.accepted_bottles ?? ""}
              onChange={(e) =>
                onPatch(index, {
                  accepted_bottles: e.target.value === "" ? null : Number(e.target.value),
                })
              }
            />
          ) : (
            <p>
              {line.accepted_bottles ?? "—"} / {line.broken_bottles ?? "—"}
            </p>
          )}
          {line.delivered_bottles != null && line.accepted_bottles != null && line.accepted_bottles > line.delivered_bottles && <p className="mt-1 text-xs text-red-600">Accepted cannot exceed delivered.</p>}
        </Value>
        <Value label="Unit cost">{draft ? <input aria-label={`Unit cost ${line.source_item_name}`} type="number" step="0.01" disabled={busy} className={input} value={line.unit_cost ?? ""} onChange={(e) => onPatch(index, { unit_cost: e.target.value || null })} /> : <p>{money(line.unit_cost)}</p>}</Value>
        <Value label="Product">
          {selectedProduct ? (
            <p>
              {selectedProduct.brand} <span className="text-slate-500">{selectedProduct.size_label}</span>
            </p>
          ) : (
            <p className="text-amber-700">Product match required</p>
          )}
        </Value>
      </div>
    </article>
  );
}
function Value({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 text-sm">
      <h4 className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</h4>
      <div className="mt-1 break-words text-slate-900">{children}</div>
    </div>
  );
}
function ProductMatchPicker({ disabled, lineId, products, productId, sourceItemName, onChange }: { disabled: boolean; lineId: number; products: CatalogProduct[]; productId: number | null; sourceItemName: string; onChange: (productId: number | null) => void }) {
  const listId = `active-products-${lineId}`;
  const productLabel = (product: CatalogProduct) => `${product.brand} · ${product.size_label} · ${product.barcode}`;
  const [query, setQuery] = useState(() => {
    const selected = products.find((product) => product.id === productId);
    return selected ? productLabel(selected) : "";
  });
  useEffect(() => {
    const selected = products.find((product) => product.id === productId);
    setQuery(selected ? productLabel(selected) : "");
  }, [productId, products]);
  return (
    <div className="mt-2">
      <input
        disabled={disabled}
        aria-label={`Product match for ${sourceItemName}`}
        list={listId}
        placeholder="Search active products by brand, size, or barcode…"
        className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm"
        value={query}
        onChange={(event) => {
          const value = event.target.value;
          setQuery(value);
          const product = products.find((candidate) => productLabel(candidate) === value);
          if (product) onChange(product.id);
          else if (!value) onChange(null);
        }}
      />
      <datalist id={listId}>
        {products.map((product) => (
          <option key={product.id} value={productLabel(product)} />
        ))}
      </datalist>
      <p className="mt-1 text-xs text-slate-500">Search all {products.length} active products, then choose one.</p>
    </div>
  );
}
function Field({ label, value, onChange, disabled, type = "text" }: { label: string; value: string; onChange: (value: string) => void; disabled: boolean; type?: string }) {
  return (
    <label className="text-xs font-bold uppercase tracking-wide text-slate-500">
      {label}
      <input type={type} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm font-normal normal-case text-slate-900 disabled:bg-slate-50" />
    </label>
  );
}
function Status({ value }: { value: string }) {
  return <span className="rounded-full bg-slate-100 px-2 py-1 text-[11px] font-bold uppercase text-slate-600">{value.replaceAll("_", " ")}</span>;
}
function Notice({ text, tone }: { text: string; tone: "error" | "success" | "warning" }) {
  const colors = tone === "error" ? "border-red-200 bg-red-50 text-red-800" : tone === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800";
  return <div className={`rounded-xl border p-4 text-sm ${colors}`}>{text}</div>;
}
function money(value: string | null): string {
  return value == null
    ? "—"
    : Number(value).toLocaleString("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
}
