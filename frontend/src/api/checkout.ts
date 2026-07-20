// Checkout API helpers — kept thin so the cart state and the wire format
// stay separate. The page component owns the cart; these helpers just hit
// the backend.

import { api, withShopId } from "./client";

export type PaymentMode = "cash" | "upi" | "card" | "other";

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
  cashier_name: string | null;
  invoice_number: number;
  status: "finalized" | "voided" | "reversal" | "pending_void";
  total_amount: string;
  note: string | null;
  finalized_at: string;
  business_date: string;
  eod_signed_off: boolean;
  lines: InvoiceLinePublic[];
  payments: PaymentPublic[];
}

export interface CheckoutFinalizeResponse {
  invoice: InvoicePublic;
  is_replay: boolean;
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

export interface CartValidationLine {
  barcode: string;
  requested_quantity: number;
  available_quantity: number;
  accepted_quantity: number;
  adjusted: boolean;
}

export function validateCheckoutCart(
  lines: CheckoutLine[],
  shopId?: number | null
): Promise<{ lines: CartValidationLine[] }> {
  return api<{ lines: CartValidationLine[] }>("/checkout/validate", {
    method: "POST",
    json: withShopId({ lines }, shopId),
  });
}

export function listInvoices(opts: {
  source: "current" | "past";
  shopId?: number | null;
  dateFrom?: string;
  dateTo?: string;
  cashier?: number;
  paymentMode?: PaymentMode;
  status?: InvoicePublic["status"];
}): Promise<{ invoices: InvoicePublic[] }> {
  const params = new URLSearchParams();
  params.set("source", opts.source);
  if (opts.dateFrom) params.set("date_from", opts.dateFrom);
  if (opts.dateTo) params.set("date_to", opts.dateTo);
  if (opts.cashier) params.set("cashier", String(opts.cashier));
  if (opts.paymentMode) params.set("payment_mode", opts.paymentMode);
  if (opts.status) params.set("status", opts.status);
  if (opts.shopId != null) params.set("shop_id", String(opts.shopId));
  return api<{ invoices: InvoicePublic[] }>(`/invoices?${params.toString()}`);
}

export function editInvoice(
  invoiceId: number,
  payload: { lines: CheckoutLine[]; payments: PaymentInput[]; note?: string }
): Promise<InvoicePublic> {
  return api<InvoicePublic>(`/invoices/${invoiceId}`, { method: "PATCH", json: payload });
}

// Browser-native <a href> doesn't send headers, so a plain link can't
// carry the Bearer token — we fetch the PDF as a blob (via `api()`, so
// auth-header injection and error-detail parsing come for free) and
// hand the caller an object URL to trigger the download with.
export async function downloadInvoicePdf(invoiceId: number): Promise<Blob> {
  return api<Blob>(`/invoices/${invoiceId}/pdf`, { responseType: "blob" });
}
