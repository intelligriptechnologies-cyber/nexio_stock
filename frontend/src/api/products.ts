import { api } from "./client";
import type { CatalogProduct } from "./catalog";

// Re-export the catalog type under the products module name for cleaner
// page imports. (CatalogProduct is the shape returned by /products when
// active_only=true; full ProductPublic adds fields the catalog cache
// doesn't need.)
export type Product = CatalogProduct;

export interface ProductCreatePayload {
  barcode: string;
  brand: string;
  size_label: string;
  price: string;
  low_stock_threshold?: number | null;
}

export interface ProductQuickAddPayload {
  barcode: string;
  brand: string;
  size_label: string;
}

export interface PendingProductRow {
  id: number;
  barcode: string;
  brand: string;
  size_label: string;
  created_at: string;
  updated_at: string;
  last_event_origin: "receiving" | "checkout" | null;
  last_event_actor_id: number | null;
  last_event_actor_name: string | null;
}

export interface ProductActivatePayload {
  price: string;
  low_stock_threshold?: number | null;
}

export interface ProductUpdatePayload {
  brand?: string;
  size_label?: string;
  price?: string;
  low_stock_threshold?: number | null;
  is_active?: boolean;
}

export interface ProductImportError {
  row: number;
  barcode: string | null;
  error: string;
}

export interface ProductImportResponse {
  created: number;
  failed: number;
  errors: ProductImportError[];
}

export function listProducts(opts?: { q?: string; includeInactive?: boolean }): Promise<Product[]> {
  const params = new URLSearchParams();
  if (opts?.includeInactive) params.set("active_only", "false");
  if (opts?.q) params.set("q", opts.q);
  params.set("limit", "500");
  return api<Product[]>(`/products?${params.toString()}`);
}

export function createProduct(
  payload: ProductCreatePayload,
  shopId?: number | null
): Promise<Product> {
  const json = shopId != null ? { ...payload, shop_id: shopId } : payload;
  return api<Product>("/products", { method: "POST", json });
}

/**
 * Provisional product quick-add (issue #22). Captures brand + size only;
 * the resulting product is ``status='pending'`` and must be completed by
 * the owner (Pending Products screen, #25) before it can be sold.
 *
 * Sends an ``Idempotency-Key`` header so a double-tap on "Add" is a
 * no-op rather than a duplicate-error (D-v2-12). The receiving screen
 * always passes ``X-Quick-Add-Origin: receiving`` so the audit-log entry
 * lands on ``stockin_logs`` (#26 sets the checkout variant).
 */
export function quickAddProduct(
  payload: ProductQuickAddPayload,
  opts: { idempotencyKey: string; origin: "receiving" | "checkout" }
): Promise<Product> {
  return api<Product>("/products/quick-add", {
    method: "POST",
    json: payload,
    headers: {
      "Idempotency-Key": opts.idempotencyKey,
      "X-Quick-Add-Origin": opts.origin,
    },
  });
}

// Issue #25 — Pending Products list + activation. The list IS the
// notification surface (D-v2-8); completing a product is the dismissal.
// Activation sets a price and flips status to 'active'; the row drops
// off the pending list automatically.
export function listPendingProducts(shopId?: number | null): Promise<PendingProductRow[]> {
  const params = new URLSearchParams();
  if (shopId != null) params.set("shop_id", String(shopId));
  const qs = params.toString();
  return api<PendingProductRow[]>(`/products/pending${qs ? "?" + qs : ""}`);
}

export function activateProduct(
  id: number,
  payload: ProductActivatePayload
): Promise<Product> {
  return api<Product>(`/products/${id}/activate`, { method: "POST", json: payload });
}

export function updateProduct(id: number, payload: ProductUpdatePayload): Promise<Product> {
  return api<Product>(`/products/${id}`, { method: "PATCH", json: payload });
}

export async function importProductsCsv(
  file: File,
  shopId?: number | null
): Promise<ProductImportResponse> {
  const fd = new FormData();
  fd.append("file", file);
  if (shopId != null) fd.append("shop_id", String(shopId));
  const res = await fetch(
    `${(import.meta.env.VITE_API_BASE as string | undefined) ?? ""}/products/import-csv`,
    {
      method: "POST",
      body: fd,
      headers: {
        // No Content-Type — the browser sets the multipart boundary.
        Authorization: `Bearer ${sessionStorage.getItem("barstock.token") ?? ""}`,
      },
    }
  );
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const j = (await res.json()) as { detail?: unknown };
      if (typeof j.detail === "string") detail = j.detail;
    } catch {
      /* noop */
    }
    throw new Error(`HTTP ${res.status}: ${detail}`);
  }
  return (await res.json()) as ProductImportResponse;
}