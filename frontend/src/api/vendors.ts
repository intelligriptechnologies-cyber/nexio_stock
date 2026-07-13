import { api, withShopId, withShopIdParams } from "./client";

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

export function listVendors(shopId?: number | null, includeInactive = false): Promise<VendorPublic[]> {
  const params = withShopIdParams(new URLSearchParams(), shopId);
  if (includeInactive) params.set("include_inactive", "true");
  const qs = params.toString();
  return api<VendorPublic[]>(`/vendors${qs ? `?${qs}` : ""}`);
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
