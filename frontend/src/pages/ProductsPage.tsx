import { useCallback, useEffect, useState } from "react";
import {
  createProduct,
  importProductsCsv,
  listProducts,
  updateProduct,
  type Product,
  type ProductImportResponse,
  type ProductCreatePayload,
  type ProductUpdatePayload,
} from "../api/products";
import { invalidateCache } from "../api/catalog";
import { useAuth } from "../auth/AuthProvider";
import { useShopScope } from "../auth/ShopScopeProvider";

type Tab = "list" | "create" | "import";

export function ProductsPage() {
  const [tab, setTab] = useState<Tab>("list");
  return (
    <div className="flex flex-col gap-stack-gap">
      <h1 className="text-headline-lg text-primary">Products</h1>
      <nav className="flex gap-stack-gap" aria-label="Product sections">
        {(["list", "create", "import"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`min-h-touchTarget-sm rounded-md px-stack-gap text-label-md ${
              tab === t ? "bg-primary text-on-primary" : "bg-surface-container-high text-on-surface-variant"
            }`}
          >
            {t === "list" ? "Catalog" : t === "create" ? "New product" : "Bulk import"}
          </button>
        ))}
      </nav>
      {tab === "list" && <ListTab />}
      {tab === "create" && <CreateTab onCreated={() => setTab("list")} />}
      {tab === "import" && <ImportTab />}
    </div>
  );
}

