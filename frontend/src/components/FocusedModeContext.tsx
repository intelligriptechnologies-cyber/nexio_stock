import { createContext, useContext } from "react";

export interface FocusedModeContextValue {
  supportsFocusedMode: boolean;
  isFocusedModeEnabled: boolean;
  isBrowserFullscreenActive: boolean;
  enterFocusedMode: () => Promise<void>;
  exitFocusedMode: () => Promise<void>;
}

export const FocusedModeContext = createContext<FocusedModeContextValue | undefined>(undefined);

export function useFocusedMode(): FocusedModeContextValue {
  const ctx = useContext(FocusedModeContext);
  if (!ctx) throw new Error("useFocusedMode must be used within the authenticated shell");
  return ctx;
}
