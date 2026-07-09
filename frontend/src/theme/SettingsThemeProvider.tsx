import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { getMySettings, type SettingsPublic } from "../api/settings";
import { useAuth } from "../auth/AuthProvider";
import { useShopScope } from "../auth/ShopScopeProvider";
import { SettingsThemeContext } from "./settingsThemeContext";

const DEFAULT_NAME = "BarStock";
const DEFAULT_ACTION_COLOR = "#22c55e";
const DEFAULT_ACTIVE_TAB_COLOR = "#5a5148";
const DEFAULT_MENU_INACTIVE_TEXT_COLOR = "#535353cf";
const DEFAULT_MENU_ACTIVE_TEXT_COLOR = "#ffffff";

function readableTextColor(hex: string): string {
  const normalized = hex.replace("#", "");
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62 ? "#0f172a" : "#ffffff";
}

function applyActionColor(color: string): void {
  const root = document.documentElement;
  root.style.setProperty("--color-action", color);
  root.style.setProperty("--color-sidebar-active", color);
  root.style.setProperty("--color-on-action", readableTextColor(color));
}

function applyActiveTabColor(color: string): void {
  const root = document.documentElement;
  root.style.setProperty("--color-active-tab", color);
  root.style.setProperty("--color-on-active-tab", readableTextColor(color));
}

function applyMenuTextColors(inactiveColor: string, activeColor: string): void {
  const root = document.documentElement;
  root.style.setProperty("--color-sidebar-menu-inactive-text", inactiveColor);
  root.style.setProperty("--color-sidebar-menu-active-text", activeColor);
}

export function SettingsThemeProvider({ children }: { children: ReactNode }) {
  const { user, token } = useAuth();
  const { actingShopId } = useShopScope();
  const [settings, setSettings] = useState<SettingsPublic | null>(null);

  const applySettings = useCallback((next: SettingsPublic) => {
    setSettings(next);
    applyActionColor(next.action_color);
    applyActiveTabColor(next.active_tab_color);
    applyMenuTextColors(
      next.sidebar_menu_inactive_text_color,
      next.sidebar_menu_active_text_color
    );
  }, []);

  const refreshSettings = useCallback(async () => {
    if (!token || !user) {
      setSettings(null);
      applyActionColor(DEFAULT_ACTION_COLOR);
      applyActiveTabColor(DEFAULT_ACTIVE_TAB_COLOR);
      applyMenuTextColors(DEFAULT_MENU_INACTIVE_TEXT_COLOR, DEFAULT_MENU_ACTIVE_TEXT_COLOR);
      return;
    }
    if (user.role === "superadmin" && actingShopId === null) {
      setSettings(null);
      applyActionColor(DEFAULT_ACTION_COLOR);
      applyActiveTabColor(DEFAULT_ACTIVE_TAB_COLOR);
      applyMenuTextColors(DEFAULT_MENU_INACTIVE_TEXT_COLOR, DEFAULT_MENU_ACTIVE_TEXT_COLOR);
      return;
    }
    const next = await getMySettings(actingShopId);
    applySettings(next);
  }, [actingShopId, applySettings, token, user]);

  useEffect(() => {
    void refreshSettings().catch(() => {
      setSettings(null);
      applyActionColor(DEFAULT_ACTION_COLOR);
      applyActiveTabColor(DEFAULT_ACTIVE_TAB_COLOR);
      applyMenuTextColors(DEFAULT_MENU_INACTIVE_TEXT_COLOR, DEFAULT_MENU_ACTIVE_TEXT_COLOR);
    });
  }, [refreshSettings]);

  const displayName = settings?.app_display_name?.trim() || DEFAULT_NAME;
  const actionColor = settings?.action_color || DEFAULT_ACTION_COLOR;

  const value = useMemo(
    () => ({ settings, displayName, actionColor, refreshSettings, applySettings }),
    [actionColor, applySettings, displayName, refreshSettings, settings]
  );

  return <SettingsThemeContext.Provider value={value}>{children}</SettingsThemeContext.Provider>;
}
