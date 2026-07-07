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

export function getEodTotals(businessDate?: string): Promise<EodTotalsResponse> {
  const q = businessDate ? `?business_date=${encodeURIComponent(businessDate)}` : "";
  return api<EodTotalsResponse>(`/dashboard/eod-totals${q}`);
}

export function signOffEod(businessDate?: string): Promise<SignOffResponse> {
  return api<SignOffResponse>("/dashboard/eod/sign-off", {
    method: "POST",
    json: businessDate ? { business_date: businessDate } : {},
  });
}

export function getEodHistory(limit = 30): Promise<SignOffHistoryResponse> {
  return api<SignOffHistoryResponse>(`/dashboard/eod-history?limit=${limit}`);
}

export function getLowStock(limit = 50): Promise<LowStockResponse> {
  return api<LowStockResponse>(`/dashboard/low-stock?limit=${limit}`);
}