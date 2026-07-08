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
//
// `getEodTotals`/`signOffEod` explicitly pass `today` (YYYY-MM-DD in the
// shop's local zone, IST for v1) so the EOD panel never relies on the
// backend's `business_date` default — see issue #37. The server-side
// default exists as a belt-and-braces fallback, not as something this
// client depends on.

import { api, withShopId, withShopIdParams } from "./client";

function todayLocalDateString(): string {
  // Local "today" matches the server's `today_local_date()` convention
  // (system-local timezone, IST for v1). Using UTC here would silently
  // shift the business date around the IST-morning window.
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

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

// --- Issue #41: cross-shop stock overview (R-v3-5, D-v3-5) ---

export interface StockOverviewRow {
  product_id: number;
  barcode: string;
  brand: string;
  size_label: string;
  current_stock: number;
  is_active: boolean;
}

export interface StockOverviewShopGroup {
  shop_id: number;
  shop_name: string;
  items: StockOverviewRow[];
}

export interface StockOverviewResponse {
  shops: StockOverviewShopGroup[];
  evaluated_at: string;
}

export function getEodTotals(
  businessDate?: string,
  shopId?: number | null
): Promise<EodTotalsResponse> {
  const params = withShopIdParams(new URLSearchParams(), shopId);
  // Issue #37: explicitly pass today's local date instead of relying on
  // the server's default. The server-side default stays as a safety net,
  // but the dashboard's "Mark day end" button must reflect the exact
  // day the user sees on screen, with no implicit-resolution risk.
  params.set("business_date", businessDate ?? todayLocalDateString());
  const qs = params.toString();
  return api<EodTotalsResponse>(`/dashboard/eod-totals${qs ? `?${qs}` : ""}`);
}

export function signOffEod(
  businessDate?: string,
  shopId?: number | null
): Promise<SignOffResponse> {
  // Issue #37: explicit "today" rather than relying on the body being
  // empty — keeps client and server in lockstep on what date gets
  // locked.
  const body = { business_date: businessDate ?? todayLocalDateString() };
  return api<SignOffResponse>("/dashboard/eod/sign-off", {
    method: "POST",
    json: withShopId(body, shopId),
  });
}

export function getEodHistory(limit = 30, shopId?: number | null): Promise<SignOffHistoryResponse> {
  const params = withShopIdParams(new URLSearchParams({ limit: String(limit) }), shopId);
  return api<SignOffHistoryResponse>(`/dashboard/eod-history?${params.toString()}`);
}

export function getLowStock(limit = 50, shopId?: number | null): Promise<LowStockResponse> {
  const params = withShopIdParams(new URLSearchParams({ limit: String(limit) }), shopId);
  return api<LowStockResponse>(`/dashboard/low-stock?${params.toString()}`);
}

// Issue #41 — cross-shop stock overview. Distinct from getLowStock:
// this one is owner/superadmin-only and returns stock per product
// grouped by shop across every shop the caller is authorized to see.
// No query params; the backend scopes by the caller's role.
export function getStockOverview(): Promise<StockOverviewResponse> {
  return api<StockOverviewResponse>("/dashboard/stock-overview");
}