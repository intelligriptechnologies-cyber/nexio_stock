import { API_BASE, ApiError, getToken } from "../api/client";

export type CsvValue = string | number | boolean | null | undefined;
export type CsvRow = Record<string, CsvValue>;

function escapeCsvCell(value: CsvValue): string {
  const text = value == null ? "" : String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }
  return text;
}

export function rowsToCsv(rows: CsvRow[], columns?: string[]): string {
  const headers = columns ?? Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const body = rows.map((row) => headers.map((header) => escapeCsvCell(row[header])).join(","));
  return [headers.map((header) => escapeCsvCell(header)).join(","), ...body].join("\r\n");
}

export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadCsv(rows: CsvRow[], filename: string, columns?: string[]): void {
  const csv = rowsToCsv(rows, columns);
  triggerDownload(new Blob([csv], { type: "text/csv;charset=utf-8" }), filename);
}

export function csvTimestamp(date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}-${hh}${min}`;
}

export function parseContentDispositionFilename(value: string | null): string | null {
  if (!value) return null;
  const utf8 = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8) return decodeURIComponent(utf8[1]);
  const plain = value.match(/filename="([^"]+)"/i) ?? value.match(/filename=([^;]+)/i);
  return plain ? plain[1].trim() : null;
}

export async function downloadAuthedFile(
  path: string,
  init: RequestInit = {}
): Promise<{ blob: Blob; filename: string | null }> {
  const headers = new Headers(init.headers ?? {});
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  } catch (error) {
    throw new ApiError(
      0,
      "Could not reach the server. Check that the backend is running, then refresh.",
      error instanceof Error ? error.message : error
    );
  }

  if (!response.ok) {
    let detail = response.statusText;
    let payload: unknown;
    try {
      payload = await response.json();
      if (payload && typeof payload === "object" && "detail" in payload) {
        const d = (payload as { detail: unknown }).detail;
        detail = typeof d === "string" ? d : JSON.stringify(d);
      }
    } catch {
      payload = undefined;
    }
    throw new ApiError(response.status, detail, payload);
  }

  return {
    blob: await response.blob(),
    filename: parseContentDispositionFilename(response.headers.get("content-disposition")),
  };
}
