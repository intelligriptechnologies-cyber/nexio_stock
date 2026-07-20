import { useEffect, useState } from "react";
import { listShops, type ShopSummary } from "../api/shops";
import { useAuth } from "../auth/AuthProvider";
import { useShopScope } from "../auth/ShopScopeProvider";

// Superadmin-only control: every shop-scoped read/write superadmin makes
// needs an explicit target shop_id (D-64/D-65, since superadmin's own
// account has no shop_id). Rather than a picker on every page, this one
// control (rendered once in AuthedShell) sets the "acting shop" for the
// whole session.
export function ShopPicker() {
  const { user } = useAuth();
  const { actingShopId, setActingShopId, shopsVersion } = useShopScope();
  const [shops, setShops] = useState<ShopSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const selectedShop = shops.find((shop) => shop.id === actingShopId) ?? null;
  const topRowText = selectedShop ? "Working shop" : "Select before edit/billing";

  useEffect(() => {
    if (user?.role !== "superadmin") return;
    setError(null);
    listShops()
      .then(setShops)
      .catch(() => setError("Could not load shops. Try again shortly."));
  }, [user?.role, shopsVersion]);

  if (user?.role !== "superadmin") return null;

  return (
    <div className="shrink-0">
      <div className="rounded-md border border-outline bg-sidebar-hover/35 p-2.5" data-testid="shop-picker-panel">
        <div
          data-testid="shop-picker-status"
          className={`min-w-0 truncate text-[11px] font-semibold leading-4 ${
            selectedShop ? "text-on-sidebar" : "text-on-sidebar-muted"
          }`}
        >
          {topRowText}
        </div>
        <select
          id="shop-picker"
          aria-label="Working shop"
          className="mt-2 h-10 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm font-semibold text-slate-900 shadow-sm outline-none transition-[border-color,box-shadow] duration-200 ease-out hover:border-action/50 focus-visible"
          value={actingShopId ?? ""}
          onChange={(e) => setActingShopId(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">Select working shop</option>
          {shops.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.code})
            </option>
          ))}
        </select>
        {error && <div className="mt-2 text-sm font-medium leading-5 text-on-error">{error}</div>}
      </div>
    </div>
  );
}
