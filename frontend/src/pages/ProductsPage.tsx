import { useCallback, useEffect, useState } from "react";
import { ApiError, toUserMessage } from "../api/client";
import {
  archiveProduct,
  createProduct,
  copyProductsFromShop,
  importProductsCsv,
  listProducts,
  permanentlyDeleteProduct,
  restoreProduct,
  updateProduct,
  type Product,
  type ProductImportResponse,
  type ProductCreatePayload,
  type ProductUpdatePayload,
} from "../api/products";
import { listShops, type ShopSummary } from "../api/shops";
import { invalidateCache, resolveBarcode } from "../api/catalog";
import { useAuth } from "../auth/AuthProvider";
import { useShopScope, useShopScopeGuard } from "../auth/ShopScopeProvider";
import { useBarcodeScanner } from "../hooks/useBarcodeScanner";

type Tab = "list" | "create" | "import" | "copy";
interface InitialBarcode {
  value: string;
  token: number;
}

type ProductActionKind = "archive" | "restore" | "permanent-delete";

interface ActionDialogState {
  product: Product;
  kind: ProductActionKind;
}

export function ProductsPage() {
  const { actingShopId } = useShopScope();
  const [tab, setTab] = useState<Tab>("list");
  const [catalogQuery, setCatalogQuery] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [initialBarcode, setInitialBarcode] = useState<InitialBarcode | null>(null);
  const [scannerError, setScannerError] = useState<string | null>(null);

  const handleScan = useCallback(
    async (raw: string) => {
      const code = raw.trim();
      if (!code) return;
      setScannerError(null);
      try {
        const product = await resolveBarcode(code, actingShopId);
        setTab("list");
        setCatalogQuery(product.barcode);
        setEditingId(product.id);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) {
          setTab("create");
          setInitialBarcode({ value: code, token: Date.now() });
          return;
        }
        setScannerError(toUserMessage(e, "Could not resolve scanned barcode."));
      }
    },
    [actingShopId]
  );

  useBarcodeScanner({ enabled: true, onScan: (barcode) => void handleScan(barcode) });

  return (
    <div className="flex flex-col gap-stack-gap">
      <h1 className="text-headline-lg text-primary">Products</h1>
      {scannerError && (
        <div role="alert" className="rounded-md bg-error px-stack-gap py-3 text-on-error">
          {scannerError}
        </div>
      )}
      <nav className="flex gap-stack-gap" aria-label="Product sections">
        {(["list", "create", "import", "copy"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`min-h-touchTarget-sm rounded-md px-stack-gap text-label-md ${
              tab === t ? "bg-primary text-on-primary" : "bg-surface-container-high text-on-surface-variant"
            }`}
          >
            {t === "list"
              ? "Catalog"
              : t === "create"
                ? "New product"
                : t === "import"
                  ? "Bulk import"
                  : "Copy products"}
          </button>
        ))}
      </nav>
      {tab === "list" && (
        <ListTab
          q={catalogQuery}
          onQueryChange={setCatalogQuery}
          editingId={editingId}
          onEditingIdChange={setEditingId}
        />
      )}
      {tab === "create" && (
        <CreateTab initialBarcode={initialBarcode} onCreated={() => setTab("list")} />
      )}
      {tab === "import" && <ImportTab />}
      {tab === "copy" && <CopyTab />}
    </div>
  );
}

