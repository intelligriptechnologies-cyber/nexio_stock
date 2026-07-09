import { api, withShopIdParams } from "./client";

export type LogType = "invoicing" | "stockin" | "admin";
export type LogExportFormat = "json" | "csv" | "txt";

export interface BusinessLogRow {
  id: number;
  created_at: string;
  shop_id: number | null;
  shop_name: string | null;
  actor_user_id: number | null;
  actor_name: string | null;
  event_type: string;
  payload: Record<string, unknown>;
}

export function listLogs(type: LogType, shopId?: number | null): Promise<{ logs: BusinessLogRow[] }> {
  const params = withShopIdParams(new URLSearchParams(), shopId);
  return api<{ logs: BusinessLogRow[] }>(`/logs/${type}?${params.toString()}`);
}

export function exportLogs(type: LogType, format: LogExportFormat, shopId?: number | null): Promise<Blob> {
  const params = withShopIdParams(new URLSearchParams(), shopId);
  params.set("format", format);
  return api<Blob>(`/logs/${type}/export?${params.toString()}`, { responseType: "blob" });
}
