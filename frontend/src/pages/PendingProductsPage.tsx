// Issue #25 — Pending Products screen. The list itself IS the
// notification surface (D-v2-8): every product still in status='pending'
// (quick-added by a receiver/cashier but not yet priced) appears here.
// Completing a product (setting a price) is the entire resolution — no
// separate dismiss step. Once activated, the row drops off the list and
// the product becomes sellable at checkout.

import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../api/client";
import {
  activateProduct,
  listPendingProducts,
  type PendingProductRow,
} from "../api/products";
import { invalidateCache } from "../api/catalog";
import { useShopScope } from "../auth/ShopScopeProvider";

interface EditingState {
  productId: number;
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
    setEditing({ productId: row.id, price: "", threshold: "" });
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

  return (
    <div className="flex flex-col gap-gutter">
      <header className="flex flex-wrap items-center justify-between gap-stack-gap">
        <h1 className="text-headline-lg text-primary">Pending Products</h1>
        <div className="flex items-center gap-stack-gap text-label-md text-on-surface-variant">
          <span>
            {rows.length === 0
              ? "No products pending."
              : `${rows.length} product${rows.length === 1 ? "" : "s"} awaiting a price`}
          </span>
          <button
            type="button"
            onClick={() => void reload()}
            className="rounded-md bg-surface-container-high px-stack-gap py-1 text-on-surface-variant"
            disabled={loading}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>

      {error && (
        <div
          role="alert"
          className="rounded-md bg-error px-stack-gap py-3 text-on-error"
        >
          {error}
        </div>
      )}
      {info && (
        <div
          role="status"
          className="rounded-md bg-success px-stack-gap py-3 text-on-secondary"
        >
          {info}
        </div>
      )}

      <ul className="flex flex-col gap-stack-gap">
        {rows.length === 0 && !loading && !error && (
          <li className="rounded-md bg-surface p-stack-gap text-center text-on-surface-variant">
            Nothing pending. Quick-added products will appear here until you set a price.
          </li>
        )}
        {rows.map((row) => (
          <li
            key={row.id}
            className="rounded-md bg-surface-container p-stack-gap shadow-sm"
            data-testid="pending-row"
            data-pending-id={row.id}
          >
            <div className="flex flex-wrap items-start justify-between gap-stack-gap">
              <div className="flex flex-col">
                <span className="text-label-xl text-on-surface">
                  {row.brand} <span className="text-on-surface-variant">· {row.size_label}</span>
                </span>
                <span className="font-mono text-label-md text-on-surface-variant">
                  {row.barcode}
                </span>
                <div className="mt-1 flex flex-wrap gap-stack-gap text-label-md text-on-surface-variant">
                  <span>
                    Added by{" "}
                    <span className="text-on-surface">
                      {row.last_event_actor_name ?? "Unknown"}
                    </span>{" "}
                    via{" "}
                    <span className="text-on-surface">
                      {originLabel(row.last_event_origin)}
                    </span>
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>{formatTimestamp(row.created_at)}</span>
                </div>
              </div>
              {!editing || editing.productId !== row.id ? (
                <button
                  type="button"
                  onClick={() => startEdit(row)}
                  className="min-h-touchTarget-sm rounded-md bg-accent px-gutter text-label-md text-on-accent"
                >
                  Set price
                </button>
              ) : null}
            </div>
            {editing && editing.productId === row.id && (
              <form
                onSubmit={submitActivate}
                className="mt-stack-gap flex flex-col gap-stack-gap rounded-md bg-surface p-stack-gap"
              >
                <div className="grid gap-stack-gap md:grid-cols-2">
                  <label className="flex flex-col gap-1 text-label-md">
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
                      className="min-h-touchTarget-sm rounded-md border border-outline bg-surface px-stack-gap text-body-md"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-label-md">
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
                      className="min-h-touchTarget-sm rounded-md border border-outline bg-surface px-stack-gap text-body-md"
                    />
                  </label>
                </div>
                <div className="flex gap-stack-gap">
                  <button
                    type="button"
                    onClick={cancelEdit}
                    className="min-h-touchTarget-sm flex-1 rounded-md bg-surface-container-high text-label-md text-on-surface"
                    disabled={busyId === row.id}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="min-h-touchTarget-sm flex-1 rounded-md bg-accent text-label-md text-on-accent disabled:opacity-50"
                    disabled={busyId === row.id}
                  >
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