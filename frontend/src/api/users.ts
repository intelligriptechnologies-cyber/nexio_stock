import { api } from "./client";

export interface UserPublic {
  id: number;
  shop_id: number | null;
  role: "superadmin" | "owner" | "receiver_user" | "cashier_user";
  username: string;
  full_name: string;
  phone: string;
  email: string | null;
  date_of_birth: string | null;
  pan: string | null;
  gstin: string | null;
  is_active: boolean;
  created_at: string;
}

export interface UserProfileUpdatePayload {
  email?: string | null;
  phone?: string | null;
  date_of_birth?: string | null;
  pan?: string | null;
  gstin?: string | null;
}

export interface UserPasswordUpdatePayload {
  current_password: string;
  new_password: string;
  confirm_password: string;
}

export function getMyUser(): Promise<UserPublic> {
  return api<UserPublic>("/users/me");
}

export function updateMyUser(payload: UserProfileUpdatePayload): Promise<UserPublic> {
  return api<UserPublic>("/users/me", { method: "PATCH", json: payload });
}

export function changeMyPassword(payload: UserPasswordUpdatePayload): Promise<UserPublic> {
  return api<UserPublic>("/users/me/password", { method: "PATCH", json: payload });
}
