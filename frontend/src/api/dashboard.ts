// Dashboard API wrappers. The backend exposes:
//
//   POST /dashboard/eod/sign-off         sign off the current business day
//   GET  /dashboard/eod-totals           KPIs for a business date
//   GET  /dashboard/eod-history          past sign-offs
//   GET  /dashboard/void-queue           pending voids (also in api/voids)
//   GET  /dashboard/low-stock            products at/below threshold
//
// No hourly-sales endpoint exists on the backend yet (R-44 doesn't
// require it; the EOD totals aggregate revenue + payment-mode split).
// The frontend renders KPI cards + low-stock + EOD sign-off + history;
// the hourly chart is intentionally omitted until the backend adds one.

import { api } from "./client";

export interface PaymentModeTotal {
  mode: string;
  amount: string;
  count: number;
}

export interface EodTotalsResponse {
  business_date: string;
  signed_off: boolean;
  invoice_count: number;
  revenue: string;
  voided_count: number;
  reversal_count: number;
  payments_by_mode: PaymentModeTotal[];
}

export interface SignOffResponse {
  business_date: string;
  signed_off_at: string;
  signed_off_by_user_id: number;
  invoices_signed_off: number;
}

export interface SignOffHistoryResponse {
  signoffs: SignOffResponse[];
}

export interface LowStockItem {
  product_id: number;
  barcode: string;
  brand: string;
  size_label: string;
  current_stock: number;
  effective_threshold: number;
}

export interface LowStockResponse {
  items: LowStockItem[];
  evaluated_at: string;
}

function shopQuery(shopId?: number | null): string {
  return shopId != null ? `shop_id=${shopId}` : "";
}

export function getEodTotals(
  businessDate?: string,
  shopId?: number | null
): Promise<EodTotalsResponse> {
  const parts = [
    businessDate ? `business_date=${encodeURIComponent(businessDate)}` : "",
    shopQuery(shopId),
  ].filter(Boolean);
  return api<EodTotalsResponse>(`/dashboard/eod-totals${parts.length ? `?${parts.join("&")}` : ""}`);
}

export function signOffEod(
  businessDate?: string,
  shopId?: number | null
): Promise<SignOffResponse> {
  const body: Record<string, unknown> = businessDate ? { business_date: businessDate } : {};
  if (shopId != null) body.shop_id = shopId;
  return api<SignOffResponse>("/dashboard/eod/sign-off", {
    method: "POST",
    json: body,
  });
}

export function getEodHistory(limit = 30, shopId?: number | null): Promise<SignOffHistoryResponse> {
  const parts = [`limit=${limit}`, shopQuery(shopId)].filter(Boolean);
  return api<SignOffHistoryResponse>(`/dashboard/eod-history?${parts.join("&")}`);
}

export function getLowStock(limit = 50, shopId?: number | null): Promise<LowStockResponse> {
  const parts = [`limit=${limit}`, shopQuery(shopId)].filter(Boolean);
  return api<LowStockResponse>(`/dashboard/low-stock?${parts.join("&")}`);
}