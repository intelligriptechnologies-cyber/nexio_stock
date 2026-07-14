import { useCallback, useEffect, useMemo, useState } from "react";
import { FileClock, RefreshCw, X } from "lucide-react";
import { toUserMessage } from "../api/client";
import { listStockInwards, type LotPublic } from "../api/lots";
import { useShopScope } from "../auth/ShopScopeProvider";
import { ModalDialog } from "../components/ModalDialog";

function statusClass(status: LotPublic["status"]): string {
  switch (status) {
    case "pending":
      return "bg-amber-50 text-amber-700 ring-1 ring-amber-200";
    case "approved":
      return "bg-blue-50 text-blue-700 ring-1 ring-blue-200";
    case "rejected":
      return "bg-red-50 text-red-700 ring-1 ring-red-200";
    case "completed":
      return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200";
  }
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "--";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "--" : date.toLocaleString();
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "--";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "--" : date.toLocaleDateString();
}

function personLabel(name: string | null | undefined, fallback: string): string {
  return name?.trim() || fallback;
}

function lotUnits(lot: LotPublic): number {
  return lot.lines.reduce((sum, line) => sum + line.quantity, 0);
}

function lotLineCount(lot: LotPublic): number {
  return lot.lines.length;
}

export function StockTrackingPage() {
  const { actingShopId } = useShopScope();
  const [items, setItems] = useState<LotPublic[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedLot, setSelectedLot] = useState<LotPublic | null>(null);

  const closeDialog = useCallback(() => {
    setSelectedLot(null);
  }, []);

  const openDialog = useCallback((lot: LotPublic) => {
    setSelectedLot(lot);
  }, []);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const result = await listStockInwards(actingShopId, 200);
      setItems(result.lots);
      setSelectedLot((current) =>
        current ? result.lots.find((lot) => lot.id === current.id) ?? null : null
      );
    } catch (e) {
      setError(toUserMessage(e, "Could not load stock tracking history."));
    }
  }, [actingShopId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const selectedStats = useMemo(() => {
    if (!selectedLot) return null;
    return {
      units: lotUnits(selectedLot),
      lines: lotLineCount(selectedLot),
    };
  }, [selectedLot]);

  return (
    <div className="flex flex-col gap-8 font-sans">
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200/50 bg-white/60 p-6 shadow-[0_8px_30px_rgb(0,0,0,0.02)] backdrop-blur-xl">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-bold tracking-tight text-slate-900">
            <FileClock className="h-6 w-6 text-action" /> Stock Tracking
          </h1>
          <p className="mt-1 text-sm font-medium text-slate-500">
            Compact inward history with a full read-only details view on demand.
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

      {items === null ? (
        <div className="flex h-32 items-center justify-center rounded-xl border border-slate-200/50 bg-white/60 p-6 shadow-[0_8px_30px_rgb(0,0,0,0.02)] backdrop-blur-xl">
          <div className="text-sm font-medium text-slate-500">Loading...</div>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 bg-white/50 py-12 text-center text-sm font-medium text-slate-500">
          No stock inward history yet.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200/50 bg-white/60 shadow-[0_8px_30px_rgb(0,0,0,0.02)] backdrop-blur-xl">
          <table className="app-list-table min-w-[1120px]" aria-label="Stock tracking table">
            <thead>
              <tr>
                <th className="whitespace-nowrap">Inward</th>
                <th className="whitespace-nowrap">Status</th>
                <th className="whitespace-nowrap">Vendor / Invoice</th>
                <th className="whitespace-nowrap">Dates</th>
                <th className="whitespace-nowrap text-right">Units / Lines</th>
                <th className="whitespace-nowrap">People</th>
                <th className="whitespace-nowrap text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const summary = `Open inward ${item.id} details`;
                return (
                  <tr
                    key={item.id}
                    role="button"
                    tabIndex={0}
                    aria-label={summary}
                    className="cursor-pointer transition-colors hover:bg-slate-50/80 focus-visible:bg-slate-50/80"
                    onClick={() => openDialog(item)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openDialog(item);
                      }
                    }}
                  >
                    <td className="px-6 py-4">
                      <div className="font-semibold text-slate-900">Inward #{item.id}</div>
                      <div className="text-xs font-medium uppercase tracking-widest text-slate-500">
                        shop {item.shop_id}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${statusClass(item.status)}`}>
                        {item.status}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-medium text-slate-900">{item.vendor?.name ?? "No vendor"}</div>
                      <div className="text-sm text-slate-500">
                        Invoice {item.vendor_invoice_number || "--"}
                        {item.reference ? ` · Ref ${item.reference}` : ""}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-600">
                      <div>Created {formatDateTime(item.created_at)}</div>
                      <div>Received {formatDateTime(item.received_at)}</div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="font-mono text-sm font-semibold text-slate-900">{lotUnits(item)}</div>
                      <div className="text-xs font-medium uppercase tracking-widest text-slate-500">
                        {lotLineCount(item)} lines
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-600">
                      <div>Created by {personLabel(item.created_by_name, `user #${item.received_by_user_id}`)}</div>
                      <div>
                        Approved by{" "}
                        {item.approved_by_name ? item.approved_by_name : "--"}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          openDialog(item);
                        }}
                        className="inline-flex h-10 items-center justify-center rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
                        aria-label={`View inward ${item.id} details`}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selectedLot && selectedStats && (
        <ModalDialog labelledBy="stock-tracking-dialog-title" onDismiss={closeDialog}>
          <div className="m-4 w-full max-w-5xl overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200/70 animate-modal-in">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200/70 px-6 py-5">
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <h2 id="stock-tracking-dialog-title" className="text-2xl font-bold tracking-tight text-slate-900">
                    Inward #{selectedLot.id}
                  </h2>
                  <span
                    className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${statusClass(selectedLot.status)}`}
                  >
                    {selectedLot.status}
                  </span>
                </div>
                <p className="mt-2 text-sm text-slate-500">
                  {selectedStats.units} units across {selectedStats.lines} line
                  {selectedStats.lines === 1 ? "" : "s"}.
                </p>
              </div>
              <button
                type="button"
                onClick={closeDialog}
                className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 text-slate-600 transition-colors hover:bg-slate-200"
                aria-label="Close dialog"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="max-h-[80vh] overflow-y-auto px-6 py-6">
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                <InfoCard label="Vendor" value={selectedLot.vendor?.name ?? "No vendor"} />
                <InfoCard label="Vendor invoice" value={selectedLot.vendor_invoice_number || "--"} />
                <InfoCard label="Purchase date" value={formatDate(selectedLot.purchase_date)} />
                <InfoCard label="Reference" value={selectedLot.reference ?? "--"} />
                <InfoCard label="Invoice value" value={selectedLot.invoice_value || "--"} />
                <InfoCard label="Shop" value={`shop ${selectedLot.shop_id}`} />
                <InfoCard
                  label="Created by"
                  value={personLabel(selectedLot.created_by_name, `user #${selectedLot.received_by_user_id}`)}
                />
                <InfoCard
                  label="Approved by"
                  value={selectedLot.approved_by_name ?? "--"}
                />
                <InfoCard
                  label="Rejected by"
                  value={selectedLot.rejected_by_name ?? "--"}
                />
                <InfoCard label="Received at" value={formatDateTime(selectedLot.received_at)} />
                <InfoCard label="Created at" value={formatDateTime(selectedLot.created_at)} />
                <InfoCard label="Updated at" value={formatDateTime(selectedLot.updated_at)} />
                <InfoCard label="Approved at" value={formatDateTime(selectedLot.approved_at)} />
                <InfoCard label="Rejected at" value={formatDateTime(selectedLot.rejected_at)} />
                <InfoCard label="Completed at" value={formatDateTime(selectedLot.completed_at)} />
              </div>

              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <InfoCard label="Notes" value={selectedLot.notes ?? "--"} wide />
              </div>

              <div className="mt-6 overflow-hidden rounded-xl border border-slate-200/70">
                <table className="app-list-table" aria-label={`Inward ${selectedLot.id} line items`}>
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th className="text-right">Qty</th>
                      <th className="text-right">Good</th>
                      <th className="text-right">Breakage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedLot.lines.map((line) => (
                      <tr key={line.id}>
                        <td className="px-6 py-4">
                          <div className="font-medium text-slate-900">{line.product_brand}</div>
                          <div className="text-slate-500">{line.product_size_label}</div>
                        </td>
                        <td className="px-6 py-4 text-right font-mono text-slate-900">{line.quantity}</td>
                        <td className="px-6 py-4 text-right font-mono text-emerald-600">
                          {line.good_condition_quantity}
                        </td>
                        <td className="px-6 py-4 text-right font-mono text-red-500">{line.breakage_quantity}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </ModalDialog>
      )}
    </div>
  );
}

function InfoCard({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className={`rounded-xl border border-slate-200/70 bg-slate-50/70 px-4 py-3 ${wide ? "md:col-span-2" : ""}`}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">{label}</div>
      <div className="mt-1 break-words text-sm font-medium text-slate-900">{value}</div>
    </div>
  );
}
