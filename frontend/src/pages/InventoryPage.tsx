import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toUserMessage } from "../api/client";
import { listProducts, type Product } from "../api/products";
import { useShopScope, useShopScopeGuard } from "../auth/ShopScopeProvider";

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

  return (
    <div className="flex flex-col gap-stack-gap">
      <div className="flex flex-wrap items-end justify-between gap-stack-gap">
        <div>
          <h1 className="text-headline-lg text-primary">Inventory</h1>
          <p className="mt-1 text-body-md text-on-surface-variant">
            Active catalog with derived available stock.
          </p>
        </div>
      </div>

      {error && (
        <div role="alert" className="rounded-md bg-error px-stack-gap py-3 text-on-error">
          {error}
        </div>
      )}

      {!shopScopeGuard.blocked && (
        <div className="flex flex-wrap gap-stack-gap bg-surface-container p-stack-gap">
          <label className="flex min-w-64 flex-1 flex-col gap-1 text-label-md">
            Search
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Brand, size, or barcode"
              className="min-h-touchTarget-sm rounded-md border border-outline bg-surface px-stack-gap text-body-md"
            />
          </label>
          <label className="flex min-w-48 flex-col gap-1 text-label-md">
            Stock state
            <select
              value={stockFilter}
              onChange={(e) => setStockFilter(e.target.value as StockFilter)}
              className="min-h-touchTarget-sm rounded-md border border-outline bg-surface px-stack-gap text-body-md"
            >
              <option value="all">All</option>
              <option value="in_stock">In stock</option>
              <option value="low_stock">Low stock</option>
              <option value="out_of_stock">Out of stock</option>
            </select>
          </label>
          <label className="flex min-w-52 flex-col gap-1 text-label-md">
            Sort
            <select
              value={sortMode}
              onChange={(e) => setSortMode(e.target.value as SortMode)}
              className="min-h-touchTarget-sm rounded-md border border-outline bg-surface px-stack-gap text-body-md"
            >
              <option value="name">Product name</option>
              <option value="stock_asc">Stock low-to-high</option>
              <option value="stock_desc">Stock high-to-low</option>
            </select>
          </label>
        </div>
      )}

      {items === null ? (
        <div className="text-on-surface-variant">Loading...</div>
      ) : visibleItems.length === 0 && !shopScopeGuard.blocked ? (
        <div className="rounded-md bg-surface-container p-stack-gap text-on-surface-variant">
          No inventory rows match the current filters.
        </div>
      ) : visibleItems.length > 0 ? (
        <div className="overflow-x-auto bg-surface-container">
          <table className="w-full min-w-[960px] border-collapse" aria-label="Inventory table">
            <thead>
              <tr className="border-b border-outline text-label-md text-on-surface-variant">
                <th className="px-stack-gap py-2 text-left">Product / brand</th>
                <th className="px-stack-gap py-2 text-left">Size / variant</th>
                <th className="px-stack-gap py-2 text-left">Barcode</th>
                <th className="px-stack-gap py-2 text-right">Price</th>
                <th className="px-stack-gap py-2 text-right">Available stock</th>
                <th className="px-stack-gap py-2 text-right">Low-stock threshold</th>
                <th className="px-stack-gap py-2 text-left">Stock state</th>
                <th className="px-stack-gap py-2 text-right">Shortcuts</th>
              </tr>
            </thead>
            <tbody>
              {visibleItems.map((item) => {
                const state = stockState(item);
                return (
                  <tr key={item.id} className="border-b border-outline/40">
                    <td className="px-stack-gap py-2 font-medium">{item.brand}</td>
                    <td className="px-stack-gap py-2">{item.size_label}</td>
                    <td className="px-stack-gap py-2 font-mono text-label-md">{item.barcode}</td>
                    <td className="px-stack-gap py-2 text-right font-mono">{money(item.price)}</td>
                    <td className="px-stack-gap py-2 text-right font-mono">
                      {item.current_stock}
                    </td>
                    <td className="px-stack-gap py-2 text-right font-mono">
                      {item.low_stock_threshold ?? "--"}
                    </td>
                    <td className="px-stack-gap py-2">
                      <span
                        className={`inline-flex rounded-md px-2 py-1 text-label-md ${
                          state === "out_of_stock"
                            ? "bg-error text-on-error"
                            : state === "low_stock"
                              ? "bg-warning text-on-warning"
                              : "bg-success text-on-secondary"
                        }`}
                      >
                        {stockLabel(state)}
                      </span>
                    </td>
                    <td className="px-stack-gap py-2">
                      <div className="flex justify-end gap-2">
                        <Link
                          to="/receiving"
                          className="rounded-md bg-action px-stack-gap py-1 text-label-md text-on-action"
                        >
                          Receive
                        </Link>
                        <Link
                          to="/admin/products"
                          className="rounded-md bg-primary px-stack-gap py-1 text-label-md text-on-primary"
                        >
                          Edit product
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
