// Issue #25 — Pending Products screen. The list itself IS the
// notification surface (D-v2-8): every product still in status='pending'
// (quick-added by a receiver/cashier but not yet priced) appears here.
// Completing a product (setting a price) is the entire resolution — no
// separate dismiss step. Once activated, the row drops off the list and
// the product becomes sellable at checkout.

import { useCallback, useEffect, useState } from "react";
import { Clock, RefreshCw, Pencil, XCircle, CheckCircle2 } from "lucide-react";
import { ApiError } from "../api/client";
import {
  activateProduct,
  listPendingProducts,
  rejectProduct,
  updateProduct,
  type PendingProductRow,
} from "../api/products";
import { invalidateCache } from "../api/catalog";
import { notifyPendingProductsChanged } from "../api/pending-products-events";
import { useShopScope } from "../auth/ShopScopeProvider";

interface EditingState {
  productId: number;
  brand: string;
  sizeLabel: string;
  price: string;
  threshold: string;
}

function formatTimestamp(s: string): string {
  try {
    return new Date(s).toLocaleString();
  } catch {
    return s;
  }
}

function originLabel(o: PendingProductRow["last_event_origin"]): string {
  if (o === "receiving") return "Receiving";
  if (o === "checkout") return "Checkout";
  return "Unknown";
}

