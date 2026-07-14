import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toUserMessage } from "../api/client";
import { listProducts, type Product } from "../api/products";
import { useAuth } from "../auth/AuthProvider";
import { useShopScope, useShopScopeGuard } from "../auth/ShopScopeProvider";
import { PackageOpen, Search, Filter, ArrowDownUp, ArrowDownToLine, ShoppingCart, Edit3 } from "lucide-react";

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
  return `Rs. ${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export function InventoryPage() {
  const { user } = useAuth();
  const { actingShopId } = useShopScope();
  const shopScopeGuard = useShopScopeGuard();
  const [items, setItems] = useState<Product[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [stockFilter, setStockFilter] = useState<StockFilter>("all");
  const [sortMode, setSortMode] = useState<SortMode>("name");

  useEffect(() => {
    let cancelled = false;
    if (shopScopeGuard.blocked) {
      setItems([]);
      setError(shopScopeGuard.message);
      return () => {
        cancelled = true;
      };
    }

    setItems(null);
    setError(null);
    listProducts({ shopId: actingShopId })
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch((e) => {
        if (!cancelled) {
          setItems([]);
          setError(toUserMessage(e, "Could not load inventory."));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [actingShopId, shopScopeGuard.blocked, shopScopeGuard.message]);

  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const filtered = (items ?? []).filter((item) => {
      const state = stockState(item);
      if (stockFilter !== "all" && state !== stockFilter) return false;
      if (!normalizedQuery) return true;
      return [item.brand, item.size_label, item.barcode].some((value) =>
        value.toLowerCase().includes(normalizedQuery)
      );
    });

    return [...filtered].sort((a, b) => {
      if (sortMode === "stock_asc") {
        return a.current_stock - b.current_stock || a.brand.localeCompare(b.brand);
      }
      if (sortMode === "stock_desc") {
        return b.current_stock - a.current_stock || a.brand.localeCompare(b.brand);
      }
      return (
        a.brand.localeCompare(b.brand) ||
        a.size_label.localeCompare(b.size_label) ||
        a.barcode.localeCompare(b.barcode)
      );
    });
  }, [items, query, sortMode, stockFilter]);

  const canReceive =
    user?.role === "receiver_user" || user?.role === "owner" || user?.role === "superadmin";
  const canCheckout = user?.role === "cashier_user";
  const canEditProduct = user?.role === "owner" || user?.role === "superadmin";

  return (
    <div className="flex flex-col gap-8 font-sans">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 text-3xl font-light tracking-tight text-slate-900">
            <PackageOpen className="h-8 w-8 text-action" /> Inventory
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Active catalog with derived available stock.
          </p>
        </div>
      </header>

      {error && (
        <div role="alert" className="rounded-xl bg-red-50 px-6 py-4 text-sm font-medium text-red-600 shadow-sm ring-1 ring-red-200">
          {error}
        </div>
      )}

      {!shopScopeGuard.blocked && (
        <div className="grid gap-6 rounded-[24px] border border-slate-200/50 bg-white/60 p-6 shadow-[0_8px_30px_rgb(0,0,0,0.02)] backdrop-blur-xl md:grid-cols-3">
          <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
            <span className="flex items-center gap-1.5"><Search className="h-4 w-4" /> Search</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Brand, size, or barcode"
              className="h-11 w-full rounded-xl border border-slate-200 bg-white/50 px-4 text-sm font-medium text-slate-700 shadow-sm outline-none transition-all hover:bg-white focus:border-action focus:ring-1 focus:ring-action"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
            <span className="flex items-center gap-1.5"><Filter className="h-4 w-4" /> Stock state</span>
            <select
              value={stockFilter}
              onChange={(e) => setStockFilter(e.target.value as StockFilter)}
              className="h-11 w-full rounded-xl border border-slate-200 bg-white/50 px-4 text-sm font-medium text-slate-700 shadow-sm outline-none transition-all hover:bg-white focus:border-action focus:ring-1 focus:ring-action"
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
              onChange={(e) => setSortMode(e.target.value as SortMode)}
              className="h-11 w-full rounded-xl border border-slate-200 bg-white/50 px-4 text-sm font-medium text-slate-700 shadow-sm outline-none transition-all hover:bg-white focus:border-action focus:ring-1 focus:ring-action"
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
        <div className="rounded-[24px] border border-slate-200/50 bg-white/60 p-12 text-center text-sm font-medium text-slate-500 shadow-[0_8px_30px_rgb(0,0,0,0.02)] backdrop-blur-xl">
          No inventory rows match the current filters.
        </div>
      ) : visibleItems.length > 0 ? (
        <div className="overflow-hidden rounded-[24px] border border-slate-200/50 bg-white/60 shadow-[0_8px_30px_rgb(0,0,0,0.02)] backdrop-blur-xl">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-left text-sm" aria-label="Inventory table">
              <thead className="bg-slate-50/80 text-[11px] uppercase tracking-widest text-slate-500">
                <tr>
                  <th className="px-6 py-4 font-semibold">Product / brand</th>
                  <th className="px-6 py-4 font-semibold">Size / variant</th>
                  <th className="px-6 py-4 font-semibold">Barcode</th>
                  <th className="px-6 py-4 text-right font-semibold">Price</th>
                  <th className="px-6 py-4 text-right font-semibold">Available stock</th>
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
                      <td className="px-6 py-4 text-right font-mono text-base font-bold text-slate-900">
                        {item.current_stock}
                      </td>
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
                              title="Receive"
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
        </div>
      ) : null}
    </div>
  );
}
