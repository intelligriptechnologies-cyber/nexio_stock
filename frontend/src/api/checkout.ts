// Checkout API helpers — kept thin so the cart state and the wire format
// stay separate. The page component owns the cart; these helpers just hit
// the backend.

import { api, withShopId, withShopIdParams } from "./client";

export type PaymentMode = "cash" | "upi" | "card" | "credit";

export interface CheckoutLine {
  barcode: string;
  quantity: number;
}

export interface PaymentInput {
  mode: PaymentMode;
  amount: string;
}

export interface InvoiceLinePublic {
  id: number;
  product_id: number;
  quantity: number;
  unit_price: string;
  line_total: string;
  // Issue #38 — snapshot of the product's brand + size, captured at
  // sale time. Always present on the wire (the API falls back to a
  // live Product join for pre-migration rows).
  product_brand: string;
  product_size_label: string;
}

export interface PaymentPublic {
  id: number;
  mode: PaymentMode;
  amount: string;
}

export interface InvoicePublic {
  id: number;
  shop_id: number;
  cashier_user_id: number;
  invoice_number: number;
  status: "open" | "finalized" | "voided" | "reversed";
  total_amount: string;
  note: string | null;
  finalized_at: string;
  eod_signed_off: boolean;
  lines: InvoiceLinePublic[];
  payments: PaymentPublic[];
}

export interface CheckoutFinalizeResponse {
  invoice: InvoicePublic;
  is_replay: boolean; // True when an existing Idempotency-Key was matched
}

// --- Issue #44: invoices grid (R-v3-9, R-v3-15) ---

export interface InvoiceListRow {
  id: number;
  invoice_number: number;
  shop_id: number;
  cashier_user_id: number;
  cashier_name: string;
  status: "finalized" | "voided" | "reversal" | "pending_void";
  total_amount: string;
  finalized_at: string;
  eod_signed_off: boolean;
}

export interface InvoiceListResponse {
  invoices: InvoiceListRow[];
  total: number;
  page: number;
  limit: number;
}

export interface InvoiceListFilters {
  page?: number;
  limit?: number;
  from_date?: string;
  to_date?: string;
  payment_mode?: "cash" | "upi" | "card";
  signed_off?: boolean;
  cashier_user_id?: number;
}

export function listInvoices(
  filters: InvoiceListFilters = {},
  shopId?: number | null
): Promise<InvoiceListResponse> {
  const params = withShopIdParams(new URLSearchParams(), shopId);
  if (filters.page) params.set("page", String(filters.page));
  if (filters.limit) params.set("limit", String(filters.limit));
  if (filters.from_date) params.set("from_date", filters.from_date);
  if (filters.to_date) params.set("to_date", filters.to_date);
  if (filters.payment_mode) params.set("payment_mode", filters.payment_mode);
  if (filters.signed_off !== undefined)
    params.set("signed_off", String(filters.signed_off));
  if (filters.cashier_user_id)
    params.set("cashier_user_id", String(filters.cashier_user_id));
  const qs = params.toString();
  return api<InvoiceListResponse>(`/invoices${qs ? `?${qs}` : ""}`);
}

export function finalizeCheckout(
  payload: { lines: CheckoutLine[]; payments: PaymentInput[]; note?: string },
  idempotencyKey: string,
  shopId?: number | null
): Promise<CheckoutFinalizeResponse> {
  return api<CheckoutFinalizeResponse>("/checkout/finalize", {
    method: "POST",
    json: withShopId(payload, shopId),
    idempotencyKey,
  });
}

export function getInvoice(invoiceId: number): Promise<InvoicePublic> {
  return api<InvoicePublic>(`/invoices/${invoiceId}`);
}

// Browser-native <a href> doesn't send headers, so a plain link can't
// carry the Bearer token — we fetch the PDF as a blob (via `api()`, so
// auth-header injection and error-detail parsing come for free) and
// hand the caller an object URL to trigger the download with.
export async function downloadInvoicePdf(invoiceId: number): Promise<Blob> {
  return api<Blob>(`/invoices/${invoiceId}/pdf`, { responseType: "blob" });
}