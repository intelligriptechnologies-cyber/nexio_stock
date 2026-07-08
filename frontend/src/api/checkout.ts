// Checkout API helpers — kept thin so the cart state and the wire format
// stay separate. The page component owns the cart; these helpers just hit
// the backend.

import { api } from "./client";

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
  is_replay: boolean;
}

export function finalizeCheckout(
  payload: { lines: CheckoutLine[]; payments: PaymentInput[]; note?: string },
  idempotencyKey: string,
  shopId?: number | null
): Promise<CheckoutFinalizeResponse> {
  const json = shopId != null ? { ...payload, shop_id: shopId } : payload;
  return api<CheckoutFinalizeResponse>("/checkout/finalize", {
    method: "POST",
    json,
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