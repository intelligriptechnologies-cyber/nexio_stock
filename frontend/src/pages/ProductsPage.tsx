// Merged Catalog + New Product page (issue #45, R-v3-11, R-v3-12,
// R-v3-13, R-v3-17, D-v3-10, D-v3-11, D-v3-12, D-v3-17).
//
// Owner-only (the route is /admin/products, gated to owner+superadmin;
// superadmin is the operator's superset per D-64, so owner-only access
// is preserved). The page is one screen with three modes that share
// state:
//
//   - Idle: dense catalog table with edit-in-place.
//   - Scan: an always-listening scan input at the top. A recognized
//     barcode scrolls/selects the matching row; an unrecognized
//     barcode opens the QuickAddModal with the barcode prefilled.
//   - Edit: clicking Edit on a row swaps it for an inline form.
//     If a scan arrives while an edit is unsaved, the UI shows a
//     discard-confirmation dialog before switching (D-v3-11).
import { useCallback, useEffect, useRef, useState } from "react";
import { toUserMessage, ApiError } from "../api/client";
import {
  importProductsCsv,
  listProducts,
  quickAddProduct,
  updateProduct,
  type Product,
  type ProductImportResponse,
  type ProductUpdatePayload,
} from "../api/products";
import { resolveBarcode, invalidateCache } from "../api/catalog";
import { useShopScope, useShopScopeGuard } from "../auth/ShopScopeProvider";
import { QuickAddModal } from "../components/QuickAddModal";

interface ScanState {
  barcode: string;
  busy: boolean;
  error: string | null;
  // null = idle, "found" = row matched and selected, "new" = QuickAddModal open
  result: "found" | "new" | null;
  // For "found" — the product that matched.
  matchedProduct?: Product;
}

interface EditState {
  productId: number;
  brand: string;
  sizeLabel: string;
  price: string;
  threshold: string;
  active: boolean;
  busy: boolean;
  error: string | null;
}

