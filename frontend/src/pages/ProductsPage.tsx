import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { ApiError } from "../api/client";
import { invalidateCache } from "../api/catalog";
import {
  createProduct,
  importProductsCsv,
  listProducts,
  lookupProduct,
  updateProduct,
  type Product,
  type ProductCreatePayload,
  type ProductImportResponse,
  type ProductUpdatePayload,
} from "../api/products";
import { useAuth } from "../auth/AuthProvider";
import { useShopScope } from "../auth/ShopScopeProvider";

type Section = "catalog" | "import";
type PanelState =
  | { mode: "create"; barcode: string }
  | { mode: "edit"; product: Product }
  | null;

export function ProductsPage() {
  const [section, setSection] = useState<Section>("catalog");

  return (
    <div className="flex flex-col gap-stack-gap">
      <h1 className="text-headline-lg text-primary">Catalog</h1>
      <nav className="flex gap-stack-gap" aria-label="Catalog sections">
        {(["catalog", "import"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSection(s)}
            className={`min-h-touchTarget-sm rounded-md px-stack-gap text-label-md ${
              section === s ? "bg-primary text-on-primary" : "bg-surface-container-high text-on-surface-variant"
            }`}
          >
            {s === "catalog" ? "Catalog" : "Bulk import"}
          </button>
        ))}
      </nav>
      {section === "catalog" ? <CatalogWorkspace /> : <ImportTab />}
    </div>
  );
}

function CatalogWorkspace() {
  const { user } = useAuth();
  const { actingShopId } = useShopScope();
  const scanRef = useRef<HTMLInputElement | null>(null);
  const [items, setItems] = useState<Product[] | null>(null);
  const [q, setQ] = useState("");
  const [scan, setScan] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [busyScan, setBusyScan] = useState(false);
  const [panel, setPanel] = useState<PanelState>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const effectiveShopId = user?.role === "superadmin" ? actingShopId : undefined;

  useEffect(() => {
    scanRef.current?.focus();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setError(null);
    listProducts({ q: q || undefined, includeInactive, shopId: effectiveShopId })
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Load failed.");
      });
    return () => {
      cancelled = true;
    };
  }, [q, includeInactive, refreshKey, effectiveShopId]);

  const reload = useCallback(() => setRefreshKey((k) => k + 1), []);

  const submitScan = async (e: FormEvent) => {
    e.preventDefault();
    const barcode = scan.trim();
    if (!barcode) return;
    setBusyScan(true);
    setScanError(null);
    try {
      const product = await lookupProduct(barcode, effectiveShopId);
      setPanel({ mode: "edit", product });
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        setPanel({ mode: "create", barcode });
      } else {
        setScanError(e instanceof Error ? e.message : "Lookup failed.");
      }
    } finally {
      setBusyScan(false);
      setScan("");
      scanRef.current?.focus();
    }
  };

  return (
    <div className="grid gap-gutter xl:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="flex min-w-0 flex-col gap-stack-gap">
        <form onSubmit={submitScan} className="flex flex-wrap items-start gap-stack-gap">
          <label className="flex min-w-64 flex-1 flex-col gap-1 text-label-md">
            Scan or enter barcode
            <input
              ref={scanRef}
              value={scan}
              onChange={(e) => setScan(e.target.value)}
              className="min-h-touchTarget rounded-md border border-outline bg-surface px-stack-gap font-mono text-body-lg"
              autoComplete="off"
            />
          </label>
          <button
            type="submit"
            disabled={busyScan || !scan.trim()}
            className="mt-6 min-h-touchTarget rounded-md bg-accent px-gutter text-label-xl text-on-accent disabled:opacity-50"
          >
            {busyScan ? "Scanning..." : "Open"}
          </button>
          {scanError && (
            <div role="alert" className="basis-full rounded-md bg-error px-stack-gap py-3 text-on-error">
              {scanError}
            </div>
          )}
        </form>

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
          <div className="text-on-surface-variant">Loading...</div>
        ) : items.length === 0 ? (
          <div className="rounded-md bg-surface-container p-stack-gap text-on-surface-variant">
            No products match the current filter.
          </div>
        ) : (
          <ProductTable items={items} onEdit={(product) => setPanel({ mode: "edit", product })} />
        )}
      </div>

      <CatalogPanel
        panel={panel}
        onClose={() => setPanel(null)}
        onSaved={(product) => {
          setPanel({ mode: "edit", product });
          reload();
        }}
      />
    </div>
  );
}

