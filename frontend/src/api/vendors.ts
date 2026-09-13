import { api, apiPage, withShopId, withShopIdParams } from "./client";
import { downloadAuthedFile } from "../utils/csv";

export interface VendorPublic {
  id: number;
  shop_id: number;
  name: string;
  gstin: string | null;
  address: string | null;
  email: string | null;
  phone: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface VendorCreatePayload {
  name: string;
  gstin?: string | null;
  address?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface VendorUpdatePayload {
  name?: string | null;
  gstin?: string | null;
  address?: string | null;
  email?: string | null;
  phone?: string | null;
  is_active?: boolean;
}

export async function listVendors(shopId?: number | null, includeInactive = false): Promise<VendorPublic[]> {
  const params = withShopIdParams(new URLSearchParams(), shopId);
  if (includeInactive) params.set("include_inactive", "true");
  params.set("limit", "100");
  params.set("offset", "0");
  const first = await apiPage<VendorPublic[]>(`/vendors?${params.toString()}`);
  const rows = [...first.data];
  while (rows.length < first.total) {
    params.set("offset", String(rows.length));
    const page = await apiPage<VendorPublic[]>(`/vendors?${params.toString()}`);
    if (page.data.length === 0) break;
    rows.push(...page.data);
  }
  return rows;
}

export function listVendorsPage(opts: {
  shopId?: number | null; includeInactive?: boolean; q?: string;
  limit: number; offset: number; signal?: AbortSignal;
}): Promise<{ data: VendorPublic[]; total: number }> {
  const params = withShopIdParams(new URLSearchParams({
    include_inactive: String(Boolean(opts.includeInactive)), limit: String(opts.limit), offset: String(opts.offset),
  }), opts.shopId);
  if (opts.q) params.set("q", opts.q);
  return apiPage<VendorPublic[]>(`/vendors?${params.toString()}`, { signal: opts.signal });
}

export function downloadVendorsExport(shopId?: number | null, includeInactive = false, q?: string) {
  const params = withShopIdParams(new URLSearchParams({ include_inactive: String(includeInactive) }), shopId);
  if (q) params.set("q", q);
  return downloadAuthedFile(`/vendors/export?${params.toString()}`);
}

export function createVendor(
  payload: VendorCreatePayload,
  shopId?: number | null
): Promise<VendorPublic> {
  return api<VendorPublic>("/vendors", { method: "POST", json: withShopId(payload, shopId) });
}

export function updateVendor(
  vendorId: number,
  payload: VendorUpdatePayload,
  shopId?: number | null
): Promise<VendorPublic> {
  return api<VendorPublic>(`/vendors/${vendorId}`, {
    method: "PATCH",
    json: withShopId(payload, shopId),
  });
}
