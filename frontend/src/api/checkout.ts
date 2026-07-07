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

// Returns the absolute URL for the PDF download — used in an <a download>
// tag, so we just compose the URL and let the browser handle auth via the
// sessionStorage token + Authorization header on fetch (browser-native
// <a href> doesn't send headers, so the cashier must be logged in via
// the SPA, and we use a fetch + blob approach below for the actual
// download to keep the Bearer token attached).
export function pdfUrl(invoiceId: number, base: string): string {
  return `${base}/invoices/${invoiceId}/pdf`;
}

export async function downloadInvoicePdf(
  invoiceId: number,
  base: string,
  token: string
): Promise<Blob> {
  const res = await fetch(`${base}/invoices/${invoiceId}/pdf`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`PDF download failed: HTTP ${res.status}`);
  return res.blob();
}