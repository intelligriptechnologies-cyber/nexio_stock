import { ApiError, api } from "./client";
import { resolveBarcode, type CatalogProduct } from "./catalog";

export interface LotLineCreate {
  barcode: string;
  quantity: number;
}

export interface LotCreate {
  reference?: string;
  notes?: string;
  lines: LotLineCreate[];
}

export interface LotLinePublic {
  id: number;
  product_id: number;
  quantity: number;
}

export interface LotPublic {
  id: number;
  shop_id: number;
  received_by_user_id: number;
  reference: string | null;
  notes: string | null;
  received_at: string;
  created_at: string;
  lines: LotLinePublic[];
}

export function createLot(payload: LotCreate): Promise<LotPublic> {
  return api<LotPublic>("/lots", {
    method: "POST",
    json: payload,
  });
}

export function listRecentLots(limit = 20): Promise<{ lots: LotPublic[] }> {
  return api<{ lots: LotPublic[] }>(`/lots?limit=${limit}`);
}

// Resolve barcode via the cached catalog (shared with checkout) and fall
// back to /products/lookup on a miss. Re-exported so the receiving page
// doesn't need to import catalog.ts directly.
export async function resolveForReceiving(barcode: string): Promise<CatalogProduct> {
  return resolveBarcode(barcode);
}

export class LotValidationError extends Error {
  constructor(public readonly status: number, public readonly detail: string) {
    super(`HTTP ${status}: ${detail}`);
  }
}

// Wrap createLot so the page only handles ApiError for surface mapping;
// the backend rejects duplicate barcodes within a single lot with a 400
// (the model_validator raises ValueError on duplicates).
export async function createLotSafe(payload: LotCreate): Promise<LotPublic> {
  try {
    return await createLot(payload);
  } catch (e) {
    if (e instanceof ApiError) throw new LotValidationError(e.status, e.detail);
    throw e;
  }
}