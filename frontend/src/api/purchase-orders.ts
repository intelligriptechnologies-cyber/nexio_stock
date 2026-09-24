import { API_BASE, ApiError, api, getToken, withShopId, withShopIdParams } from "./client";

export type PurchaseOrderStatus = "draft" | "open" | "partially_received" | "fulfilled" | "cancelled";

export interface PurchaseOrderLine {
  id: number;
  source_item_name: string;
  size_ml: number | null;
  product_id: number | null;
  product_barcode: string | null;
  product_brand: string | null;
  product_size_label: string | null;
  cases: number;
  loose_bottles: number;
  pack_size_snapshot: number | null;
  ordered_bottles: number | null;
  case_rate: string | null;
  mger: string | null;
  amount: string | null;
  sequence: number;
  ocr_confidence: string | null;
  field_confidence: Record<string, number>;
  match_candidates: Array<{ product_id: number; brand: string; size_label: string; score: number }>;
  delivered_bottles: number;
  accepted_bottles: number;
  broken_bottles: number;
  remaining_bottles: number;
  excess_bottles: number;
}

export interface PurchaseOrder {
  id: number;
  shop_id: number;
  osbcl_token: string | null;
  order_date: string | null;
  order_type: string | null;
  retailer_name: string | null;
  retailer_code: string | null;
  vehicle_number: string | null;
  total_cases: number | null;
  total_loose_bottles: number | null;
  mger_total: string | null;
  order_total: string | null;
  source_filename: string;
  source_sha256: string;
  page_count: number;
  extraction_status: "pending" | "review_required" | "ready" | "failed";
  extraction_confidence: string | null;
  review_flags: string[];
  status: PurchaseOrderStatus;
  created_by_user_id: number;
  confirmed_by_user_id: number | null;
  cancelled_by_user_id: number | null;
  confirmed_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  created_at: string;
  updated_at: string;
  lines: PurchaseOrderLine[];
}

export interface CasePackRule {
  id: number;
  shop_id: number;
  size_ml: number;
  bottles_per_case: number;
}

export async function importPurchaseOrder(file: File, shopId?: number | null): Promise<PurchaseOrder> {
  const form = withShopIdParams(new FormData(), shopId);
  form.set("file", file);
  const headers = new Headers();
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/purchase-orders/import`, { method: "POST", headers, body: form });
  } catch (e) {
    throw new ApiError(0, "Could not reach the server.", e);
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { detail?: string | { message?: string } } | null;
    const detail = typeof body?.detail === "string" ? body.detail : body?.detail?.message ?? response.statusText;
    throw new ApiError(response.status, detail, body);
  }
  return response.json() as Promise<PurchaseOrder>;
}

export function listPurchaseOrders(shopId?: number | null): Promise<{ purchase_orders: PurchaseOrder[] }> {
  const params = withShopIdParams(new URLSearchParams(), shopId);
  return api(`/purchase-orders?${params.toString()}`);
}

export function getPurchaseOrder(id: number): Promise<PurchaseOrder> {
  return api(`/purchase-orders/${id}`);
}

export function updatePurchaseOrder(order: PurchaseOrder): Promise<PurchaseOrder> {
  return api(`/purchase-orders/${order.id}`, {
    method: "PUT",
    json: {
      osbcl_token: order.osbcl_token,
      order_date: order.order_date,
      order_type: order.order_type,
      retailer_name: order.retailer_name,
      retailer_code: order.retailer_code,
      vehicle_number: order.vehicle_number,
      total_cases: order.total_cases,
      total_loose_bottles: order.total_loose_bottles,
      mger_total: order.mger_total,
      order_total: order.order_total,
      lines: order.lines.map((line) => ({
        id: line.id,
        source_item_name: line.source_item_name,
        size_ml: line.size_ml,
        product_id: line.product_id,
        cases: line.cases,
        loose_bottles: line.loose_bottles,
        case_rate: line.case_rate,
        mger: line.mger,
        amount: line.amount,
        sequence: line.sequence,
      })),
    },
  });
}

export function confirmPurchaseOrder(id: number): Promise<PurchaseOrder> {
  return api(`/purchase-orders/${id}/confirm`, { method: "POST" });
}

export function cancelPurchaseOrder(id: number, reason: string): Promise<PurchaseOrder> {
  return api(`/purchase-orders/${id}/cancel`, { method: "POST", json: { reason } });
}

export async function downloadPurchaseOrder(id: number, filename: string): Promise<void> {
  const blob = await api<Blob>(`/purchase-orders/${id}/original`, { responseType: "blob" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function getCasePackRules(shopId?: number | null): Promise<CasePackRule[]> {
  const params = withShopIdParams(new URLSearchParams(), shopId);
  return api(`/purchase-orders/case-pack-rules?${params.toString()}`);
}

export function updateCasePackRules(rules: Array<{ size_ml: number; bottles_per_case: number }>, shopId?: number | null): Promise<CasePackRule[]> {
  return api("/purchase-orders/case-pack-rules", { method: "PUT", json: withShopId({ rules }, shopId) });
}