function ProductTable({
  items,
  onEdit,
}: {
  items: Product[];
  onEdit: (product: Product) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-md bg-surface-container">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-outline text-label-md text-on-surface-variant">
            <th className="px-stack-gap py-2 text-left">Brand</th>
            <th className="px-stack-gap py-2 text-left">Size</th>
            <th className="px-stack-gap py-2 text-left">Barcode</th>
            <th className="px-stack-gap py-2 text-right">Price</th>
            <th className="px-stack-gap py-2 text-right">Low-stock</th>
            <th className="px-stack-gap py-2 text-left">Status</th>
            <th className="px-stack-gap py-2 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {items.map((p) => (
            <tr key={p.id} className="border-b border-outline/40">
              <td className="px-stack-gap py-2">{p.brand}</td>
              <td className="px-stack-gap py-2">{p.size_label}</td>
              <td className="px-stack-gap py-2 font-mono text-label-md">{p.barcode}</td>
              <td className="px-stack-gap py-2 text-right font-mono">{formatPrice(p.price)}</td>
              <td className="px-stack-gap py-2 text-right font-mono">
                {p.low_stock_threshold ?? "-"}
              </td>
              <td className="px-stack-gap py-2">
                {p.status === "pending" ? "pending" : p.is_active ? "active" : "inactive"}
              </td>
              <td className="px-stack-gap py-2 text-right">
                <button
                  type="button"
                  onClick={() => onEdit(p)}
                  className="rounded-md bg-primary px-stack-gap py-1 text-label-md text-on-primary"
                >
                  Edit
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CatalogPanel({
  panel,
  onClose,
  onSaved,
}: {
  panel: PanelState;
  onClose: () => void;
  onSaved: (product: Product) => void;
}) {
  if (!panel) {
    return (
      <aside className="rounded-md bg-surface-container p-gutter text-on-surface-variant">
        Scan a barcode or choose a product to edit.
      </aside>
    );
  }
  return (
    <aside className="rounded-md bg-surface-container p-gutter">
      {panel.mode === "create" ? (
        <ProductForm key={`create-${panel.barcode}`} mode="create" barcode={panel.barcode} onClose={onClose} onSaved={onSaved} />
      ) : (
        <ProductForm key={panel.product.id} mode="edit" product={panel.product} onClose={onClose} onSaved={onSaved} />
      )}
    </aside>
  );
}

type ProductFormProps =
  | {
      mode: "create";
      barcode: string;
      onClose: () => void;
      onSaved: (product: Product) => void;
    }
  | {
      mode: "edit";
      product: Product;
      onClose: () => void;
      onSaved: (product: Product) => void;
    };

function ProductForm(props: ProductFormProps) {
  const { user } = useAuth();
  const { actingShopId } = useShopScope();
  const isCreate = props.mode === "create";
  const product = props.mode === "edit" ? props.product : null;
  const [brand, setBrand] = useState(product?.brand ?? "");
  const [sizeLabel, setSizeLabel] = useState(product?.size_label ?? "");
  const [price, setPrice] = useState(product?.price ?? "");
  const [threshold, setThreshold] = useState(
    product?.low_stock_threshold == null ? "" : String(product.low_stock_threshold)
  );
  const [active, setActive] = useState(product?.is_active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const barcode = isCreate ? props.barcode : product!.barcode;
  const superadminNeedsShop = isCreate && user?.role === "superadmin" && actingShopId === null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (superadminNeedsShop) {
      setError("Pick a shop first (top of the sidebar).");
      return;
    }
    const parsedPrice = price.trim();
    const nPrice = Number(parsedPrice);
    if (!parsedPrice || !Number.isFinite(nPrice) || nPrice <= 0) {
      setError(product?.status === "pending" ? "Enter a positive price to activate this product." : "Price must be positive.");
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const low_stock_threshold = parseThreshold(threshold);
      const saved = isCreate
        ? await createProduct(
            {
              barcode,
              brand: brand.trim(),
              size_label: sizeLabel.trim(),
              price: parsedPrice,
              low_stock_threshold,
            } satisfies ProductCreatePayload,
            actingShopId
          )
        : await updateProduct(product!.id, {
            brand: brand.trim(),
            size_label: sizeLabel.trim(),
            price: parsedPrice,
            low_stock_threshold,
            is_active: active,
          } satisfies ProductUpdatePayload);
      invalidateCache();
      setInfo(isCreate ? "Product created." : "Product saved.");
      props.onSaved(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : isCreate ? "Create failed." : "Save failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-stack-gap">
      <div className="flex items-start justify-between gap-stack-gap">
        <div>
          <h2 className="text-headline-md text-primary">
            {isCreate ? "New product" : product?.status === "pending" ? "Pending product" : "Edit product"}
          </h2>
          <div className="font-mono text-label-md text-on-surface-variant">{barcode}</div>
        </div>
        <button
          type="button"
          onClick={props.onClose}
          className="rounded-md bg-surface px-stack-gap py-1 text-label-md"
        >
          Close
        </button>
      </div>

      {superadminNeedsShop && (
        <div role="alert" className="rounded-md bg-error px-stack-gap py-3 text-on-error">
          Pick a shop first (top of the sidebar) before creating a product.
        </div>
      )}

      <Field label="Barcode" value={barcode} onChange={() => undefined} required readOnly />
      <Field label="Brand" value={brand} onChange={setBrand} required />
      <Field label="Size label" value={sizeLabel} onChange={setSizeLabel} required />
      <Field label="Price" value={price} onChange={setPrice} required type="number" step="0.01" min="0.01" />
      <Field
        label="Low-stock threshold (optional)"
        value={threshold}
        onChange={setThreshold}
        type="number"
        min="0"
      />

      {!isCreate && (
        <label className="flex items-center gap-stack-gap text-label-md">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Active
        </label>
      )}

      <button
        type="submit"
        disabled={busy || superadminNeedsShop}
        className="min-h-touchTarget rounded-md bg-accent text-label-xl text-on-accent disabled:opacity-50"
      >
        {busy ? "Saving..." : isCreate ? "Create product" : product?.status === "pending" ? "Save and activate" : "Save product"}
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
  readOnly = false,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  step?: string;
  min?: string;
  readOnly?: boolean;
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
        readOnly={readOnly}
        className="min-h-touchTarget-sm rounded-md border border-outline bg-surface px-stack-gap text-body-md read-only:bg-surface-container-high"
      />
    </label>
  );
}

function parseThreshold(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isInteger(n) || n < 0) throw new Error("Threshold must be a non-negative integer.");
  return n;
}

function formatPrice(price: string | null): string {
  return price === null ? "Pending" : `Rs ${price}`;
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
    <div className="flex flex-col gap-stack-gap rounded-md bg-surface-container p-gutter">
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
        {busy ? "Importing..." : "Upload CSV"}
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
                    <td className="px-stack-gap py-2 font-mono">{e.barcode ?? "-"}</td>
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