export function PendingProductsPage() {
  const { actingShopId } = useShopScope();
  const [rows, setRows] = useState<PendingProductRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await listPendingProducts(actingShopId);
      setRows(list);
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 0) setError("Network error — could not load pending list.");
        else setError(e.detail);
      } else {
        setError("Could not load pending list.");
      }
    } finally {
      setLoading(false);
    }
  }, [actingShopId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const startEdit = (row: PendingProductRow) => {
    setEditing({ productId: row.id, brand: row.brand, sizeLabel: row.size_label, price: "", threshold: "" });
    setError(null);
    setInfo(null);
  };

  const cancelEdit = () => {
    setEditing(null);
  };

  const submitActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    const priceNum = Number(editing.price);
    if (!Number.isFinite(priceNum) || priceNum <= 0) {
      setError("Price must be a positive number.");
      return;
    }
    let thresholdNum: number | null = null;
    if (editing.threshold.trim() !== "") {
      const t = Number(editing.threshold);
      if (!Number.isInteger(t) || t < 0) {
        setError("Low-stock threshold must be a non-negative integer (or blank).");
        return;
      }
      thresholdNum = t;
    }
    setBusyId(editing.productId);
    setError(null);
    try {
      await updateProduct(editing.productId, {
        brand: editing.brand.trim(),
        size_label: editing.sizeLabel.trim(),
        low_stock_threshold: thresholdNum,
      });
      await activateProduct(editing.productId, {
        price: priceNum.toFixed(2),
        low_stock_threshold: thresholdNum,
      });
      // Invalidate the catalog cache so a subsequent checkout scan
      // picks up the new price.
      invalidateCache();
      setInfo("Product activated — now sellable at checkout.");
      setEditing(null);
      await reload();
      notifyPendingProductsChanged();
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.detail || "Activation failed.");
      } else {
        setError("Activation failed.");
      }
    } finally {
      setBusyId(null);
    }
  };

  const submitReject = async (row: PendingProductRow) => {
    setBusyId(row.id);
    setError(null);
    setInfo(null);
    try {
      await rejectProduct(row.id);
      invalidateCache();
      setInfo("Pending product rejected.");
      await reload();
      notifyPendingProductsChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.detail : "Reject failed.");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="flex flex-col gap-8 font-sans">
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200/50 bg-white/60 p-6 shadow-[0_8px_30px_rgb(0,0,0,0.02)] backdrop-blur-xl">
        <h1 className="flex items-center gap-3 text-2xl font-light tracking-tight text-slate-900">
          <Clock className="h-6 w-6 text-action" /> Pending
        </h1>
        <div className="flex items-center gap-4 text-sm font-medium text-slate-500">
          <span>
            {rows.length === 0
              ? "No products pending."
              : `${rows.length} product${rows.length === 1 ? "" : "s"} awaiting a price`}
          </span>
          <button
            type="button"
            onClick={() => void reload()}
            className="group flex h-10 items-center justify-center rounded-xl bg-white px-5 text-sm font-semibold tracking-wide text-slate-700 shadow-sm ring-1 ring-slate-200 transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:scale-[1.02] hover:bg-slate-50 hover:shadow-md active:scale-[0.97] disabled:opacity-50"
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 text-slate-400 transition-transform duration-300 group-hover:rotate-180 ${loading ? "animate-spin" : ""}`} />
            <span className="ml-2">Refresh</span>
          </button>
        </div>
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

      <ul className="flex flex-col gap-4">
        {rows.length === 0 && !loading && !error && (
          <li className="rounded-xl border border-dashed border-slate-300 bg-white/50 py-12 text-center text-sm font-medium text-slate-500">
            Nothing pending. Quick-added products will appear here until you set a price.
          </li>
        )}
        {rows.map((row) => (
          <li
            key={row.id}
            className="rounded-xl border border-slate-200/50 bg-white/60 p-6 shadow-[0_8px_30px_rgb(0,0,0,0.02)] backdrop-blur-xl transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:shadow-md"
            data-testid="pending-row"
            data-pending-id={row.id}
          >
            <div className="flex flex-wrap items-start justify-between gap-6">
              <div className="flex flex-col">
                <span className="text-xl font-bold tracking-tight text-slate-900">
                  {row.brand} <span className="text-slate-400">· {row.size_label}</span>
                </span>
                <span className="font-mono text-sm text-slate-500">
                  {row.barcode}
                </span>
                <div className="mt-2 flex flex-wrap items-center gap-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  <span>
                    Added by{" "}
                    <span className="text-slate-700">
                      {row.last_event_actor_name ?? "Unknown"}
                    </span>{" "}
                    via{" "}
                    <span className="text-slate-700">
                      {originLabel(row.last_event_origin)}
                    </span>
                  </span>
                  <span aria-hidden="true" className="text-slate-300">·</span>
                  <span>{formatTimestamp(row.created_at)}</span>
                </div>
              </div>
              {!editing || editing.productId !== row.id ? (
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => startEdit(row)}
                    className="flex h-10 items-center justify-center gap-2 rounded-xl bg-action px-5 text-sm font-semibold tracking-wide text-white shadow-sm transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[var(--color-action)]/30 active:scale-[0.97]"
                  >
                    <Pencil className="h-4 w-4" /> Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => void submitReject(row)}
                    disabled={busyId === row.id}
                    className="flex h-10 items-center justify-center gap-2 rounded-xl bg-red-50 px-5 text-sm font-semibold tracking-wide text-red-600 shadow-sm ring-1 ring-red-200 transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:bg-red-100 disabled:opacity-50"
                  >
                    <XCircle className="h-4 w-4" /> Reject
                  </button>
                </div>
              ) : null}
            </div>
            {editing && editing.productId === row.id && (
              <form
                onSubmit={submitActivate}
                className="mt-6 flex flex-col gap-6 rounded-2xl bg-slate-50 p-6 ring-1 ring-slate-200/50"
              >
                <div className="grid gap-6 md:grid-cols-2">
                  <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Brand/name
                    <input
                      type="text"
                      required
                      value={editing.brand}
                      onChange={(e) =>
                        setEditing({ ...editing, brand: e.target.value })
                      }
                      autoFocus
                      className="h-11 w-full rounded-xl border border-slate-200 bg-white/50 px-4 text-sm font-medium text-slate-700 shadow-sm outline-none transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:bg-white focus:border-action focus:ring-1 focus:ring-action"
                    />
                  </label>
                  <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    ML/Mg/size
                    <input
                      type="text"
                      required
                      value={editing.sizeLabel}
                      onChange={(e) =>
                        setEditing({ ...editing, sizeLabel: e.target.value })
                      }
                      className="h-11 w-full rounded-xl border border-slate-200 bg-white/50 px-4 text-sm font-medium text-slate-700 shadow-sm outline-none transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:bg-white focus:border-action focus:ring-1 focus:ring-action"
                    />
                  </label>
                  <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Price (₹)
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      required
                      value={editing.price}
                      onChange={(e) =>
                        setEditing({ ...editing, price: e.target.value })
                      }
                      autoFocus
                      className="h-11 w-full rounded-xl border border-slate-200 bg-white/50 px-4 text-sm font-medium text-slate-700 shadow-sm outline-none transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:bg-white focus:border-action focus:ring-1 focus:ring-action"
                    />
                  </label>
                  <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Low-stock threshold (optional)
                    <input
                      type="number"
                      step="1"
                      min="0"
                      value={editing.threshold}
                      onChange={(e) =>
                        setEditing({ ...editing, threshold: e.target.value })
                      }
                      placeholder="e.g. 5"
                      className="h-11 w-full rounded-xl border border-slate-200 bg-white/50 px-4 text-sm font-medium text-slate-700 shadow-sm outline-none transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:bg-white focus:border-action focus:ring-1 focus:ring-action"
                    />
                  </label>
                </div>
                <div className="flex gap-4">
                  <button
                    type="button"
                    onClick={cancelEdit}
                    className="flex h-11 flex-1 items-center justify-center rounded-xl bg-white text-sm font-semibold tracking-wide text-slate-700 shadow-sm ring-1 ring-slate-200 transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:bg-slate-50 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50"
                    disabled={busyId === row.id}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-action text-sm font-bold tracking-wide text-white shadow-sm transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[var(--color-action)]/30 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50"
                    disabled={busyId === row.id}
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    {busyId === row.id ? "Activating…" : "Activate"}
                  </button>
                </div>
              </form>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