export function ProductsPage() {
  const { actingShopId } = useShopScope();
  const shopScopeGuard = useShopScopeGuard();
  const [items, setItems] = useState<Product[] | null>(null);
  const [q, setQ] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [scan, setScan] = useState<ScanState>({
    barcode: "",
    busy: false,
    error: null,
    result: null,
  });
  const [editing, setEditing] = useState<EditState | null>(null);
  const [pendingScanDuringEdit, setPendingScanDuringEdit] = useState<
    string | null
  >(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const scanInputRef = useRef<HTMLInputElement | null>(null);

  const reload = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setError(null);
    listProducts({ q: q || undefined, includeInactive })
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch((e) => {
        if (!cancelled) setError(toUserMessage(e, "Load failed."));
      });
    return () => {
      cancelled = true;
    };
  }, [q, includeInactive, refreshKey]);

  // Always-listening scan: handlers attach via DOM events so even if
  // focus drifts to the search input, the scan input still picks up
  // global scans (mirrors the existing checkout/receiving pages).
  useEffect(() => {
    const el = scanInputRef.current;
    if (!el) return;
    const handler = () => {
      // refocus the scan input on any global click that wasn't on
      // a form control — this matches the checkout/receiving pattern
      // where the scan field is always one click away.
      const tag = (document.activeElement?.tagName ?? "").toLowerCase();
      if (["input", "textarea", "select", "button"].includes(tag)) return;
      el.focus();
    };
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, []);

  const performScan = useCallback(
    async (barcode: string) => {
      // D-v3-11 — if an edit is unsaved, queue the scan and ask before
      // discarding.
      if (editing) {
        setPendingScanDuringEdit(barcode);
        return;
      }
      setScan({ barcode, busy: true, error: null, result: null });
      try {
        const product = await resolveBarcode(barcode, actingShopId);
        setScan({
          barcode,
          busy: false,
          error: null,
          result: "found",
          matchedProduct: product,
        });
        // Scroll the matching row into view + flash-highlight via a
        // one-shot className — simplest possible affordance.
        const rowEl = document.getElementById(`product-row-${product.id}`);
        rowEl?.scrollIntoView({ block: "center" });
        rowEl?.classList.add("ring-2", "ring-accent");
        setTimeout(() => rowEl?.classList.remove("ring-2", "ring-accent"), 1500);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) {
          // D-v3-10 — unrecognized barcode → QuickAdd modal with the
          // barcode prefilled.
          setScan({
            barcode,
            busy: false,
            error: null,
            result: "new",
          });
        } else {
          // D-v3-14 — lookup failure (network blip / timeout). Show a
          // clear error and let the user retry.
          setScan({
            barcode,
            busy: false,
            error: toUserMessage(e, "Lookup failed — please retry."),
            result: null,
          });
        }
      }
    },
    [actingShopId, editing],
  );

  const onScanSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const bc = scan.barcode.trim();
    if (bc.length === 0) return;
    void performScan(bc);
  };

  const onConfirmDiscardEdit = () => {
    setEditing(null);
    const pending = pendingScanDuringEdit;
    setPendingScanDuringEdit(null);
    if (pending) void performScan(pending);
  };

  const onCancelDiscardEdit = () => {
    setPendingScanDuringEdit(null);
  };

  const onQuickAddSubmit = async (values: { brand: string; size: string }) => {
    setScan((s) => ({ ...s, busy: true, error: null }));
    try {
      const product = await quickAddProduct(
        {
          barcode: scan.barcode,
          brand: values.brand,
          size_label: values.size,
        },
        {
          idempotencyKey: `qa-catalog-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          origin: "receiving",
        },
      );
      setScan({
        barcode: scan.barcode,
        busy: false,
        error: null,
        result: null,
        matchedProduct: product,
      });
      invalidateCache();
      reload();
    } catch (e) {
      setScan((s) => ({
        ...s,
        busy: false,
        error: toUserMessage(e, "Quick-add failed — please retry."),
      }));
    }
  };

  const startEdit = (p: Product) => {
    setEditing({
      productId: p.id,
      brand: p.brand,
      sizeLabel: p.size_label,
      price: p.price,
      threshold: "",
      active: p.is_active,
      busy: false,
      error: null,
    });
  };

  const saveEdit = async () => {
    if (!editing) return;
    setEditing((e) => (e ? { ...e, busy: true, error: null } : e));
    try {
      const payload: ProductUpdatePayload = {
        brand: editing.brand,
        size_label: editing.sizeLabel,
        price: editing.price,
        is_active: editing.active,
      };
      if (editing.threshold !== "") {
        payload.low_stock_threshold = Number(editing.threshold);
      }
      await updateProduct(editing.productId, payload);
      setEditing(null);
      invalidateCache();
      reload();
    } catch (e) {
      setEditing((ed) =>
        ed ? { ...ed, busy: false, error: toUserMessage(e, "Update failed.") } : ed,
      );
    }
  };

  const onImportCsv = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) {
      setImportMsg("Choose a CSV file first.");
      return;
    }
    setImportBusy(true);
    setImportMsg(null);
    try {
      const res: ProductImportResponse = await importProductsCsv(file, actingShopId);
      setImportMsg(
        `Imported ${res.created} rows, ${res.failed} failed.${res.errors.length ? " See console for details." : ""}`,
      );
      if (res.errors.length) console.warn("CSV import errors:", res.errors);
      reload();
    } catch (e) {
      setImportMsg(`Import failed: ${toUserMessage(e, "unknown error")}`);
    } finally {
      setImportBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-gutter">
      <header className="flex flex-wrap items-end justify-between gap-stack-gap">
        <div>
          <h1 className="text-headline-lg text-primary">Catalog</h1>
          <p className="text-label-md text-on-surface-variant">
            Scan, search, or edit products. New barcodes open a quick-add
            dialog with the barcode prefilled.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setImportOpen((v) => !v)}
          className="min-h-touchTarget-sm rounded-md bg-surface-container-high px-stack-gap text-label-md"
        >
          {importOpen ? "Hide bulk import" : "Bulk import (CSV)"}
        </button>
      </header>

      {shopScopeGuard.blocked && (
        <div role="alert" className="rounded-md bg-warning px-stack-gap py-3 text-on-accent">
          {shopScopeGuard.message}
        </div>
      )}

      {error && (
        <div role="alert" className="rounded-md bg-error px-stack-gap py-3 text-on-error">
          {error}
        </div>
      )}

      {/* Always-listening scan input. */}
      <form onSubmit={onScanSubmit} className="flex gap-stack-gap">
        <input
          ref={scanInputRef}
          type="text"
          inputMode="numeric"
          autoFocus
          placeholder="Scan a barcode or type one here"
          value={scan.barcode}
          onChange={(e) => setScan((s) => ({ ...s, barcode: e.target.value }))}
          aria-label="Scan a barcode"
          className="min-h-touchTarget flex-1 rounded-md border border-outline bg-surface px-stack-gap text-body-lg font-mono"
        />
        <button
          type="submit"
          disabled={scan.busy || scan.barcode.trim().length === 0}
          className="min-h-touchTarget rounded-md bg-primary px-gutter text-label-xl text-on-primary disabled:opacity-50"
        >
          {scan.busy ? "Looking up…" : "SCAN"}
        </button>
      </form>

      {scan.error && (
        <div
          role="alert"
          className="flex items-center justify-between gap-stack-gap rounded-md bg-error px-stack-gap py-3 text-on-error"
        >
          <span>{scan.error}</span>
          <button
            type="button"
            onClick={() => {
              const bc = scan.barcode;
              setScan({
                barcode: "",
                busy: false,
                error: null,
                result: null,
              });
              if (bc) void performScan(bc);
            }}
            className="min-h-touchTarget-sm rounded-md bg-on-error/20 px-stack-gap text-label-md text-on-error"
          >
            Retry
          </button>
        </div>
      )}

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-stack-gap">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by brand"
          aria-label="Search catalog by brand"
          className="min-h-touchTarget-sm flex-1 rounded-md border border-outline bg-surface px-stack-gap text-body-md"
        />
        <label className="flex items-center gap-stack-gap text-label-md">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => setIncludeInactive(e.target.checked)}
          />
          Include deactivated
        </label>
      </div>

      {importOpen && (
        <form
          onSubmit={onImportCsv}
          className="rounded-lg bg-surface-container p-gutter"
        >
          <h2 className="mb-stack-gap text-headline-md text-primary">Bulk import</h2>
          <div className="flex flex-wrap items-center gap-stack-gap">
            <input
              type="file"
              name="file"
              accept=".csv,text/csv"
              required
              className="min-h-touchTarget-sm flex-1 rounded-md border border-outline bg-surface px-stack-gap text-body-md"
            />
            <button
              type="submit"
              disabled={importBusy}
              className="min-h-touchTarget rounded-md bg-primary px-gutter text-label-xl text-on-primary disabled:opacity-50"
            >
              {importBusy ? "Importing…" : "IMPORT"}
            </button>
          </div>
          {importMsg && (
            <p className="mt-stack-gap text-label-md">{importMsg}</p>
          )}
        </form>
      )}

      {/* Catalog table. */}
      <div className="overflow-x-auto rounded-md bg-surface-container">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-outline text-label-md text-on-surface-variant">
              <th className="px-stack-gap py-2 text-left">Brand</th>
              <th className="px-stack-gap py-2 text-left">Size</th>
              <th className="px-stack-gap py-2 text-left">Barcode</th>
              <th className="px-stack-gap py-2 text-right">Price</th>
              <th className="px-stack-gap py-2 text-right">Stock</th>
              <th className="px-stack-gap py-2 text-right">Low-stock</th>
              <th className="px-stack-gap py-2 text-left">Active</th>
              <th className="px-stack-gap py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items === null ? (
              <tr>
                <td colSpan={8} className="px-stack-gap py-3 text-center text-on-surface-variant">
                  Loading…
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-stack-gap py-3 text-center text-on-surface-variant">
                  No products match the current filter.
                </td>
              </tr>
            ) : (
              items.map((p) =>
                editing && editing.productId === p.id ? (
                  <EditRow
                    key={p.id}
                    editing={editing}
                    onChange={setEditing}
                    onSave={() => void saveEdit()}
                    onCancel={() => setEditing(null)}
                  />
                ) : (
                  <tr
                    id={`product-row-${p.id}`}
                    key={p.id}
                    className="border-b border-outline/40 transition"
                  >
                    <td className="px-stack-gap py-2">{p.brand}</td>
                    <td className="px-stack-gap py-2">{p.size_label}</td>
                    <td className="px-stack-gap py-2 font-mono text-label-md">{p.barcode}</td>
                    <td className="px-stack-gap py-2 text-right font-mono">₹{p.price}</td>
                    <td className="px-stack-gap py-2 text-right font-mono">
                      {p.current_stock ?? 0}
                    </td>
                    <td className="px-stack-gap py-2 text-right font-mono">—</td>
                    <td className="px-stack-gap py-2">{p.is_active ? "yes" : "no"}</td>
                    <td className="px-stack-gap py-2 text-right">
                      <button
                        type="button"
                        onClick={() => startEdit(p)}
                        className="rounded-md bg-primary px-stack-gap py-1 text-label-md text-on-primary"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ),
              )
            )}
          </tbody>
        </table>
      </div>

      {/* D-v3-11 — discard-confirmation dialog when a scan arrives
          while an edit is unsaved. */}
      {pendingScanDuringEdit !== null && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="discard-title"
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/40"
        >
          <div className="flex w-full max-w-md flex-col gap-stack-gap rounded-lg bg-surface-container p-gutter">
            <h2 id="discard-title" className="text-headline-md text-primary">
              Discard unsaved changes?
            </h2>
            <p className="text-body-md">
              You have unsaved edits on this product. Scanning{" "}
              <span className="font-mono">{pendingScanDuringEdit}</span> will
              discard them.
            </p>
            <div className="flex justify-end gap-stack-gap">
              <button
                type="button"
                onClick={onCancelDiscardEdit}
                className="min-h-touchTarget-sm rounded-md bg-surface-container-high px-gutter text-label-md"
              >
                Keep editing
              </button>
              <button
                type="button"
                onClick={onConfirmDiscardEdit}
                className="min-h-touchTarget-sm rounded-md bg-error px-gutter text-label-md text-on-error"
              >
                Discard & continue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* D-v3-10 — QuickAdd modal for unrecognized barcodes. */}
      {scan.result === "new" && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/40"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setScan({ barcode: "", busy: false, error: null, result: null });
            }
          }}
        >
          <QuickAddModal
            barcode={scan.barcode}
            busy={scan.busy}
            error={scan.error}
            onCancel={() =>
              setScan({ barcode: "", busy: false, error: null, result: null })
            }
            onSubmit={(values) => void onQuickAddSubmit(values)}
          />
        </div>
      )}
    </div>
  );
}

interface EditRowProps {
  editing: EditState;
  onChange: (next: EditState) => void;
  onSave: () => void;
  onCancel: () => void;
}

function EditRow({ editing, onChange, onSave, onCancel }: EditRowProps) {
  return (
    <tr className="border-b border-outline bg-primary-container/20">
      <td className="px-stack-gap py-2">
        <input
          type="text"
          value={editing.brand}
          onChange={(e) =>
            onChange({ ...editing, brand: e.target.value })
          }
          className="min-h-touchTarget-sm w-full rounded-md border border-outline bg-surface px-stack-gap text-body-md"
        />
      </td>
      <td className="px-stack-gap py-2">
        <input
          type="text"
          value={editing.sizeLabel}
          onChange={(e) =>
            onChange({ ...editing, sizeLabel: e.target.value })
          }
          className="min-h-touchTarget-sm w-full rounded-md border border-outline bg-surface px-stack-gap text-body-md"
        />
      </td>
      <td className="px-stack-gap py-2 font-mono text-label-md text-on-surface-variant">
        (immutable)
      </td>
      <td className="px-stack-gap py-2">
        <input
          type="text"
          inputMode="decimal"
          value={editing.price}
          onChange={(e) =>
            onChange({ ...editing, price: e.target.value })
          }
          className="min-h-touchTarget-sm w-24 rounded-md border border-outline bg-surface px-stack-gap text-right font-mono text-body-md"
        />
      </td>
      <td className="px-stack-gap py-2 text-on-surface-variant">—</td>
      <td className="px-stack-gap py-2">
        <input
          type="number"
          min={0}
          value={editing.threshold}
          placeholder="(unchanged)"
          onChange={(e) =>
            onChange({ ...editing, threshold: e.target.value })
          }
          className="min-h-touchTarget-sm w-24 rounded-md border border-outline bg-surface px-stack-gap text-right font-mono text-body-md"
        />
      </td>
      <td className="px-stack-gap py-2">
        <input
          type="checkbox"
          checked={editing.active}
          onChange={(e) =>
            onChange({ ...editing, active: e.target.checked })
          }
        />
      </td>
      <td className="px-stack-gap py-2 text-right">
        <button
          type="button"
          onClick={onSave}
          disabled={editing.busy}
          className="min-h-touchTarget-sm rounded-md bg-primary px-stack-gap py-1 text-label-md text-on-primary disabled:opacity-50"
        >
          {editing.busy ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="ml-stack-gap min-h-touchTarget-sm rounded-md bg-surface-container-high px-stack-gap py-1 text-label-md"
        >
          Cancel
        </button>
      </td>
    </tr>
  );
}