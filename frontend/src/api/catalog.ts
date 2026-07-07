// Client-side product catalog cache (D-30). The cashier should be able to
// scan a barcode and have it resolve without a network round trip per
// scan. On login / shift start the page calls `prefetch()` and the result
// is held in memory. A missed scan falls back to `GET /products/lookup`
// and the resolved product is added to the cache so the next scan of the
// same barcode is instant.

import { api } from "./client";

export interface CatalogProduct {
  id: number;
  barcode: string;
  brand: string;
  size_label: string;
  price: string; // Decimal serialised as string in JSON
  is_active: boolean;
}

let cache: Map<string, CatalogProduct> | null = null;
let inflight: Promise<Map<string, CatalogProduct>> | null = null;

export async function prefetchCatalog(): Promise<Map<string, CatalogProduct>> {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    const items = await api<CatalogProduct[]>("/products?active_only=true&limit=500");
    const m = new Map<string, CatalogProduct>();
    for (const p of items) m.set(p.barcode, p);
    cache = m;
    inflight = null;
    return m;
  })().catch((e) => {
    inflight = null;
    throw e;
  });
  return inflight;
}

export async function resolveBarcode(barcode: string): Promise<CatalogProduct> {
  if (!cache) await prefetchCatalog();
  const hit = cache!.get(barcode);
  if (hit) return hit;
  const fetched = await api<CatalogProduct>(
    `/products/lookup?barcode=${encodeURIComponent(barcode)}`
  );
  cache!.set(fetched.barcode, fetched);
  return fetched;
}

export function invalidateCache(): void {
  cache = null;
  inflight = null;
}

// Test/diagnostic helper — read-only.
export function cacheSize(): number {
  return cache?.size ?? 0;
}