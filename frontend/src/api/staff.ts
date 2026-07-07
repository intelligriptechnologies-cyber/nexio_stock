// Staff management API wrappers. The backend exposes:
//
//   GET  /staff           list receiver_user + cashier_user in owner's shop
//   POST /staff           create a new staff account (owner only)
//
// No PATCH /staff/{id}/password endpoint ships in v1 of the backend
// (D-53 owner-driven reset is a planned but unimplemented endpoint).
// The frontend exposes a 'Reset PIN' button that surfaces an honest
// 'not yet implemented' state for now rather than fabricating a wire
// call that would 404. See issue #17 close comment for the gap list.

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

export function createStaff(payload: StaffCreatePayload): Promise<StaffMember> {
  return api<StaffMember>("/staff", { method: "POST", json: payload });
}