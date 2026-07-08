// Thin fetch wrapper around the generated OpenAPI schema.
// Reads the base URL from VITE_API_BASE (build-time env) and injects
// the Bearer token from sessionStorage on every request.

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "http://127.0.0.1:8000";
const TOKEN_KEY = "barstock.token";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: string,
    public readonly body?: unknown
  ) {
    super(`HTTP ${status}: ${detail}`);
  }
}

export async function api<T = unknown>(
  path: string,
  init: RequestInit & { json?: unknown; idempotencyKey?: string } = {}
): Promise<T> {
  const headers = new Headers(init.headers ?? {});
  const token = sessionStorage.getItem(TOKEN_KEY);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(init.json);
  }
  if (init.idempotencyKey) headers.set("Idempotency-Key", init.idempotencyKey);

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { ...init, headers, body });
  } catch (e) {
    throw new ApiError(0, e instanceof Error ? e.message : "network error");
  }

  if (!res.ok) {
    let detail = res.statusText;
    let payload: unknown = undefined;
    try {
      payload = await res.json();
      if (payload && typeof payload === "object" && "detail" in payload) {
        const d = (payload as { detail: unknown }).detail;
        detail = typeof d === "string" ? d : JSON.stringify(d);
      }
    } catch {
      // not JSON
    }
    throw new ApiError(res.status, detail, payload);
  }

  const ct = res.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}

// Convenience helpers for the typed endpoints.
export const Api = {
  loginSuperadmin: (username: string, password: string) =>
    api<{ access_token: string; token_type: string; expires_in: number; user: unknown }>(
      "/auth/login/superadmin",
      { method: "POST", json: { username, password } }
    ),
  loginShop: (identifier: { phone: string } | { staff_id: number }, password: string) =>
    api<{ access_token: string; token_type: string; expires_in: number; user: unknown }>(
      "/auth/login",
      { method: "POST", json: { ...identifier, password } }
    ),
  // Public pre-auth staff picker (issue #24, D-v2-16). Returns
  // {id, full_name, role} for the one existing shop's active
  // shop-scoped users. No phone, no password hash — the LoginPage
  // keeps the picked row's phone in component state for the second
  // stage (PIN pad) since the picker intentionally doesn't return it.
  listShopStaff: () =>
    api<Array<{ id: number; full_name: string; role: string }>>(
      "/auth/shop-staff"
    ),
  me: () => api("/users/me"),
  logout: () => sessionStorage.clear(),
};