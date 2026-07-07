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