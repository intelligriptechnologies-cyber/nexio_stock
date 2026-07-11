import { api, withShopIdParams } from "./client";

export type LogType = "checkout" | "receiving" | "closing" | "exceptions";

export interface LogFileRow {
  filename: string;
  relative_path: string;
  size_bytes: number;
  modified_at: string;
  file_date: string;
  age_days: number;
  expires_in_days: number;
}

export interface LogFileListResponse {
  log_type: LogType;
  retention_days: number;
  files: LogFileRow[];
}

export function listLogFiles(type: LogType, shopId?: number | null): Promise<LogFileListResponse> {
  const params = withShopIdParams(new URLSearchParams(), shopId);
  const query = params.toString();
  return api<LogFileListResponse>(`/logs/files/${type}${query ? `?${query}` : ""}`);
}

export function updateLogRetention(
  type: LogType,
  retentionDays: number,
  shopId?: number | null
): Promise<{ log_type: LogType; retention_days: number }> {
  const params = withShopIdParams(new URLSearchParams(), shopId);
  const query = params.toString();
  return api<{ log_type: LogType; retention_days: number }>(
    `/logs/files/${type}/retention${query ? `?${query}` : ""}`,
    { method: "PATCH", json: { retention_days: retentionDays } }
  );
}

export function downloadLogFile(type: LogType, filename: string, shopId?: number | null): Promise<Blob> {
  const params = withShopIdParams(new URLSearchParams(), shopId);
  const query = params.toString();
  return api<Blob>(
    `/logs/files/${type}/${encodeURIComponent(filename)}/download${query ? `?${query}` : ""}`,
    { responseType: "blob" }
  );
}
