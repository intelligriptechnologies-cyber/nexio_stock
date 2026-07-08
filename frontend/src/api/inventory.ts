// Issue #43 — Inventory page API wrappers.
//
// Lean LotSummary shape: lot #, date, receiver, total quantity. Full
// lot detail lives on GET /lots/{lot_id} for when the receiver wants
// to drill into a specific delivery. The endpoint scopes to the
// caller's acting shop (R-v3-16: superadmin uses the ShopPicker,
// everyone else gets their own shop automatically).

import { api, withShopIdParams } from "./client";

export interface LotSummary {
  id: number;
  received_at: string;
  received_by_user_id: number;
  received_by_name: string;
  total_quantity: number;
}

export interface LotSummaryListResponse {
  lots: LotSummary[];
  evaluated_at: string;
}

export function listLotHistory(
  shopId?: number | null
): Promise<LotSummaryListResponse> {
  const params = withShopIdParams(new URLSearchParams(), shopId);
  const qs = params.toString();
  return api<LotSummaryListResponse>(`/inventory/lots${qs ? "?" + qs : ""}`);
}