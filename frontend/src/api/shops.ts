import { api, withShopId, withShopIdParams } from "./client";

export interface ShopPublic {
  id: number;
  name: string;
  code: string;
  current_business_date: string;
  gstin: string | null;
  excise_duty_rate: string | null; // Decimal serialised as string in JSON
  low_stock_threshold_default: number | null;
  cashier_login_restriction_enabled: boolean;
  receiving_vendor_link_enabled: boolean;
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
  cashier_login_restriction_enabled?: boolean;
  receiving_vendor_link_enabled?: boolean;
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
  cashier_login_restriction_enabled?: boolean;
  receiving_vendor_link_enabled?: boolean;
  allowed_login_cidrs?: string[];
}

export interface ShopMaintenanceUpdatePayload {
  name?: string;
  code?: string;
  low_stock_threshold_default?: number | null;
  cashier_login_restriction_enabled?: boolean;
  receiving_vendor_link_enabled?: boolean;
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

export interface ShopTwoFactorPublic {
  shop_id: number;
  two_factor_enabled: boolean;
  two_factor_secret_version: number | null;
  two_factor_rotated_at: string | null;
  two_factor_required_for_roles: string[];
  has_active_secret: boolean;
}

export interface ShopAuthenticatorActivation {
  id: number;
  shop_id: number;
  secret_version: number;
  machine_label: string | null;
  is_active: boolean;
  activated_at: string;
  last_seen_at: string | null;
  deactivated_at: string | null;
}

export interface ShopAuthenticatorActivationToken {
  activation_token: string;
  expires_at: string;
  shop_id: number;
  secret_version: number;
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

export function getShopTwoFactor(shopId: number): Promise<ShopTwoFactorPublic> {
  return api<ShopTwoFactorPublic>(`/shops/${shopId}/two-factor`);
}

export function updateShopTwoFactor(
  shopId: number,
  twoFactorEnabled: boolean
): Promise<ShopTwoFactorPublic> {
  return api<ShopTwoFactorPublic>(`/shops/${shopId}/two-factor`, {
    method: "PATCH",
    json: { two_factor_enabled: twoFactorEnabled },
  });
}

export function generateShopTwoFactorSecret(shopId: number): Promise<ShopTwoFactorPublic> {
  return api<ShopTwoFactorPublic>(`/shops/${shopId}/two-factor/secret`, {
    method: "POST",
  });
}

export function rotateShopTwoFactorSecret(shopId: number): Promise<ShopTwoFactorPublic> {
  return api<ShopTwoFactorPublic>(`/shops/${shopId}/two-factor/secret/rotate`, {
    method: "POST",
  });
}

export function createShopAuthenticatorActivationToken(
  shopId: number,
  payload?: { machine_label?: string | null; expires_in_minutes?: number }
): Promise<ShopAuthenticatorActivationToken> {
  return api<ShopAuthenticatorActivationToken>(`/shops/${shopId}/two-factor/activation-tokens`, {
    method: "POST",
    json: payload ?? {},
  });
}

export function listShopAuthenticatorActivations(
  shopId: number
): Promise<ShopAuthenticatorActivation[]> {
  return api<ShopAuthenticatorActivation[]>(`/shops/${shopId}/two-factor/authenticator-activations`);
}

export function updateShopAuthenticatorActivation(
  shopId: number,
  activationId: number,
  isActive: boolean
): Promise<ShopAuthenticatorActivation> {
  return api<ShopAuthenticatorActivation>(
    `/shops/${shopId}/two-factor/authenticator-activations/${activationId}`,
    {
      method: "PATCH",
      json: { is_active: isActive },
    }
  );
}
