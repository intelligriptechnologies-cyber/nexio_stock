import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { useShopScope } from "../auth/ShopScopeProvider";
import { listShops, type ShopSummary } from "../api/shops";

// Superadmin-only control: every shop-scoped read/write superadmin makes
// needs an explicit target shop_id (D-64/D-65, since superadmin's own
// account has no shop_id). Rather than a picker on every page, this one
// control (rendered once in AuthedShell) sets the "acting shop" for the
// whole session.
export function ShopPicker() {
  const { user } = useAuth();
  const { actingShopId, setActingShopId } = useShopScope();
  const [shops, setShops] = useState<ShopSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user?.role !== "superadmin") return;
    listShops()
      .then(setShops)
      .catch((e) => setError(e instanceof Error ? e.message : "failed to load shops"));
  }, [user?.role]);

  if (user?.role !== "superadmin") return null;

  return (
    <div className="border-b border-on-primary/20 p-stack-gap">
      <label className="block text-label-md text-on-primary/70" htmlFor="shop-picker">
        Acting on shop
      </label>
      <select
        id="shop-picker"
        className="mt-1 w-full min-h-touchTarget-sm rounded-md bg-primary-container px-2 text-label-md text-on-primary"
        value={actingShopId ?? ""}
        onChange={(e) => setActingShopId(e.target.value ? Number(e.target.value) : null)}
      >
        <option value="">— select a shop —</option>
        {shops.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name} ({s.code})
          </option>
        ))}
      </select>
      {error && <div className="mt-1 text-label-md text-red-300">{error}</div>}
      {!error && actingShopId === null && (
        <div className="mt-1 text-label-md text-on-primary/60">
          Pick a shop before creating/editing anything.
        </div>
      )}
    </div>
  );
}
