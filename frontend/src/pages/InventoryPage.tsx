import { useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { toUserMessage } from "../api/client";
import { downloadInventoryExport, listInventoryPage, type Product } from "../api/products";
import { useAuth } from "../auth/AuthProvider";
import { useShopScope, useShopScopeGuard } from "../auth/ShopScopeProvider";
import { PackageOpen, Search, Filter, ArrowDownUp, ArrowDownToLine, ShoppingCart, Edit3, Download } from "lucide-react";
import { triggerDownload } from "../utils/csv";
import { Pagination } from "../components/Pagination";
import { pageOffset, pageSizeParam, positiveInt, STANDARD_PAGE_SIZES } from "../utils/pagination";

type StockFilter = "all" | "in_stock" | "low_stock" | "out_of_stock";
type SortMode = "name" | "stock_asc" | "stock_desc";
type StockState = "in_stock" | "low_stock" | "out_of_stock";

function stockState(product: Product): StockState {
  const stock = product.current_stock;
  if (stock <= 0) return "out_of_stock";
  if (
    product.low_stock_threshold !== null &&
    stock > 0 &&
    stock <= product.low_stock_threshold
  ) {
    return "low_stock";
  }
  return "in_stock";
}

function stockLabel(state: StockState): string {
  switch (state) {
    case "out_of_stock":
      return "Out of stock";
    case "low_stock":
      return "Low stock";
    case "in_stock":
      return "In stock";
  }
}

function money(price: string | null): string {
  if (price === null) return "--";
  const n = Number(price);
  if (!Number.isFinite(n)) return `Rs. ${price}`;
  return `Rs. ${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function valuation(item: Product): string {
  if (item.latest_unit_cost === null) return "--";
  return money((Number(item.latest_unit_cost) * item.current_stock).toFixed(2));
}

export function InventoryPage() {
  const { user } = useAuth();
  const { actingShopId } = useShopScope();
  const shopScopeGuard = useShopScopeGuard();
  const [items, setItems] = useState<Product[] | null>(null);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const stockFilter = (["in_stock", "low_stock", "out_of_stock"].includes(searchParams.get("stock") ?? "") ? searchParams.get("stock") : "all") as StockFilter;
  const sortMode = (["stock_asc", "stock_desc"].includes(searchParams.get("sort") ?? "") ? searchParams.get("sort") : "name") as SortMode;
  const page = positiveInt(searchParams.get("page"), 1);
  const pageSize = pageSizeParam(searchParams.get("pageSize"), STANDARD_PAGE_SIZES, 25);

  useEffect(() => {
    const restored = searchParams.get("q") ?? "";
    if (restored !== query) setQuery(restored);
  }, [searchParams]);

  const updateParams = useCallback((changes: Record<string, string | null>, replace = false) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(changes)) {
        if (!value || (key !== "page" && value === "all") || (key === "sort" && value === "name")) next.delete(key);
        else next.set(key, value);
      }
      return next;
    }, { replace });
  }, [setSearchParams]);

  useEffect(() => {
    const timer = window.setTimeout(() => updateParams({ q: query.trim() || null, page: "1" }, true), 300);
    return () => window.clearTimeout(timer);
  }, [query, updateParams]);

  useEffect(() => {
    const controller = new AbortController();
    if (shopScopeGuard.blocked) {
      setItems([]);
      setError(shopScopeGuard.message);
      return () => {
        controller.abort();
      };
    }

    setBusy(true);
    setError(null);
    listInventoryPage({
      shopId: actingShopId, q: searchParams.get("q") ?? undefined,
      stockState: stockFilter, sort: sortMode, limit: pageSize,
      offset: pageOffset(page, pageSize), signal: controller.signal,
    })
      .then(({ data, total: nextTotal }) => {
        setItems(data);
        setTotal(nextTotal);
      })
      .catch((e) => {
        if (!(e instanceof DOMException && e.name === "AbortError")) setError(toUserMessage(e, "Could not load inventory."));
      })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });

    return () => {
      controller.abort();
    };
  }, [actingShopId, shopScopeGuard.blocked, shopScopeGuard.message, searchParams, stockFilter, sortMode, page, pageSize]);

  const visibleItems = items ?? [];

  const canReceive =
    user?.role === "receiver_user" || user?.role === "owner" || user?.role === "superadmin";
  const canCheckout = user?.role === "cashier_user";
  const canEditProduct = user?.role === "owner" || user?.role === "superadmin";
  const exportDisabled = items === null || visibleItems.length === 0 || shopScopeGuard.blocked;

  const exportRows = async () => {
    try {
      const result = await downloadInventoryExport({
        q: searchParams.get("q") ?? undefined, stockState: stockFilter,
        sort: sortMode, shopId: actingShopId,
      });
      triggerDownload(result.blob, result.filename ?? "inventory.csv");
    } catch (e) { setError(toUserMessage(e, "Export failed.")); }
  };

  return (
    <div className="flex flex-col gap-8 font-sans">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight text-slate-900">
            <PackageOpen className="h-8 w-8 text-action" /> Inventory
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Active catalog with derived available stock.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void exportRows()}
          disabled={exportDisabled}
          className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-slate-600 shadow-sm ring-1 ring-slate-200 transition-colors hover:bg-slate-50 hover:text-slate-900 disabled:pointer-events-none disabled:opacity-50"
          aria-label="Download inventory CSV"
          title="Download CSV"
        >
          <Download className="h-4 w-4" />
        </button>
      </header>

      {error && (
        <div role="alert" className="rounded-xl bg-red-50 px-6 py-4 text-sm font-medium text-red-600 shadow-sm ring-1 ring-red-200">
          {error}
        </div>
      )}

      {!shopScopeGuard.blocked && (
        <div className="grid gap-6 rounded-xl border border-slate-200/50 bg-white/60 p-6 shadow-[0_8px_30px_rgb(0,0,0,0.02)] backdrop-blur-xl md:grid-cols-3">
          <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
            <span className="flex items-center gap-1.5"><Search className="h-4 w-4" /> Search</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Brand, size, or barcode"
              className="h-11 w-full rounded-xl border border-slate-200 bg-white/50 px-4 text-sm font-medium text-slate-700 shadow-sm outline-none transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:bg-white focus-visible:ring-2 focus-visible:ring-action/40 focus-visible:border-action"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
            <span className="flex items-center gap-1.5"><Filter className="h-4 w-4" /> Stock state</span>
            <select
              value={stockFilter}
              onChange={(e) => updateParams({ stock: e.target.value, page: "1" })}
              className="h-11 w-full rounded-xl border border-slate-200 bg-white/50 px-4 text-sm font-medium text-slate-700 shadow-sm outline-none transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:bg-white focus-visible:ring-2 focus-visible:ring-action/40 focus-visible:border-action"
            >
              <option value="all">All</option>
              <option value="in_stock">In stock</option>
              <option value="low_stock">Low stock</option>
              <option value="out_of_stock">Out of stock</option>
            </select>
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
            <span className="flex items-center gap-1.5"><ArrowDownUp className="h-4 w-4" /> Sort</span>
            <select
              value={sortMode}
              onChange={(e) => updateParams({ sort: e.target.value, page: "1" })}
              className="h-11 w-full rounded-xl border border-slate-200 bg-white/50 px-4 text-sm font-medium text-slate-700 shadow-sm outline-none transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:bg-white focus-visible:ring-2 focus-visible:ring-action/40 focus-visible:border-action"
            >
              <option value="name">Product name</option>
              <option value="stock_asc">Stock low-to-high</option>
              <option value="stock_desc">Stock high-to-low</option>
            </select>
          </label>
        </div>
      )}

      {items === null ? (
        <div className="p-8 text-center text-sm font-medium text-slate-500">Loading...</div>
      ) : visibleItems.length === 0 && !shopScopeGuard.blocked ? (
        <div className="rounded-xl border border-slate-200/50 bg-white/60 p-12 text-center text-sm font-medium text-slate-500 shadow-[0_8px_30px_rgb(0,0,0,0.02)] backdrop-blur-xl">
          No inventory rows match the current filters.
        </div>
      ) : visibleItems.length > 0 ? (
        <div className={`overflow-hidden rounded-xl border border-slate-200/50 bg-white/60 shadow-[0_8px_30px_rgb(0,0,0,0.02)] backdrop-blur-xl ${busy ? "opacity-70" : ""}`} aria-busy={busy}>
          <div className="px-6 pt-4">
            <Pagination page={page} pageSize={pageSize} total={total} disabled={busy}
              label="inventory" position="top" pageSizes={STANDARD_PAGE_SIZES}
              onPageChange={(next) => updateParams({ page: String(next) })}
              onPageSizeChange={(size) => updateParams({ page: "1", pageSize: String(size) }, true)} />
          </div>
          <div className="overflow-x-auto">
            <table className="app-list-table min-w-[1120px]" aria-label="Inventory table">
              <thead className="bg-slate-50/80 text-[11px] uppercase tracking-widest text-slate-500">
                <tr>
                  <th className="px-6 py-4 font-semibold">Product / brand</th>
                  <th className="px-6 py-4 font-semibold">Size / variant</th>
                  <th className="px-6 py-4 font-semibold">Barcode</th>
                  <th className="px-6 py-4 text-right font-semibold">Sell price</th>
                  <th className="px-6 py-4 text-right font-semibold">Cost</th>
                  <th className="px-6 py-4 text-right font-semibold">Available stock</th>
                  <th className="px-6 py-4 text-right font-semibold">Inventory value</th>
                  <th className="px-6 py-4 text-right font-semibold">Low-stock threshold</th>
                  <th className="px-6 py-4 font-semibold">Stock state</th>
                  <th className="px-6 py-4 text-right font-semibold">Shortcuts</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleItems.map((item) => {
                  const state = stockState(item);
                  return (
                    <tr key={item.id} className="group bg-white transition-colors duration-200 hover:bg-slate-50/50">
                      <td className="px-6 py-4 font-medium text-slate-900">{item.brand}</td>
                      <td className="px-6 py-4 text-slate-700">{item.size_label}</td>
                      <td className="px-6 py-4 font-mono text-xs text-slate-500">{item.barcode}</td>
                      <td className="px-6 py-4 text-right font-mono font-semibold text-slate-900">{money(item.price)}</td>
                      <td className="px-6 py-4 text-right font-mono font-semibold text-slate-900">{money(item.latest_unit_cost)}</td>
                      <td className="px-6 py-4 text-right font-mono text-base font-bold text-slate-900">
                        {item.current_stock}
                      </td>
                      <td className="px-6 py-4 text-right font-mono font-semibold text-slate-900">{valuation(item)}</td>
                      <td className="px-6 py-4 text-right font-mono text-slate-500">
                        {item.low_stock_threshold ?? "--"}
                      </td>
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center rounded-md px-2.5 py-1 text-xs font-semibold ${
                            state === "out_of_stock"
                              ? "bg-red-50 text-red-700 ring-1 ring-red-600/20"
                              : state === "low_stock"
                                ? "bg-amber-50 text-amber-700 ring-1 ring-amber-600/20"
                                : "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/20"
                          }`}
                        >
                          {stockLabel(state)}
                        </span>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center justify-end gap-1">
                          {canReceive && (
                            <Link
                              to="/receiving"
                              title="Stock Inward"
                              className="flex h-8 w-8 items-center justify-center rounded-md bg-white text-action shadow-sm ring-1 ring-slate-200 transition-colors hover:bg-slate-50"
                            >
                              <ArrowDownToLine className="h-4 w-4" />
                            </Link>
                          )}
                          {canCheckout && (
                            <Link
                              to="/checkout"
                              title="Checkout"
                              className="flex h-8 w-8 items-center justify-center rounded-md bg-white text-action shadow-sm ring-1 ring-slate-200 transition-colors hover:bg-slate-50"
                            >
                              <ShoppingCart className="h-4 w-4" />
                            </Link>
                          )}
                          {canEditProduct && (
                            <Link
                              to="/admin/products"
                              title="Edit product"
                              className="flex h-8 w-8 items-center justify-center rounded-md bg-white text-slate-600 shadow-sm ring-1 ring-slate-200 transition-colors hover:bg-slate-50 hover:text-slate-900"
                            >
                              <Edit3 className="h-4 w-4" />
                            </Link>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-6 pb-4">
            <Pagination page={page} pageSize={pageSize} total={total} disabled={busy}
              label="inventory" position="bottom" pageSizes={STANDARD_PAGE_SIZES}
              onPageChange={(next) => updateParams({ page: String(next) })}
              onPageSizeChange={(size) => updateParams({ page: "1", pageSize: String(size) }, true)} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
