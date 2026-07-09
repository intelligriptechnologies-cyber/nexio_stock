import { api, withShopId, withShopIdParams } from "./client";

export interface SettingsPublic {
  id: number;
  name: string;
  code: string;
  app_display_name: string | null;
  action_color: string;
  active_tab_color: string;
  sidebar_menu_inactive_text_color: string;
  sidebar_menu_active_text_color: string;
  email_enabled: boolean;
  smtp_host: string | null;
  smtp_port: number | null;
  smtp_username: string | null;
  smtp_from_email: string | null;
  smtp_from_name: string | null;
  smtp_use_tls: boolean;
  gstin: string | null;
  excise_duty_rate: string | null;
  low_stock_threshold_default: number | null;
}

export interface SettingsUpdatePayload {
  app_display_name?: string | null;
  action_color?: string;
  active_tab_color?: string;
  sidebar_menu_inactive_text_color?: string;
  sidebar_menu_active_text_color?: string;
  email_enabled?: boolean;
  smtp_host?: string | null;
  smtp_port?: number | null;
  smtp_username?: string | null;
  smtp_password?: string;
  smtp_from_email?: string | null;
  smtp_from_name?: string | null;
  smtp_use_tls?: boolean;
  gstin?: string | null;
  excise_duty_rate?: string | null;
  low_stock_threshold_default?: number | null;
}

export function getMySettings(shopId?: number | null): Promise<SettingsPublic> {
  const params = withShopIdParams(new URLSearchParams(), shopId);
  const qs = params.toString();
  return api<SettingsPublic>(`/settings/me${qs ? `?${qs}` : ""}`);
}

export function updateMySettings(
  payload: SettingsUpdatePayload,
  shopId?: number | null
): Promise<SettingsPublic> {
  return api<SettingsPublic>("/settings/me", { method: "PATCH", json: withShopId(payload, shopId) });
}
