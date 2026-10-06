import { API_BASE, ApiError, api, getToken, withShopId, withShopIdParams } from "./client";

export type PurchaseOrderStatus = "draft" | "open" | "partially_received" | "fulfilled" | "closed_short" | "cancelled";

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
  unit_cost: string | null;
  sequence: number;
  ocr_confidence: string | null;
  field_confidence: Record<string, number>;
  match_candidates: Array<{ product_id: number; brand: string; size_label: string; score: number }>;
  delivered_bottles: number | null;
  accepted_bottles: number | null;
  broken_bottles: number | null;
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
  vendor_id: number | null;
  purchase_date: string | null;
  vendor_invoice_number: string | null;
  invoice_value: string | null;
  wastage_reason: string | null;
  wastage_attested: boolean;
  wastage_attested_by_user_id: number | null;
  wastage_attested_at: string | null;
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
  receipt_stock_inward_id: number | null;
  receipt_lot_id: number | null;
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

export interface PurchaseOrderReceiptApprovalPayload {
  vendor_id?: number | null;
  purchase_date?: string | null;
  vendor_invoice_number?: string | null;
  invoice_value?: string | null;
  reference?: string | null;
  notes?: string | null;
  over_receipt_reason?: string | null;
  lines: Array<{
    purchase_order_line_id: number;
    product_id: number;
    quantity: number;
    good_condition_quantity: number;
    unit_cost?: string | null;
  }>;
}

export interface PurchaseOrderReceiptApprovalResponse {
  purchase_order: PurchaseOrder;
  stock_inward_id: number;
  lot_id: number;
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
      vendor_id: order.vendor_id,
      purchase_date: order.purchase_date,
      vendor_invoice_number: order.vendor_invoice_number,
      invoice_value: order.invoice_value,
      wastage_reason: order.wastage_reason,
      wastage_attested: order.wastage_attested,
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
        delivered_bottles: line.delivered_bottles,
        accepted_bottles: line.accepted_bottles,
        unit_cost: line.unit_cost,
        sequence: line.sequence,
      })),
    },
  });
}

export function confirmPurchaseOrder(id: number): Promise<PurchaseOrder> {
  return api(`/purchase-orders/${id}/confirm`, { method: "POST" });
}

export function finalizePurchaseOrder(id: number): Promise<PurchaseOrderReceiptApprovalResponse> {
  return api(`/purchase-orders/${id}/finalize`, { method: "POST" });
}

export function cancelPurchaseOrder(id: number, reason: string): Promise<PurchaseOrder> {
  return api(`/purchase-orders/${id}/cancel`, { method: "POST", json: { reason } });
}

export function approvePurchaseOrderReceipt(id: number, payload: PurchaseOrderReceiptApprovalPayload): Promise<PurchaseOrderReceiptApprovalResponse> {
  return api(`/purchase-orders/${id}/approve-receipt`, { method: "POST", json: payload });
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
