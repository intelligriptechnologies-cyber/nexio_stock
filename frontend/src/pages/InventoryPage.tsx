// Issue #43 — Inventory page (R-v3-7, R-v3-8, R-v3-13, R-v3-16).
//
// Read-accessible to owner, receiver_user, cashier_user, and
// superadmin (via the acting-shop picker). Two sections on one page:
//   - Current stock counts per product for the acting shop
//     (reuses the same `current_stock` value the catalog endpoint
//     returns — single source of truth shared with the dashboard's
//     low-stock list and checkout oversell check).
//   - Lot-level receiving history (lot #, date, receiver, total
//     quantity) for the acting shop.
//
// Shop-scoping (R-v3-16): the page reads `actingShopId` from the
// ShopScopeProvider, so single-shop roles (receiver/cashier/owner-of-one)
// see their own shop's data with no picker rendered. Owner-of-many-shops
// and superadmin use the existing Sidebar ShopPicker.

import { useCallback, useEffect, useState } from "react";
import { toUserMessage } from "../api/client";
import { listProducts, type Product } from "../api/products";
import { listLotHistory, type LotSummary } from "../api/inventory";
import { useShopScope, useShopScopeGuard } from "../auth/ShopScopeProvider";

export function InventoryPage() {
  const { actingShopId } = useShopScope();
  const shopScopeGuard = useShopScopeGuard();
  const [products, setProducts] = useState<Product[] | null>(null);
  const [lots, setLots] = useState<LotSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (shopScopeGuard.blocked) {
      setProducts(null);
      setLots(null);
      return;
    }
    setError(null);
    try {
      // Both endpoints accept actingShopId; superadmin passes their
      // picked shop, every other role passes their own shop_id (the
      // shop_ids are equivalent for non-superadmin).
      const [prods, lotsResp] = await Promise.all([
        listProducts({ includeInactive: true }),
        listLotHistory(actingShopId),
      ]);
      setProducts(prods);
      setLots(lotsResp.lots);
    } catch (e) {
      setError(toUserMessage(e, "Load failed."));
    }
  }, [actingShopId, shopScopeGuard.blocked]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <div className="flex flex-col gap-gutter">
      <header>
        <h1 className="text-headline-lg text-primary">Inventory</h1>
        <p className="text-label-md text-on-surface-variant">
          Current stock per product and recent receiving history for the
          acting shop.
        </p>
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

      {/* Section 1 — current stock (R-v3-7). Reuses the catalog's
          current_stock — same single source of truth as the catalog
          column (#40) and the dashboard low-stock list. */}
      <section className="rounded-lg bg-surface-container p-gutter">
        <h2 className="mb-stack-gap text-headline-md text-primary">
          Current stock
        </h2>
        {products === null ? (
          <div className="text-on-surface-variant">Loading…</div>
        ) : products.length === 0 ? (
          <div className="text-on-surface-variant">
            No products in this shop.
          </div>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-outline text-label-md text-on-surface-variant">
                <th className="px-stack-gap py-2 text-left">Brand</th>
                <th className="px-stack-gap py-2 text-left">Size</th>
                <th className="px-stack-gap py-2 text-left">Barcode</th>
                <th className="px-stack-gap py-2 text-right">Stock</th>
                <th className="px-stack-gap py-2 text-left">Active</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => (
                <tr
                  key={p.id}
                  className="border-b border-outline/40"
                >
                  <td className="px-stack-gap py-2">{p.brand}</td>
                  <td className="px-stack-gap py-2">{p.size_label}</td>
                  <td className="px-stack-gap py-2 font-mono text-label-md">
                    {p.barcode}
                  </td>
                  <td className="px-stack-gap py-2 text-right font-mono">
                    {p.current_stock ?? 0}
                  </td>
                  <td className="px-stack-gap py-2">
                    {p.is_active ? "yes" : "no"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Section 2 — lot-level receiving history (R-v3-8). Lean rows:
          lot #, date, receiver, total quantity. */}
      <section className="rounded-lg bg-surface-container p-gutter">
        <h2 className="mb-stack-gap text-headline-md text-primary">
          Receiving history
        </h2>
        {lots === null ? (
          <div className="text-on-surface-variant">Loading…</div>
        ) : lots.length === 0 ? (
          <div className="text-on-surface-variant">
            No lots recorded for this shop.
          </div>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-outline text-label-md text-on-surface-variant">
                <th className="px-stack-gap py-2 text-right">Lot #</th>
                <th className="px-stack-gap py-2 text-left">Date</th>
                <th className="px-stack-gap py-2 text-left">Receiver</th>
                <th className="px-stack-gap py-2 text-right">Total quantity</th>
              </tr>
            </thead>
            <tbody>
              {lots.map((l) => (
                <tr key={l.id} className="border-b border-outline/40">
                  <td className="px-stack-gap py-2 text-right font-mono">
                    {l.id}
                  </td>
                  <td className="px-stack-gap py-2">
                    {new Date(l.received_at).toLocaleString()}
                  </td>
                  <td className="px-stack-gap py-2">{l.received_by_name}</td>
                  <td className="px-stack-gap py-2 text-right font-mono">
                    {l.total_quantity}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}