function ListTab({
  q,
  onQueryChange,
  editingId,
  onEditingIdChange,
}: {
  q: string;
  onQueryChange: (q: string) => void;
  editingId: number | null;
  onEditingIdChange: (id: number | null) => void;
}) {
  const { user } = useAuth();
  const { actingShopId } = useShopScope();
  const isSuperadmin = user?.role === "superadmin";
  const canManage = user?.role === "owner" || user?.role === "superadmin";
  const [items, setItems] = useState<Product[] | null>(null);
  const [shops, setShops] = useState<ShopSummary[]>([]);
  const [selectedShopId, setSelectedShopId] = useState<number | null>(actingShopId);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [actionDialog, setActionDialog] = useState<ActionDialogState | null>(null);
  const [actionConfirmation, setActionConfirmation] = useState("");
  const [actionBusy, setActionBusy] = useState(false);

  useEffect(() => {
    if (!isSuperadmin) return;
    listShops()
      .then(setShops)
      .catch((e) => setError(toUserMessage(e, "Could not load shops.")));
  }, [isSuperadmin]);

  useEffect(() => {
    if (isSuperadmin && actingShopId != null) {
      setSelectedShopId(actingShopId);
    }
  }, [actingShopId, isSuperadmin]);

  useEffect(() => {
    let cancelled = false;
    setItems(null);
    setError(null);
    listProducts({
      q: q || undefined,
      includeInactive,
      shopId: isSuperadmin ? selectedShopId : actingShopId,
    })
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch((e) => {
        if (!cancelled) setError(toUserMessage(e, "Load failed."));
      });
    return () => {
      cancelled = true;
    };
  }, [q, includeInactive, refreshKey, actingShopId, isSuperadmin, selectedShopId]);

  const reload = useCallback(() => setRefreshKey((k) => k + 1), []);
  const shopById = new Map(shops.map((shop) => [shop.id, shop]));
  const closeActionDialog = useCallback(() => {
    setActionDialog(null);
    setActionConfirmation("");
    setActionBusy(false);
  }, []);
  const openActionDialog = useCallback((product: Product, kind: ProductActionKind) => {
    setActionDialog({ product, kind });
    setActionConfirmation("");
    setError(null);
  }, []);
  const runAction = async () => {
    if (!actionDialog) return;
    const expected = actionExpectedText(actionDialog.kind);
    if (actionConfirmation !== expected) {
      setError(`Type ${expected} to confirm.`);
      return;
    }
    setActionBusy(true);
    setError(null);
    try {
      if (actionDialog.kind === "archive") {
        await archiveProduct(actionDialog.product.id, { confirmation_text: expected });
      } else if (actionDialog.kind === "restore") {
        await restoreProduct(actionDialog.product.id, { confirmation_text: expected });
      } else {
        await permanentlyDeleteProduct(actionDialog.product.id, { confirmation_text: expected });
      }
      invalidateCache();
      closeActionDialog();
      reload();
    } catch (e) {
      setError(toUserMessage(e, "Action failed."));
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-stack-gap">
      <div className="flex flex-wrap items-center gap-stack-gap">
        <input
          type="search"
          value={q}
          onChange={(e) => onQueryChange(e.target.value)}
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
        {isSuperadmin && (
          <label className="flex flex-col gap-1 text-label-md">
            Shop
            <select
              aria-label="Shop"
              value={selectedShopId ?? ""}
              onChange={(e) => setSelectedShopId(e.target.value ? Number(e.target.value) : null)}
              className="min-h-touchTarget-sm rounded-md border border-outline bg-surface px-stack-gap text-body-md"
            >
              <option value="">All shops</option>
              {shops.map((shop) => (
                <option key={shop.id} value={shop.id}>
                  {shop.name} ({shop.code})
                </option>
              ))}
            </select>
          </label>
        )}
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
                {isSuperadmin && <th className="px-stack-gap py-2 text-left">Shop</th>}
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
                    showShop={isSuperadmin}
                    shopLabel={formatShopLabel(p.shop_id, shopById)}
                    onDone={() => {
                      onEditingIdChange(null);
                      reload();
                    }}
                    onCancel={() => onEditingIdChange(null)}
                  />
                ) : (
                  <tr key={p.id} className="border-b border-outline/40">
                    <td className="px-stack-gap py-2">{p.brand}</td>
                    {isSuperadmin && (
                      <td className="px-stack-gap py-2">{formatShopLabel(p.shop_id, shopById)}</td>
                    )}
                    <td className="px-stack-gap py-2">{p.size_label}</td>
                    <td className="px-stack-gap py-2 font-mono text-label-md">{p.barcode}</td>
                    <td className="px-stack-gap py-2 text-right font-mono">
                      {p.price == null ? "—" : `₹${p.price}`}
                    </td>
                    <td className="px-stack-gap py-2 text-right font-mono">
                      {p.low_stock_threshold ?? "—"}
                    </td>
                    <td className="px-stack-gap py-2">{p.is_active ? "yes" : "no"}</td>
                    <td className="px-stack-gap py-2 text-right">
                      <div className="flex flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => onEditingIdChange(p.id)}
                          className="rounded-md bg-primary px-stack-gap py-1 text-label-md text-on-primary"
                        >
                          Edit
                        </button>
                        {canManage && p.is_active && (
                          <button
                            type="button"
                            onClick={() => openActionDialog(p, "archive")}
                            className="rounded-md bg-error px-stack-gap py-1 text-label-md text-on-error"
                          >
                            Delete
                          </button>
                        )}
                        {canManage && !p.is_active && (
                          <>
                            <button
                              type="button"
                              onClick={() => openActionDialog(p, "restore")}
                              className="rounded-md bg-action px-stack-gap py-1 text-label-md text-on-action"
                            >
                              Restore
                            </button>
                            {isSuperadmin && p.can_permanently_delete && (
                              <button
                                type="button"
                                onClick={() => openActionDialog(p, "permanent-delete")}
                                className="rounded-md bg-surface-container-high px-stack-gap py-1 text-label-md text-error"
                              >
                                Permanently delete
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      )}
      {actionDialog && (
        <DestructiveActionDialog
          product={actionDialog.product}
          kind={actionDialog.kind}
          confirmationText={actionConfirmation}
          busy={actionBusy}
          onConfirmationTextChange={setActionConfirmation}
          onCancel={closeActionDialog}
          onSubmit={runAction}
        />
      )}
    </div>
  );
}

function formatShopLabel(shopId: number, shopById: Map<number, ShopSummary>): string {
  const shop = shopById.get(shopId);
  return shop ? `${shop.name} (${shop.code})` : `Shop ${shopId}`;
}

function actionExpectedText(kind: ProductActionKind): string {
  if (kind === "archive") return "DELETE";
  if (kind === "restore") return "RESTORE";
  return "PERMANENT DELETE";
}

function actionTitle(kind: ProductActionKind): string {
  if (kind === "archive") return "Delete product";
  if (kind === "restore") return "Restore product";
  return "Permanently delete product";
}

function actionButtonLabel(kind: ProductActionKind): string {
  if (kind === "archive") return "Delete";
  if (kind === "restore") return "Restore";
  return "Permanently delete";
}

function DestructiveActionDialog({
  product,
  kind,
  confirmationText,
  busy,
  onConfirmationTextChange,
  onCancel,
  onSubmit,
}: {
  product: Product;
  kind: ProductActionKind;
  confirmationText: string;
  busy: boolean;
  onConfirmationTextChange: (value: string) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const expected = actionExpectedText(kind);
  const canSubmit = confirmationText === expected && !busy;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="product-action-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 px-stack-gap"
    >
      <div className="w-full max-w-lg rounded-xl bg-surface-container p-gutter shadow-xl">
        <h2 id="product-action-title" className="text-headline-md text-primary">
          {actionTitle(kind)}
        </h2>
        <div className="mt-stack-gap flex flex-col gap-2 text-body-md text-on-surface">
          <p>
            {kind === "archive"
              ? "This will hide the product from the active catalog."
              : kind === "restore"
                ? "This will make the product active again."
                : "This will permanently remove the row if nothing references it."}
          </p>
          <p className="text-on-surface-variant">
            <span className="font-semibold text-on-surface">{product.brand}</span>{" "}
            <span>· {product.size_label}</span>{" "}
            <span className="font-mono">({product.barcode})</span>
          </p>
          <label className="flex flex-col gap-1 text-label-md">
            Type <span className="font-semibold">{expected}</span> to confirm
            <input
              value={confirmationText}
              onChange={(e) => onConfirmationTextChange(e.target.value)}
              autoFocus
              className="min-h-touchTarget-sm rounded-md border border-outline bg-surface px-stack-gap text-body-md"
            />
          </label>
        </div>
        <div className="mt-gutter flex justify-end gap-stack-gap">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md bg-surface-container-high px-stack-gap py-2 text-label-md"
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={!canSubmit}
            className={`rounded-md px-stack-gap py-2 text-label-md text-on-action disabled:opacity-50 ${
              kind === "permanent-delete" ? "bg-error" : "bg-action"
            }`}
          >
            {busy ? "Working…" : actionButtonLabel(kind)}
          </button>
        </div>
      </div>
    </div>
  );
}

function CopyTab() {
  const { actingShopId } = useShopScope();
  const shopScopeGuard = useShopScopeGuard();
  const [shops, setShops] = useState<ShopSummary[]>([]);
  const [sourceShopId, setSourceShopId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    copied: number;
    skipped: number;
    skipped_products: Array<{ barcode: string; reason: string }>;
  } | null>(null);

  useEffect(() => {
    listShops()
      .then(setShops)
      .catch((e) => setError(toUserMessage(e, "Could not load shops.")));
  }, []);

  const submit = async () => {
    if (shopScopeGuard.blocked || actingShopId == null) {
      setError(shopScopeGuard.message);
      return;
    }
    const src = Number(sourceShopId);
    if (!src || src === actingShopId) {
      setError("Pick a different source shop.");
      return;
    }
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await copyProductsFromShop(actingShopId, src);
      invalidateCache();
      setResult(res);
    } catch (e) {
      setError(toUserMessage(e, "Copy failed."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex max-w-xl flex-col gap-stack-gap rounded-lg bg-surface-container p-gutter">
      <h2 className="text-headline-md text-primary">Copy products</h2>
      <label className="flex flex-col gap-1 text-label-md">
        Source shop
        <select
          value={sourceShopId}
          onChange={(e) => setSourceShopId(e.target.value)}
          className="min-h-touchTarget-sm rounded-md border border-outline bg-surface px-stack-gap text-body-md"
        >
          <option value="">Select source shop</option>
          {shops
            .filter((shop) => shop.id !== actingShopId)
            .map((shop) => (
              <option key={shop.id} value={shop.id}>
                {shop.name} ({shop.code})
              </option>
            ))}
        </select>
      </label>
      <button
        type="button"
        onClick={submit}
        disabled={busy}
        className="min-h-touchTarget rounded-md bg-action text-label-xl text-on-action disabled:opacity-50"
      >
        {busy ? "Copying..." : "Copy into selected shop"}
      </button>
      {error && (
        <div role="alert" className="rounded-md bg-error px-stack-gap py-3 text-on-error">
          {error}
        </div>
      )}
      {result && (
        <div className="rounded-md bg-surface px-stack-gap py-3 text-body-md">
          <div className="font-bold text-primary">
            {result.copied} copied, {result.skipped} skipped
          </div>
          {result.skipped_products.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-on-surface-variant">
              {result.skipped_products.slice(0, 20).map((item) => (
                <li key={item.barcode}>
                  <span className="font-mono">{item.barcode}</span>: {item.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function EditRow({
  product,
  showShop,
  shopLabel,
  onDone,
  onCancel,
}: {
  product: Product;
  showShop: boolean;
  shopLabel: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [brand, setBrand] = useState(product.brand);
  const [sizeLabel, setSizeLabel] = useState(product.size_label);
  const [price, setPrice] = useState(product.price ?? "");
  const [threshold, setThreshold] = useState<string>(
    product.low_stock_threshold === null ? "" : String(product.low_stock_threshold)
  );
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
      setError(toUserMessage(e, "Save failed."));
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
      {showShop && <td className="px-stack-gap py-2">{shopLabel}</td>}
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
            className="rounded-md bg-action px-stack-gap py-1 text-label-md text-on-action disabled:opacity-50"
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

function CreateTab({
  initialBarcode,
  onCreated,
}: {
  initialBarcode: InitialBarcode | null;
  onCreated: () => void;
}) {
  const { actingShopId } = useShopScope();
  const shopScopeGuard = useShopScopeGuard();
  const [barcode, setBarcode] = useState("");
  const [brand, setBrand] = useState("");
  const [sizeLabel, setSizeLabel] = useState("");
  const [price, setPrice] = useState("");
  const [threshold, setThreshold] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    if (initialBarcode) setBarcode(initialBarcode.value);
  }, [initialBarcode]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (shopScopeGuard.blocked) {
      setError(shopScopeGuard.message);
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
      setError(toUserMessage(e, "Create failed."));
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
        className="min-h-touchTarget rounded-md bg-action text-label-xl text-on-action disabled:opacity-50"
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
  const { actingShopId } = useShopScope();
  const shopScopeGuard = useShopScopeGuard();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ProductImportResponse | null>(null);

  const submit = async () => {
    if (!file) {
      setError("Pick a CSV file first.");
      return;
    }
    if (shopScopeGuard.blocked) {
      setError(shopScopeGuard.message);
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
      setError(toUserMessage(e, "Import failed."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-stack-gap rounded-lg bg-surface-container p-gutter">
      <h2 className="text-headline-md text-primary">Bulk CSV import</h2>
      <p className="text-label-md text-on-surface-variant">
        Required columns: <code>barcode</code>, <code>brand</code>, <code>size_label</code>,{" "}
        <code>price</code>. Optional column: <code>low_stock_threshold</code>. Blank optional
        thresholds are accepted.
      </p>
      <a
        href="/templates/product-import-template.csv"
        download="product-import-template.csv"
        className="inline-flex min-h-touchTarget-sm w-fit items-center rounded-md bg-surface px-stack-gap text-label-md text-primary underline-offset-4 hover:underline"
      >
        Download sample CSV
      </a>
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
        className="min-h-touchTarget rounded-md bg-action text-label-xl text-on-action disabled:opacity-50"
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
