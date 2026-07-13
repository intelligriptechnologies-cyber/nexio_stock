// Client-side product catalog cache (D-30). The cashier should be able to
// scan a barcode and have it resolve without a network round trip per
// scan. On login / shift start the page calls `prefetch()` and the result
// is held in memory. A missed scan falls back to `GET /products/lookup`
// and the resolved product is added to the cache so the next scan of the
// same barcode is instant.

import { api, withShopIdParams } from "./client";

export interface CatalogProduct {
  id: number;
  barcode: string;
  brand: string;
  size_label: string;
  price: string | null; // Decimal serialised as string in JSON; null while pending
  is_active: boolean;
  // Issue #22 — provisional product lifecycle. ``pending`` products are
  // receivable into a Lot but not sellable at checkout (D-v2-6). The
  // catalog cache includes them so the receiver can scan them after
  // quick-add; the checkout UI checks ``status`` to decide whether to
  // block the line (#26).
  status: "active" | "pending";
  // Issue #40 — current derived stock at the listing shop. Same
  // computation the dashboard's low-stock list uses, so the value
  // never drifts. Optional in this interface so older callers that
  // construct CatalogProduct locally don't break; the cache and the
  // /products endpoint always populate it.
  current_stock?: number;
  can_permanently_delete?: boolean;
}

let cache: Map<string, CatalogProduct> | null = null;
let cacheShopId: number | null | undefined = undefined;
let inflight: Promise<Map<string, CatalogProduct>> | null = null;
// Parallel array of cache items kept in insertion order so quicksearch
// (issue #23, D-v2-11) can filter by brand-substring without rebuilding
// the list from the Map's iteration order on every keystroke.
let cacheItems: CatalogProduct[] | null = null;

// `shopId` is the superadmin's acting shop (ShopScopeProvider, D-66). A
// superadmin scanning during checkout/receiving is acting on one specific
// shop, so the catalog fetched here should reflect that shop rather than
// every shop superadmin can browse elsewhere (barcode is globally unique
// per D-52, so this isn't about avoiding a collision — it's the same
// one-chosen-shop model every other superadmin write already follows).
// The cache is invalidated whenever the acting shop changes.
export async function prefetchCatalog(
  shopId?: number | null
): Promise<Map<string, CatalogProduct>> {
  if (cache && cacheShopId === (shopId ?? null)) return cache;
  if (inflight && cacheShopId === (shopId ?? null)) return inflight;
  const params = withShopIdParams(new URLSearchParams({ active_only: "true", limit: "500" }), shopId);
  inflight = (async () => {
    const items = await api<CatalogProduct[]>(`/products?${params.toString()}`);
    const m = new Map<string, CatalogProduct>();
    for (const p of items) m.set(p.barcode, p);
    cache = m;
    cacheItems = items;
    cacheShopId = shopId ?? null;
    inflight = null;
    return m;
  })().catch((e) => {
    inflight = null;
    throw e;
  });
  return inflight;
}

export async function resolveBarcode(
  barcode: string,
  shopId?: number | null
): Promise<CatalogProduct> {
  if (!cache || cacheShopId !== (shopId ?? null)) await prefetchCatalog(shopId);
  const hit = cache!.get(barcode);
  if (hit) return hit;
  const params = withShopIdParams(new URLSearchParams({ barcode }), shopId);
  const fetched = await api<CatalogProduct>(`/products/lookup?${params.toString()}`);
  cache!.set(fetched.barcode, fetched);
  // Keep the parallel search array in sync so quicksearch finds a
  // cold-cache-miss product the next time the user types its name.
  cacheItems = cacheItems ?? [];
  if (!cacheItems.some((p) => p.barcode === fetched.barcode)) {
    cacheItems.push(fetched);
  }
  return fetched;
}

/**
 * Quicksearch — issue #23, D-v2-11.
 *
 * Pure client-side filter over the already-prefetched catalog cache;
 * no new backend endpoint (the catalog is already fully cached for
 * barcode resolution, and extending the in-memory structure to support
 * name substring search is a pure frontend change). Matches a product
 * if either its barcode or its brand contains the query (case-
 * insensitive). Returns at most ``limit`` results (default 20) so the
 * UI can render a small dropdown without overwhelming low-literacy
 * counter staff.
 *
 * Triggers a prefetch if the cache isn't ready yet; in that case the
 * returned list will be empty (the user retypes once the catalog
 * loads). That's intentional — quicksearch is an additive shortcut,
 * not a replacement for the scan field.
 */
export async function quickSearch(
  query: string,
  shopId?: number | null,
  limit = 20
): Promise<CatalogProduct[]> {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  if (!cache || cacheShopId !== (shopId ?? null)) {
    try {
      await prefetchCatalog(shopId);
    } catch {
      // Network blip — return empty so the UI shows "no matches" rather
      // than a crash. The user can retry the keystroke once the cache
      // loads.
      return [];
    }
  }
  if (!cacheItems) return [];
  const out: CatalogProduct[] = [];
  for (const p of cacheItems) {
    if (
      p.brand.toLowerCase().includes(q) ||
      p.barcode.toLowerCase().includes(q)
    ) {
      out.push(p);
      if (out.length >= limit) break;
    }
  }
  return out;
}

export function invalidateCache(): void {
  cache = null;
  cacheItems = null;
  cacheShopId = undefined;
  inflight = null;
}

// Test/diagnostic helper — read-only.
export function hydrateCatalog(
  items: CatalogProduct[],
  shopId?: number | null
): void {
  const m = new Map<string, CatalogProduct>();
  for (const p of items) m.set(p.barcode, p);
  cache = m;
  cacheItems = items;
  cacheShopId = shopId ?? null;
  inflight = null;
}

export function cacheSize(): number {
  return cache?.size ?? 0;
}
