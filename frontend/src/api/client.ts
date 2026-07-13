// Thin fetch wrapper around the generated OpenAPI schema.
// Reads the base URL from VITE_API_BASE (build-time env) and injects
// the Bearer token from sessionStorage on every request.

export const API_BASE =
  (import.meta.env.VITE_API_BASE as string | undefined) ?? "http://127.0.0.1:8000";
const TOKEN_KEY = "barstock.token";
const DEVICE_KEY = "barstock.deviceKey";

// The one place that reads/writes the session token (issue #29). Every
// other module -- AuthProvider's login/logout, and the two call sites
// that bypass `api()` for multipart upload / blob download -- goes
// through these instead of hardcoding the storage key.
export function getToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  sessionStorage.removeItem(TOKEN_KEY);
}

export function getOrCreateDeviceKey(): string {
  const stored = localStorage.getItem(DEVICE_KEY);
  if (stored) return stored;
  const generated =
    globalThis.crypto && "randomUUID" in globalThis.crypto
      ? globalThis.crypto.randomUUID()
      : `device-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  localStorage.setItem(DEVICE_KEY, generated);
  return generated;
}

export function setDeviceKey(deviceKey: string): void {
  localStorage.setItem(DEVICE_KEY, deviceKey);
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: string,
    public readonly body?: unknown
  ) {
    super(`HTTP ${status}: ${detail}`);
  }
}

// Every catch block that surfaces an error to the user re-derived this
// same instanceof chain (ApiError -> its .detail, plain Error -> its
// .message, anything else -> a caller-supplied fallback). One helper so
// pages don't each re-decide the precedence (issue #35).
export function toUserMessage(e: unknown, fallback: string): string {
  if (e instanceof ApiError) return e.detail;
  if (e instanceof Error) return e.message;
  return fallback;
}

// `shopId` (the superadmin's acting shop, D-66) gets merged onto a
// request body or query params the same way at every write call site:
// present it as `shop_id` when set, omit it otherwise. One helper for
// each shape so `api/*.ts` modules don't each re-derive the merge
// (issue #35).
export function withShopId<T extends object>(
  payload: T,
  shopId?: number | null
): T & { shop_id?: number } {
  return shopId != null ? { ...payload, shop_id: shopId } : payload;
}

// URLSearchParams and FormData both expose `set(name, value)`, so one
// helper covers query-string and multipart call sites alike.
export function withShopIdParams<T extends { set(name: string, value: string): void }>(
  params: T,
  shopId?: number | null
): T {
  if (shopId != null) params.set("shop_id", String(shopId));
  return params;
}

export async function api<T = unknown>(
  path: string,
  init: RequestInit & {
    json?: unknown;
    idempotencyKey?: string;
    responseType?: "json" | "text" | "blob";
  } = {}
): Promise<T> {
  const headers = new Headers(init.headers ?? {});
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("Content-Type", "application/json");
    body = JSON.stringify(init.json);
  }
  if (init.idempotencyKey) headers.set("Idempotency-Key", init.idempotencyKey);

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { ...init, headers, body });
  } catch (e) {
    throw new ApiError(
      0,
      "Could not reach the server. Check that the backend is running, then refresh.",
      e instanceof Error ? e.message : e
    );
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

  if (init.responseType === "blob") return (await res.blob()) as unknown as T;
  if (init.responseType === "text") return (await res.text()) as unknown as T;
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
  loginShop: (payload: {
    role: "owner" | "receiver_user" | "cashier_user";
    username: string;
    password: string;
    device_key: string;
  }) =>
    api<{ access_token: string; token_type: string; expires_in: number; user: unknown }>(
      "/auth/login",
      { method: "POST", json: payload }
    ),
  getDeviceContext: (deviceKey: string) =>
    api<{
      device_key: string;
      is_registered: boolean;
      can_login: boolean;
      shop_id: number | null;
      shop_name: string | null;
      shop_code: string | null;
      counter_name: string | null;
      message: string;
    }>(`/auth/device-context?device_key=${encodeURIComponent(deviceKey)}`),
  // Public pre-auth staff picker (legacy compatibility for older tests).
  listShopStaff: () =>
    api<Array<{ id: number; full_name: string; role: string }>>("/auth/shop-staff"),
  me: () => api("/users/me"),
  logout: () => sessionStorage.clear(),
};
