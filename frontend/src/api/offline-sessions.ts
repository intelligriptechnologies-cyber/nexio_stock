import { api, withShopId } from "./client";
import type { CatalogProduct } from "./catalog";
import type { CheckoutLine, PaymentInput } from "./checkout";

export type OfflineSessionState =
  | "preparing"
  | "active"
  | "syncing"
  | "synced"
  | "failed"
  | "discarded"
  | "expired";

export interface OfflineSessionPublic {
  id: number;
  shop_id: number;
  cashier_user_id: number;
  state: OfflineSessionState;
  baseline_business_date: string;
  server_last_invoice_number: number;
  receipt_counter: number;
  receipt_count: number;
  gross_total: string;
  expires_at: string;
  max_expires_at: string;
  extension_count: number;
  sync_attempts: number;
  sync_result: unknown | null;
  failure_reason: { code?: string; message?: string } | null;
  discard_reason: string | null;
  started_at: string;
  state_changed_at: string;
  synced_at: string | null;
  discarded_at: string | null;
  expired_at: string | null;
}

export interface OfflineCatalogItem {
  id: number;
  barcode: string;
  brand: string;
  size_label: string;
  price: string;
  current_stock: number;
}

export interface OfflineSessionStartResponse {
  session: OfflineSessionPublic;
  offline_token: string;
  catalog: OfflineCatalogItem[];
}

export interface OfflineSessionExtendResponse {
  session: OfflineSessionPublic;
  offline_token: string;
}

export interface OfflineReceiptPayload {
  temp_receipt_id: string;
  idempotency_key: string;
  lines: CheckoutLine[];
  payments: PaymentInput[];
  note?: string;
  created_at: string;
}

export interface OfflineSessionSyncResponse {
  session: OfflineSessionPublic;
  mappings: Array<{
    temp_receipt_id: string;
    invoice_id: number;
    invoice_number: number;
  }>;
  is_replay: boolean;
}

export function startOfflineSession(shopId?: number | null): Promise<OfflineSessionStartResponse> {
  return api<OfflineSessionStartResponse>("/offline-sessions/start", {
    method: "POST",
    json: withShopId({}, shopId),
  });
}

export function extendOfflineSession(sessionId: number): Promise<OfflineSessionExtendResponse> {
  return api<OfflineSessionExtendResponse>(`/offline-sessions/${sessionId}/extend`, {
    method: "POST",
  });
}

export function syncOfflineSession(
  sessionId: number,
  receipts: OfflineReceiptPayload[],
  offlineToken?: string
): Promise<OfflineSessionSyncResponse> {
  const headers = offlineToken ? { Authorization: `Bearer ${offlineToken}` } : undefined;
  return api<OfflineSessionSyncResponse>(`/offline-sessions/${sessionId}/sync`, {
    method: "POST",
    headers,
    json: { receipts },
  });
}

export function offlineItemToCatalogProduct(item: OfflineCatalogItem): CatalogProduct {
  return {
    id: item.id,
    barcode: item.barcode,
    brand: item.brand,
    size_label: item.size_label,
    price: item.price,
    is_active: true,
    status: "active",
    current_stock: item.current_stock,
  };
}
