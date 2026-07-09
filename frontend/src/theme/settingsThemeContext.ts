import { createContext, useContext } from "react";
import type { SettingsPublic } from "../api/settings";

export interface SettingsThemeValue {
  settings: SettingsPublic | null;
  displayName: string;
  actionColor: string;
  refreshSettings: () => Promise<void>;
  applySettings: (settings: SettingsPublic) => void;
}

export const SettingsThemeContext = createContext<SettingsThemeValue | undefined>(undefined);

export function useSettingsTheme(): SettingsThemeValue {
  const ctx = useContext(SettingsThemeContext);
  if (!ctx) throw new Error("useSettingsTheme must be used within SettingsThemeProvider");
  return ctx;
}
