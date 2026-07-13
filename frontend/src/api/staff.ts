// Staff management API wrappers. The backend exposes:
//
//   GET   /staff                  list receiver_user + cashier_user in owner's shop
//   POST  /staff                  create a new staff account (owner only)
//   PATCH /staff/{id}/password    reset a staff member's password/PIN (owner or superadmin)

import { api, withShopId, withShopIdParams } from "./client";

export type StaffRole = "receiver_user" | "cashier_user";

export interface StaffMember {
  id: number;
  shop_id: number;
  role: StaffRole;
  username: string;
  full_name: string;
  phone: string;
  is_active: boolean;
  created_at: string;
}

export interface StaffCreatePayload {
  role: StaffRole;
  username?: string | null;
  full_name: string;
  phone: string;
  password: string;
}

export function listStaff(shopId?: number | null): Promise<StaffMember[]> {
  const params = withShopIdParams(new URLSearchParams(), shopId);
  const qs = params.toString();
  return api<StaffMember[]>(`/staff${qs ? `?${qs}` : ""}`);
}

export function createStaff(
  payload: StaffCreatePayload,
  shopId?: number | null
): Promise<StaffMember> {
  return api<StaffMember>("/staff", { method: "POST", json: withShopId(payload, shopId) });
}

export function resetStaffPassword(
  userId: number,
  password: string,
  shopId?: number | null
): Promise<StaffMember> {
  const params = withShopIdParams(new URLSearchParams(), shopId);
  const qs = params.toString();
  return api<StaffMember>(`/staff/${userId}/password${qs ? `?${qs}` : ""}`, {
    method: "PATCH",
    json: { password },
  });
}

export function setStaffActive(
  userId: number,
  isActive: boolean,
  shopId?: number | null
): Promise<StaffMember> {
  const params = withShopIdParams(new URLSearchParams(), shopId);
  const qs = params.toString();
  return api<StaffMember>(`/staff/${userId}${qs ? `?${qs}` : ""}`, {
    method: "PATCH",
    json: { is_active: isActive },
  });
}
