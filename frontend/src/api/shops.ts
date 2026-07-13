import { api, withShopId, withShopIdParams } from "./client";

export interface ShopPublic {
  id: number;
  name: string;
  code: string;
  gstin: string | null;
  excise_duty_rate: string | null; // Decimal serialised as string in JSON
  low_stock_threshold_default: number | null;
  allowed_login_cidrs: string[];
}

export interface ShopSummary {
  id: number;
  name: string;
  code: string;
}

export interface ShopUpdatePayload {
  name?: string;
  gstin?: string | null;
  excise_duty_rate?: string | null;
  low_stock_threshold_default?: number | null;
}

export type ShopUserRole = "owner" | "cashier_user" | "receiver_user";

export interface ShopUser {
  id: number;
  shop_id: number;
  role: ShopUserRole;
  username: string;
  full_name: string;
  phone: string;
  is_active: boolean;
  created_at: string;
}

export interface ShopCreatePayload {
  name: string;
  code: string;
  low_stock_threshold_default?: number | null;
  allowed_login_cidrs?: string[];
}

export interface ShopMaintenanceUpdatePayload {
  name?: string;
  code?: string;
  low_stock_threshold_default?: number | null;
  gstin?: string | null;
  excise_duty_rate?: string | null;
  allowed_login_cidrs?: string[] | null;
}

export interface ShopUserCreatePayload {
  role: ShopUserRole;
  username?: string | null;
  full_name: string;
  phone: string;
  password: string;
}

export interface ShopDevice {
  id: number;
  shop_id: number;
  device_key: string;
  counter_name: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ShopDeviceCreatePayload {
  device_key: string;
  counter_name?: string | null;
  is_active?: boolean;
}

export interface ShopDeviceUpdatePayload {
  counter_name?: string | null;
  is_active?: boolean | null;
}

// Superadmin-only (D-64/D-65): every shop, for the shop-scope picker.
export function listShops(): Promise<ShopSummary[]> {
  return api<ShopSummary[]>("/shops");
}

export function getMyShop(shopId?: number | null): Promise<ShopPublic> {
  const params = withShopIdParams(new URLSearchParams(), shopId);
  const qs = params.toString();
  return api<ShopPublic>(`/shops/me${qs ? `?${qs}` : ""}`);
}

export function updateMyShop(
  payload: ShopUpdatePayload,
  shopId?: number | null
): Promise<ShopPublic> {
  return api<ShopPublic>("/shops/me", { method: "PATCH", json: withShopId(payload, shopId) });
}

export function createShop(payload: ShopCreatePayload): Promise<ShopPublic> {
  return api<ShopPublic>("/shops", { method: "POST", json: payload });
}

export function updateShop(
  shopId: number,
  payload: ShopMaintenanceUpdatePayload
): Promise<ShopPublic> {
  return api<ShopPublic>(`/shops/${shopId}`, { method: "PATCH", json: payload });
}

export function listShopUsers(shopId: number): Promise<ShopUser[]> {
  return api<ShopUser[]>(`/shops/${shopId}/users`);
}

export function createShopUser(
  shopId: number,
  payload: ShopUserCreatePayload
): Promise<ShopUser> {
  return api<ShopUser>(`/shops/${shopId}/users`, { method: "POST", json: payload });
}

export function setShopUserActive(
  shopId: number,
  userId: number,
  isActive: boolean
): Promise<ShopUser> {
  return api<ShopUser>(`/shops/${shopId}/users/${userId}`, {
    method: "PATCH",
    json: { is_active: isActive },
  });
}

export function resetShopUserPassword(
  shopId: number,
  userId: number,
  password: string
): Promise<ShopUser> {
  return api<ShopUser>(`/shops/${shopId}/users/${userId}/password`, {
    method: "PATCH",
    json: { password },
  });
}

export function listShopDevices(shopId?: number | null): Promise<ShopDevice[]> {
  const params = withShopIdParams(new URLSearchParams(), shopId);
  const qs = params.toString();
  return api<ShopDevice[]>(`/shops/me/devices${qs ? `?${qs}` : ""}`);
}

export function upsertShopDevice(
  payload: ShopDeviceCreatePayload,
  shopId?: number | null
): Promise<ShopDevice> {
  const params = withShopIdParams(new URLSearchParams(), shopId);
  const qs = params.toString();
  return api<ShopDevice>(`/shops/me/devices${qs ? `?${qs}` : ""}`, {
    method: "POST",
    json: payload,
  });
}

export function updateShopDevice(
  deviceId: number,
  payload: ShopDeviceUpdatePayload,
  shopId?: number | null
): Promise<ShopDevice> {
  const params = withShopIdParams(new URLSearchParams(), shopId);
  const qs = params.toString();
  return api<ShopDevice>(`/shops/me/devices/${deviceId}${qs ? `?${qs}` : ""}`, {
    method: "PATCH",
    json: payload,
  });
}
