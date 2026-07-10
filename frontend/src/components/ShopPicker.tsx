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

  useEffect(() => {
    if (user?.role !== "superadmin") return;
    setError(null);
    listShops()
      .then(setShops)
      .catch(() => setError("Could not load shops. Try again shortly."));
  }, [user?.role, shopsVersion]);

  if (user?.role !== "superadmin") return null;

  return (
    <div className="shrink-0 border-b border-outline p-3">
      <div className="rounded-md border border-outline bg-sidebar-hover/35 p-3">
        <label className="block text-label-md text-on-sidebar" htmlFor="shop-picker">
          Working shop
        </label>
        <select
          id="shop-picker"
          className="mt-2 w-full min-h-touchTarget-sm rounded-md border border-outline bg-surface px-2 text-label-md text-on-surface"
          value={actingShopId ?? ""}
          onChange={(e) => setActingShopId(e.target.value ? Number(e.target.value) : null)}
        >
          <option value="">Select shop</option>
          {shops.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.code})
            </option>
          ))}
        </select>
        {error && <div className="mt-2 text-label-md text-on-error">{error}</div>}
        {!error && actingShopId === null && (
          <div className="mt-2 text-label-md text-on-sidebar-muted">
            Required before shop edits or billing actions.
          </div>
        )}
      </div>
    </div>
  );
}
