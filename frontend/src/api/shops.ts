import { api, withShopId, withShopIdParams } from "./client";

export interface ShopPublic {
  id: number;
  name: string;
  code: string;
  gstin: string | null;
  excise_duty_rate: string | null; // Decimal serialised as string in JSON
  low_stock_threshold_default: number | null;
}

export interface ShopSummary {
  id: number;
  name: string;
  code: string;
}

export interface ShopUpdatePayload {
  name?: string;
  gstin?: string | null;
  excise_duty_rate?: string | null;
  low_stock_threshold_default?: number | null;
}

// Superadmin-only (D-64/D-65): every shop, for the shop-scope picker.
export function listShops(): Promise<ShopSummary[]> {
  return api<ShopSummary[]>("/shops");
}

export function getMyShop(shopId?: number | null): Promise<ShopPublic> {
  const params = withShopIdParams(new URLSearchParams(), shopId);
  const qs = params.toString();
  return api<ShopPublic>(`/shops/me${qs ? `?${qs}` : ""}`);
}

export function updateMyShop(
  payload: ShopUpdatePayload,
  shopId?: number | null
): Promise<ShopPublic> {
  return api<ShopPublic>("/shops/me", { method: "PATCH", json: withShopId(payload, shopId) });
}
