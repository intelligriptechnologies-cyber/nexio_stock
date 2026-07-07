import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

// Superadmin has no shop_id of its own (D-3), so every shop-scoped write
// or read it makes needs an explicit target shop (D-64/D-65). Rather than
// threading a shop picker through every page, the picked shop lives here
// once, in a top-of-shell control (see ShopPicker), and every API call
// that needs it reads from this context.
const KEY = "barstock.actingShopId";

interface ShopScopeValue {
  actingShopId: number | null;
  setActingShopId: (id: number | null) => void;
}

const Ctx = createContext<ShopScopeValue | undefined>(undefined);

function readStored(): number | null {
  const raw = sessionStorage.getItem(KEY);
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function ShopScopeProvider({ children }: { children: ReactNode }) {
  const [actingShopId, setActingShopIdState] = useState<number | null>(readStored);

  const setActingShopId = useCallback((id: number | null) => {
    if (id === null) sessionStorage.removeItem(KEY);
    else sessionStorage.setItem(KEY, String(id));
    setActingShopIdState(id);
  }, []);

  const value = useMemo(() => ({ actingShopId, setActingShopId }), [actingShopId, setActingShopId]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useShopScope(): ShopScopeValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useShopScope must be used within a ShopScopeProvider");
  return ctx;
}
