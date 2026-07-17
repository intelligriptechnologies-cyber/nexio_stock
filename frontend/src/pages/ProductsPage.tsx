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
import { AppTabButton } from "../components/AppTabs";
import { ModalDialog } from "../components/ModalDialog";
import { Package, Search, Filter, RefreshCw, Edit3, Trash2, RotateCcw, XOctagon, Download, Upload, Copy, AlertCircle, PlusCircle } from "lucide-react";
import { csvTimestamp, downloadCsv } from "../utils/csv";

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
    <div className="flex flex-col gap-8 font-sans">
      <header>
        <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight text-slate-900">
          <Package className="h-8 w-8 text-action" /> Products
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          Manage your product catalog, import in bulk, or copy from other shops.
        </p>
      </header>

      {scannerError && (
        <div role="alert" className="rounded-xl bg-red-50 px-6 py-4 text-sm font-medium text-red-600 shadow-sm ring-1 ring-red-200">
          {scannerError}
        </div>
      )}

      <div className="flex flex-col">
        <nav className="app-tab-strip" aria-label="Product sections">
          {(["list", "create", "import", "copy"] as const).map((t) => {
            const active = tab === t;
            return (
              <AppTabButton
                key={t}
                onClick={() => setTab(t)}
                active={active}
              >
                <span className="flex items-center gap-2">
                  {t === "list" && <Search className="h-4 w-4" />}
                  {t === "create" && <PlusCircle className="h-4 w-4" />}
                  {t === "import" && <Upload className="h-4 w-4" />}
                  {t === "copy" && <Copy className="h-4 w-4" />}
                  {t === "list"
                    ? "Catalog"
                    : t === "create"
                      ? "New product"
                      : t === "import"
                        ? "Bulk import"
                        : "Copy products"}
                </span>
              </AppTabButton>
            );
          })}
        </nav>

        <div className="app-tab-panel">
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
      </div>
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

  const exportRows = () => {
    if (items === null || items.length === 0) return;
    downloadCsv(
      items.map((product) => ({
        brand: product.brand,
        ...(isSuperadmin ? { shop: formatShopLabel(product.shop_id, shopById) } : {}),
        size_label: product.size_label,
        barcode: product.barcode,
        price: product.price ?? "",
        low_stock_threshold: product.low_stock_threshold ?? "",
        status: product.is_active ? "Active" : "Inactive",
      })),
      `products-catalog-${csvTimestamp()}.csv`,
      [
        "brand",
        ...(isSuperadmin ? ["shop"] : []),
        "size_label",
        "barcode",
        "price",
        "low_stock_threshold",
        "status",
      ]
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="grid gap-6 rounded-xl border border-slate-200/50 bg-white/60 p-6 shadow-[0_8px_30px_rgb(0,0,0,0.02)] backdrop-blur-xl md:grid-cols-4">
        <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500 md:col-span-2">
          <span className="flex items-center gap-1.5"><Search className="h-4 w-4" /> Search</span>
          <input
            type="search"
            value={q}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search by brand or barcode"
            className="h-11 w-full rounded-xl border border-slate-200 bg-white/50 px-4 text-sm font-medium text-slate-700 shadow-sm outline-none transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:bg-white focus-visible:ring-2 focus-visible:ring-action/40 focus-visible:border-action"
          />
        </label>
        {isSuperadmin && (
          <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
            <span className="flex items-center gap-1.5"><Filter className="h-4 w-4" /> Shop</span>
            <select
              aria-label="Shop"
              value={selectedShopId ?? ""}
              onChange={(e) => setSelectedShopId(e.target.value ? Number(e.target.value) : null)}
              className="h-11 rounded-xl border border-slate-200 bg-white/50 px-4 text-sm font-medium text-slate-700 shadow-sm outline-none transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:bg-white focus-visible:ring-2 focus-visible:ring-action/40 focus-visible:border-action"
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
        <div className="flex flex-col justify-end gap-1.5">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={exportRows}
              disabled={items === null || items.length === 0 || (isSuperadmin && selectedShopId === null)}
              className="flex h-11 w-11 items-center justify-center rounded-xl bg-white text-slate-600 shadow-sm ring-1 ring-slate-200 transition-colors hover:bg-slate-50 hover:text-slate-900 disabled:pointer-events-none disabled:opacity-50"
              aria-label="Download catalog CSV"
              title="Download CSV"
            >
              <Download className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={reload}
              className="group flex h-11 items-center justify-center gap-2 rounded-xl bg-slate-100 px-4 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-200"
            >
              <RefreshCw className="h-4 w-4 transition-transform duration-300 group-hover:rotate-180" /> Refresh
            </button>
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm font-medium text-slate-600 md:col-span-4">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => setIncludeInactive(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-action focus:ring-action"
          />
          Include inactive products
        </label>
      </div>

      {error && (
        <div role="alert" className="rounded-xl bg-red-50 px-6 py-4 text-sm font-medium text-red-600 shadow-sm ring-1 ring-red-200">
          {error}
        </div>
      )}

      {items === null ? (
        <div className="p-8 text-center text-sm font-medium text-slate-500">Loading…</div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-slate-200/50 bg-white/60 p-12 text-center text-sm font-medium text-slate-500 shadow-[0_8px_30px_rgb(0,0,0,0.02)] backdrop-blur-xl">
          No products match the current filter.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200/50 bg-white/60 shadow-[0_8px_30px_rgb(0,0,0,0.02)] backdrop-blur-xl">
          <div className="overflow-x-auto">
            <table className="app-list-table min-w-[900px]">
              <thead className="bg-slate-50/80 text-[11px] uppercase tracking-widest text-slate-500">
                <tr>
                  <th className="px-6 py-4 font-semibold">Brand</th>
                  {isSuperadmin && <th className="px-6 py-4 font-semibold">Shop</th>}
                  <th className="px-6 py-4 font-semibold">Size</th>
                  <th className="px-6 py-4 font-semibold">Barcode</th>
                  <th className="px-6 py-4 text-right font-semibold">Price</th>
                  <th className="px-6 py-4 text-right font-semibold">Low-stock</th>
                  <th className="px-6 py-4 font-semibold">Status</th>
                  <th className="px-6 py-4 text-right font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
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
                  <tr key={p.id} className="group bg-white transition-colors duration-200 hover:bg-slate-50/50">
                    <td className="px-6 py-4 font-medium text-slate-900">{p.brand}</td>
                    {isSuperadmin && (
                      <td className="px-6 py-4 text-slate-700">{formatShopLabel(p.shop_id, shopById)}</td>
                    )}
                    <td className="px-6 py-4 text-slate-700">{p.size_label}</td>
                    <td className="px-6 py-4 font-mono text-xs text-slate-500">{p.barcode}</td>
                    <td className="px-6 py-4 text-right font-mono font-semibold text-slate-900">
                      {p.price == null ? "—" : `₹${p.price}`}
                    </td>
                    <td className="px-6 py-4 text-right font-mono font-medium text-slate-600">
                      {p.low_stock_threshold ?? "—"}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-semibold ${
                        p.is_active ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/20" : "bg-slate-100 text-slate-600 ring-1 ring-slate-500/20"
                      }`}>
                        {p.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => onEditingIdChange(p.id)}
                          title="Edit"
                          className="flex h-8 w-8 items-center justify-center rounded-md bg-white text-slate-600 shadow-sm ring-1 ring-slate-200 transition-colors hover:bg-slate-50 hover:text-slate-900"
                        >
                          <Edit3 className="h-4 w-4" />
                        </button>
                        {canManage && p.is_active && (
                          <button
                            type="button"
                            onClick={() => openActionDialog(p, "archive")}
                            title="Delete"
                            className="flex h-8 w-8 items-center justify-center rounded-md bg-white text-red-600 shadow-sm ring-1 ring-slate-200 transition-colors hover:bg-red-50"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                        {canManage && !p.is_active && (
                          <>
                            <button
                              type="button"
                              onClick={() => openActionDialog(p, "restore")}
                              title="Restore"
                              className="flex h-8 w-8 items-center justify-center rounded-md bg-white text-emerald-600 shadow-sm ring-1 ring-slate-200 transition-colors hover:bg-emerald-50"
                            >
                              <RotateCcw className="h-4 w-4" />
                            </button>
                            {isSuperadmin && p.can_permanently_delete && (
                              <button
                                type="button"
                                onClick={() => openActionDialog(p, "permanent-delete")}
                                title="Permanently delete"
                                className="flex h-8 w-8 items-center justify-center rounded-md bg-red-50 text-red-600 transition-colors hover:bg-red-100"
                              >
                                <XOctagon className="h-4 w-4" />
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
    <ModalDialog labelledBy="product-action-title" onDismiss={onCancel} className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm transition-opacity">
      <div className="w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-lg ring-1 ring-slate-200/50">
        <div className="border-b border-slate-200/50 bg-slate-50/80 px-6 py-5">
          <h2 id="product-action-title" className="flex items-center gap-2 text-xl font-semibold tracking-tight text-slate-900">
            <AlertCircle className={`h-5 w-5 ${kind === "permanent-delete" ? "text-red-500" : "text-amber-500"}`} />
            {actionTitle(kind)}
          </h2>
        </div>
        <div className="p-6">
          <div className="flex flex-col gap-4 text-sm text-slate-600">
            <p>
              {kind === "archive"
                ? "This will hide the product from the active catalog."
                : kind === "restore"
                  ? "This will make the product active again."
                  : "This will permanently remove the row if nothing references it."}
            </p>
            <div className="rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
              <span className="font-semibold text-slate-900">{product.brand}</span>{" "}
              <span>&middot; {product.size_label}</span>{" "}
              <span className="font-mono text-xs text-slate-500">({product.barcode})</span>
            </div>
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium text-slate-700">Type <span className="font-mono font-bold text-slate-900">{expected}</span> to confirm</span>
              <input
                value={confirmationText}
                onChange={(e) => onConfirmationTextChange(e.target.value)}
                autoFocus
                className={`h-11 rounded-xl border px-4 text-sm font-medium shadow-sm outline-none transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out focus:ring-1 ${
                  canSubmit ? "border-emerald-500 focus:border-emerald-500 focus:ring-emerald-500 bg-emerald-50 text-emerald-900" : "border-slate-200 focus:border-slate-400 focus:ring-slate-400 bg-white text-slate-900"
                }`}
              />
            </label>
          </div>
          <div className="mt-8 flex justify-end gap-3">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-xl bg-slate-100 px-6 py-2.5 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-200"
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onSubmit}
              disabled={!canSubmit}
              className={`rounded-xl px-6 py-2.5 text-sm font-semibold shadow-sm transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out disabled:opacity-50 disabled:shadow-none ${
                kind === "permanent-delete" ? "bg-red-600 text-white hover:bg-red-700 hover:shadow-red-500/30" : "bg-action text-on-action hover:shadow-[var(--color-action)]/30"
              }`}
            >
              {busy ? "Working…" : actionButtonLabel(kind)}
            </button>
          </div>
        </div>
      </div>
    </ModalDialog>
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
    <section className="flex max-w-xl flex-col gap-6 rounded-xl border border-slate-200/50 bg-white/60 p-8 shadow-[0_8px_30px_rgb(0,0,0,0.02)] backdrop-blur-xl">
      <h2 className="text-xl font-semibold tracking-tight text-slate-900">Copy products</h2>
      <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
        Source shop
        <select
          value={sourceShopId}
          onChange={(e) => setSourceShopId(e.target.value)}
          className="h-12 w-full rounded-xl border border-slate-200 bg-white/50 px-4 text-sm font-medium text-slate-700 shadow-sm outline-none transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:bg-white focus-visible:ring-2 focus-visible:ring-action/40 focus-visible:border-action"
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
        className="flex h-12 w-full items-center justify-center rounded-xl bg-action px-6 text-sm font-bold tracking-wide text-on-action shadow-lg transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[var(--color-action)]/30 active:scale-[0.97] disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none"
      >
        {busy ? "Copying..." : "Copy into selected shop"}
      </button>
      {error && (
        <div role="alert" className="rounded-xl bg-red-50 px-6 py-4 text-sm font-medium text-red-600 shadow-sm ring-1 ring-red-200">
          {error}
        </div>
      )}
      {result && (
        <div className="rounded-xl bg-slate-50 px-6 py-5 text-sm font-medium ring-1 ring-slate-200/60">
          <div className="text-slate-900">
            {result.copied} copied, {result.skipped} skipped
          </div>
          {result.skipped_products.length > 0 && (
            <ul className="mt-3 list-inside list-disc text-slate-500">
              {result.skipped_products.slice(0, 20).map((item) => (
                <li key={item.barcode}>
                  <span className="font-mono text-xs">{item.barcode}</span>: {item.reason}
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
    <tr className="bg-slate-50 shadow-[inset_0_2px_10px_rgba(0,0,0,0.02)]">
      <td className="px-6 py-4">
        <input
          value={brand}
          onChange={(e) => setBrand(e.target.value)}
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-inner outline-none focus-visible:ring-2 focus-visible:ring-action/40 focus-visible:border-action"
        />
      </td>
      {showShop && <td className="px-6 py-4 text-slate-700">{shopLabel}</td>}
      <td className="px-6 py-4">
        <input
          value={sizeLabel}
          onChange={(e) => setSizeLabel(e.target.value)}
          className="w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-inner outline-none focus-visible:ring-2 focus-visible:ring-action/40 focus-visible:border-action"
        />
      </td>
      <td className="px-6 py-4 font-mono text-xs text-slate-500">{product.barcode}</td>
      <td className="px-6 py-4">
        <input
          type="number"
          step="0.01"
          min="0"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          className="w-24 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-right font-mono text-sm shadow-inner outline-none focus-visible:ring-2 focus-visible:ring-action/40 focus-visible:border-action"
        />
      </td>
      <td className="px-6 py-4">
        <input
          type="number"
          min="0"
          value={threshold}
          placeholder="—"
          onChange={(e) => setThreshold(e.target.value)}
          className="w-20 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-right font-mono text-sm shadow-inner outline-none focus-visible:ring-2 focus-visible:ring-action/40 focus-visible:border-action"
        />
      </td>
      <td className="px-6 py-4">
        <input
          type="checkbox"
          checked={active}
          onChange={(e) => setActive(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-action focus:ring-action"
        />
      </td>
      <td className="px-6 py-4">
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md bg-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-300"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="rounded-md bg-action px-3 py-1.5 text-xs font-semibold text-on-action transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
        {error && (
          <div role="alert" className="mt-2 text-right text-xs font-medium text-red-600">
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
      className="flex max-w-xl flex-col gap-6 rounded-xl border border-slate-200/50 bg-white/60 p-8 shadow-[0_8px_30px_rgb(0,0,0,0.02)] backdrop-blur-xl"
    >
      <h2 className="text-xl font-semibold tracking-tight text-slate-900">New product</h2>
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
        className="mt-2 flex h-12 w-full items-center justify-center rounded-xl bg-action px-6 text-sm font-bold tracking-wide text-on-action shadow-lg transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[var(--color-action)]/30 active:scale-[0.97] disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none"
      >
        {busy ? "Creating…" : "Create product"}
      </button>
      {error && (
        <div role="alert" className="rounded-xl bg-red-50 px-6 py-4 text-sm font-medium text-red-600 shadow-sm ring-1 ring-red-200">
          {error}
        </div>
      )}
      {info && (
        <div role="status" className="rounded-xl bg-emerald-50 px-6 py-4 text-sm font-medium text-emerald-600 shadow-sm ring-1 ring-emerald-200">
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
    <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
      {label}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        step={step}
        min={min}
        className="h-12 w-full rounded-xl border border-slate-200 bg-white/50 px-4 text-sm font-medium text-slate-700 shadow-sm outline-none transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:bg-white focus-visible:ring-2 focus-visible:ring-action/40 focus-visible:border-action"
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
    <div className="flex max-w-2xl flex-col gap-6 rounded-xl border border-slate-200/50 bg-white/60 p-8 shadow-[0_8px_30px_rgb(0,0,0,0.02)] backdrop-blur-xl">
      <h2 className="text-xl font-semibold tracking-tight text-slate-900">Bulk CSV import</h2>
      <p className="text-sm text-slate-500">
        Required columns: <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">barcode</code>, <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">brand</code>, <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">size_label</code>,{" "}
        <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">price</code>. Optional column: <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">low_stock_threshold</code>. Blank optional
        thresholds are accepted.
      </p>
      <a
        href="/templates/product-import-template.csv"
        download="product-import-template.csv"
        className="inline-flex items-center gap-2 text-sm font-semibold text-action underline-offset-4 hover:underline"
      >
        <Download className="h-4 w-4" /> Download sample CSV
      </a>
      <label className="flex cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-slate-300 bg-white/50 p-8 transition-colors hover:border-action hover:bg-white">
        <Upload className="h-8 w-8 text-slate-400" />
        <span className="text-sm font-medium text-slate-600">
          {file ? file.name : "Click to select a CSV file"}
        </span>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="hidden"
        />
      </label>
      <button
        type="button"
        onClick={submit}
        disabled={!file || busy}
        className="flex h-12 w-full items-center justify-center rounded-xl bg-action px-6 text-sm font-bold tracking-wide text-on-action shadow-lg transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[var(--color-action)]/30 active:scale-[0.97] disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none"
      >
        {busy ? "Importing…" : "Upload CSV"}
      </button>
      {error && (
        <div role="alert" className="rounded-xl bg-red-50 px-6 py-4 text-sm font-medium text-red-600 shadow-sm ring-1 ring-red-200">
          {error}
        </div>
      )}
      {result && (
        <div className="flex flex-col gap-4 rounded-xl bg-slate-50 p-6 ring-1 ring-slate-200/60">
          <div className="text-lg font-semibold tracking-tight text-slate-900">
            {result.created} created, {result.failed} failed
          </div>
          {result.errors.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-slate-200/50 bg-white shadow-sm">
              <table className="app-list-table">
                <thead className="bg-slate-50/80 text-[11px] uppercase tracking-widest text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Row</th>
                    <th className="px-4 py-3 font-semibold">Barcode</th>
                    <th className="px-4 py-3 font-semibold">Error</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {result.errors.map((e) => (
                    <tr key={`${e.row}-${e.barcode}`} className="transition-colors hover:bg-slate-50/50">
                      <td className="px-4 py-3 font-mono text-xs text-slate-500">{e.row}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-900">{e.barcode ?? "—"}</td>
                      <td className="px-4 py-3 text-red-600">{e.error}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
