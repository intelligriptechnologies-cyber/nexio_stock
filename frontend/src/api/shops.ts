import { api } from "./client";

export interface ShopPublic {
  id: number;
  name: string;
  code: string;
  gstin: string | null;
  excise_duty_rate: string | null; // Decimal serialised as string in JSON
  low_stock_threshold_default: number | null;
}

export interface ShopUpdatePayload {
  name?: string;
  gstin?: string | null;
  excise_duty_rate?: string | null;
  low_stock_threshold_default?: number | null;
}

export function getMyShop(): Promise<ShopPublic> {
  return api<ShopPublic>("/shops/me");
}

export function updateMyShop(payload: ShopUpdatePayload): Promise<ShopPublic> {
  return api<ShopPublic>("/shops/me", { method: "PATCH", json: payload });
}