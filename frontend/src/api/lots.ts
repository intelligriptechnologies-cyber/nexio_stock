import { ApiError, api, withShopId } from "./client";
import { resolveBarcode, type CatalogProduct } from "./catalog";

export interface LotLineCreate {
  barcode: string;
  quantity: number;
  good_condition_quantity: number;
}

export interface LotCreate {
  vendor_id: number;
  purchase_date: string;
  vendor_invoice_number: string;
  invoice_value: string;
  reference?: string;
  notes?: string;
  lines: LotLineCreate[];
}

export interface LotLinePublic {
  id: number;
  product_id: number;
  quantity: number;
  good_condition_quantity: number;
  breakage_quantity: number;
  product_brand: string;
  product_size_label: string;
}

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

export interface LotPublic {
  id: number;
  shop_id: number;
  vendor_id: number;
  received_by_user_id: number;
  purchase_date: string;
  vendor_invoice_number: string;
  invoice_value: string;
  reference: string | null;
  notes: string | null;
  received_at: string;
  created_at: string;
  vendor: VendorPublic;
  lines: LotLinePublic[];
}

export function createLot(payload: LotCreate, shopId?: number | null): Promise<LotPublic> {
  return api<LotPublic>("/lots", {
    method: "POST",
    json: withShopId(payload, shopId),
  });
}

export function listRecentLots(limit = 20): Promise<{ lots: LotPublic[] }> {
  return api<{ lots: LotPublic[] }>(`/lots?limit=${limit}`);
}

export async function resolveForReceiving(
  barcode: string,
  shopId?: number | null
): Promise<CatalogProduct> {
  return resolveBarcode(barcode, shopId);
}

export class LotValidationError extends Error {
  constructor(public readonly status: number, public readonly detail: string) {
    super(`HTTP ${status}: ${detail}`);
  }
}

export async function createLotSafe(
  payload: LotCreate,
  shopId?: number | null
): Promise<LotPublic> {
  try {
    return await createLot(payload, shopId);
  } catch (e) {
    if (e instanceof ApiError) throw new LotValidationError(e.status, e.detail);
    throw e;
  }
}