function ListTab() {
  const [items, setItems] = useState<Product[] | null>(null);
  const [q, setQ] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setError(null);
    listProducts({ q: q || undefined, includeInactive })
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Load failed.");
      });
    return () => {
      cancelled = true;
    };
  }, [q, includeInactive, refreshKey]);

  const reload = useCallback(() => setRefreshKey((k) => k + 1), []);

  return (
    <div className="flex flex-col gap-stack-gap">
      <div className="flex flex-wrap items-center gap-stack-gap">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by brand"
          className="min-h-touchTarget-sm flex-1 rounded-md border border-outline bg-surface px-stack-gap text-body-md"
        />
        <label className="flex items-center gap-stack-gap text-label-md">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => setIncludeInactive(e.target.checked)}
          />
          Include inactive
        </label>
        <button
          type="button"
          onClick={reload}
          className="min-h-touchTarget-sm rounded-md bg-surface-container-high px-stack-gap text-label-md"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div role="alert" className="rounded-md bg-error px-stack-gap py-3 text-on-error">
          {error}
        </div>
      )}

      {items === null ? (
        <div className="text-on-surface-variant">Loading…</div>
      ) : items.length === 0 ? (
        <div className="rounded-md bg-surface-container p-stack-gap text-on-surface-variant">
          No products match the current filter.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md bg-surface-container">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-outline text-label-md text-on-surface-variant">
                <th className="px-stack-gap py-2 text-left">Brand</th>
                <th className="px-stack-gap py-2 text-left">Size</th>
                <th className="px-stack-gap py-2 text-left">Barcode</th>
                <th className="px-stack-gap py-2 text-right">Price</th>
                <th className="px-stack-gap py-2 text-right">Low-stock</th>
                <th className="px-stack-gap py-2 text-left">Active</th>
                <th className="px-stack-gap py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) =>
                editingId === p.id ? (
                  <EditRow
                    key={p.id}
                    product={p}
                    onDone={() => {
                      setEditingId(null);
                      reload();
                    }}
                    onCancel={() => setEditingId(null)}
                  />
                ) : (
                  <tr key={p.id} className="border-b border-outline/40">
                    <td className="px-stack-gap py-2">{p.brand}</td>
                    <td className="px-stack-gap py-2">{p.size_label}</td>
                    <td className="px-stack-gap py-2 font-mono text-label-md">{p.barcode}</td>
                    <td className="px-stack-gap py-2 text-right font-mono">₹{p.price}</td>
                    <td className="px-stack-gap py-2 text-right font-mono">—</td>
                    <td className="px-stack-gap py-2">{p.is_active ? "yes" : "no"}</td>
                    <td className="px-stack-gap py-2 text-right">
                      <button
                        type="button"
                        onClick={() => setEditingId(p.id)}
                        className="rounded-md bg-primary px-stack-gap py-1 text-label-md text-on-primary"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function EditRow({
  product,
  onDone,
  onCancel,
}: {
  product: Product;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [brand, setBrand] = useState(product.brand);
  const [sizeLabel, setSizeLabel] = useState(product.size_label);
  const [price, setPrice] = useState(product.price);
  const [threshold, setThreshold] = useState<string>("");
  const [active, setActive] = useState(product.is_active);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload: ProductUpdatePayload = {
        brand,
        size_label: sizeLabel,
        price,
        is_active: active,
      };
      const t = threshold.trim();
      if (t) {
        const n = Number(t);
        if (!Number.isInteger(n) || n < 0) throw new Error("Threshold must be a non-negative integer.");
        payload.low_stock_threshold = n;
      } else {
        payload.low_stock_threshold = null;
      }
      await updateProduct(product.id, payload);
      invalidateCache();
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <tr className="border-b border-outline/40 bg-surface-container-high">
      <td className="px-stack-gap py-2">
        <input
          value={brand}
          onChange={(e) => setBrand(e.target.value)}
          className="w-full rounded-md border border-outline bg-surface px-2 py-1 text-body-md"
        />
      </td>
      <td className="px-stack-gap py-2">
        <input
          value={sizeLabel}
          onChange={(e) => setSizeLabel(e.target.value)}
          className="w-full rounded-md border border-outline bg-surface px-2 py-1 text-body-md"
        />
      </td>
      <td className="px-stack-gap py-2 font-mono text-label-md">{product.barcode}</td>
      <td className="px-stack-gap py-2">
        <input
          type="number"
          step="0.01"
          min="0"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          className="w-24 rounded-md border border-outline bg-surface px-2 py-1 text-right font-mono text-body-md"
        />
      </td>
      <td className="px-stack-gap py-2">
        <input
          type="number"
          min="0"
          value={threshold}
          placeholder="—"
          onChange={(e) => setThreshold(e.target.value)}
          className="w-20 rounded-md border border-outline bg-surface px-2 py-1 text-right font-mono text-body-md"
        />
      </td>
      <td className="px-stack-gap py-2">
        <input
          type="checkbox"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
        />
      </td>
      <td className="px-stack-gap py-2 text-right">
        <div className="flex justify-end gap-stack-gap">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md bg-surface-container px-stack-gap py-1 text-label-md"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="rounded-md bg-accent px-stack-gap py-1 text-label-md text-on-accent disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
        {error && (
          <div role="alert" className="mt-1 text-right text-label-md text-error">
            {error}
          </div>
        )}
      </td>
    </tr>
  );
}

function CreateTab({ onCreated }: { onCreated: () => void }) {
  const { user } = useAuth();
  const { actingShopId } = useShopScope();
  const [barcode, setBarcode] = useState("");
  const [brand, setBrand] = useState("");
  const [sizeLabel, setSizeLabel] = useState("");
  const [price, setPrice] = useState("");
  const [threshold, setThreshold] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (user?.role === "superadmin" && actingShopId === null) {
      setError("Pick a shop first (top of the sidebar).");
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const payload: ProductCreatePayload = {
        barcode: barcode.trim(),
        brand: brand.trim(),
        size_label: sizeLabel.trim(),
        price,
      };
      const t = threshold.trim();
      if (t) {
        const n = Number(t);
        if (!Number.isInteger(n) || n < 0) throw new Error("Threshold must be a non-negative integer.");
        payload.low_stock_threshold = n;
      }
      const created = await createProduct(payload, actingShopId);
      invalidateCache();
      setInfo(`Created ${created.brand} ${created.size_label} (${created.barcode}).`);
      setBarcode("");
      setBrand("");
      setSizeLabel("");
      setPrice("");
      setThreshold("");
      onCreated();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="flex max-w-xl flex-col gap-stack-gap rounded-lg bg-surface-container p-gutter"
    >
      <h2 className="text-headline-md text-primary">New product</h2>
      <Field label="Barcode" value={barcode} onChange={setBarcode} required />
      <Field label="Brand" value={brand} onChange={setBrand} required />
      <Field label="Size label" value={sizeLabel} onChange={setSizeLabel} required />
      <Field label="Price" value={price} onChange={setPrice} required type="number" step="0.01" min="0" />
      <Field
        label="Low-stock threshold (optional)"
        value={threshold}
        onChange={setThreshold}
        type="number"
        min="0"
      />
      <button
        type="submit"
        disabled={busy}
        className="min-h-touchTarget rounded-md bg-accent text-label-xl text-on-accent disabled:opacity-50"
      >
        {busy ? "Creating…" : "Create product"}
      </button>
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
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  required = false,
  step,
  min,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  step?: string;
  min?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-label-md">
      {label}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        step={step}
        min={min}
        className="min-h-touchTarget-sm rounded-md border border-outline bg-surface px-stack-gap text-body-md"
      />
    </label>
  );
}

function ImportTab() {
  const { user } = useAuth();
  const { actingShopId } = useShopScope();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ProductImportResponse | null>(null);

  const submit = async () => {
    if (!file) {
      setError("Pick a CSV file first.");
      return;
    }
    if (user?.role === "superadmin" && actingShopId === null) {
      setError("Pick a shop first (top of the sidebar).");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await importProductsCsv(file, actingShopId);
      setResult(res);
      invalidateCache();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-stack-gap rounded-lg bg-surface-container p-gutter">
      <h2 className="text-headline-md text-primary">Bulk CSV import</h2>
      <p className="text-label-md text-on-surface-variant">
        CSV columns: <code>barcode,brand,size_label,price[,low_stock_threshold]</code>. One row per
        product. The backend reports per-row errors so you can fix only the bad rows.
      </p>
      <input
        type="file"
        accept=".csv,text/csv"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        className="min-h-touchTarget-sm rounded-md border border-outline bg-surface px-stack-gap py-2 text-body-md"
      />
      <button
        type="button"
        onClick={submit}
        disabled={!file || busy}
        className="min-h-touchTarget rounded-md bg-accent text-label-xl text-on-accent disabled:opacity-50"
      >
        {busy ? "Importing…" : "Upload CSV"}
      </button>
      {error && (
        <div role="alert" className="rounded-md bg-error px-stack-gap py-3 text-on-error">
          {error}
        </div>
      )}
      {result && (
        <div className="flex flex-col gap-stack-gap rounded-md bg-surface p-stack-gap">
          <div className="text-label-xl text-primary">
            {result.created} created, {result.failed} failed
          </div>
          {result.errors.length > 0 && (
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-outline text-label-md text-on-surface-variant">
                  <th className="px-stack-gap py-2 text-left">Row</th>
                  <th className="px-stack-gap py-2 text-left">Barcode</th>
                  <th className="px-stack-gap py-2 text-left">Error</th>
                </tr>
              </thead>
              <tbody>
                {result.errors.map((e) => (
                  <tr key={`${e.row}-${e.barcode}`} className="border-b border-outline/40">
                    <td className="px-stack-gap py-2 font-mono">{e.row}</td>
                    <td className="px-stack-gap py-2 font-mono">{e.barcode ?? "—"}</td>
                    <td className="px-stack-gap py-2 text-error">{e.error}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}