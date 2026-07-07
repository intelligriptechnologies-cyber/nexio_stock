// Staff management API wrappers. The backend exposes:
//
//   GET   /staff                  list receiver_user + cashier_user in owner's shop
//   POST  /staff                  create a new staff account (owner only)
//   PATCH /staff/{id}/password    reset a staff member's password/PIN (owner or superadmin)

import { api } from "./client";

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
  username: string;
  full_name: string;
  phone: string;
  password: string;
}

export function listStaff(): Promise<StaffMember[]> {
  return api<StaffMember[]>("/staff");
}

export function createStaff(
  payload: StaffCreatePayload,
  shopId?: number | null
): Promise<StaffMember> {
  const json = shopId != null ? { ...payload, shop_id: shopId } : payload;
  return api<StaffMember>("/staff", { method: "POST", json });
}

export function resetStaffPassword(userId: number, password: string): Promise<StaffMember> {
  return api<StaffMember>(`/staff/${userId}/password`, { method: "PATCH", json: { password } });
}