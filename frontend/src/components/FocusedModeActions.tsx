import { useFocusedMode } from "./FocusedModeContext";

export function FocusedModeActions() {
  const {
    supportsFocusedMode,
    isFocusedModeEnabled,
    isBrowserFullscreenActive,
    enterFocusedMode,
    exitFocusedMode,
  } = useFocusedMode();

  if (!supportsFocusedMode) return null;

  return (
    <div className="flex flex-wrap items-center justify-end gap-3 text-sm">
      {!isBrowserFullscreenActive && isFocusedModeEnabled && (
        <button
          type="button"
          onClick={() => {
            void exitFocusedMode();
          }}
          className="app-inline-action text-slate-500 hover:text-slate-700"
        >
          End focused session
        </button>
      )}
      {!isBrowserFullscreenActive && (
        <button
          type="button"
          onClick={() => {
            void enterFocusedMode();
          }}
          className="app-inline-action text-action hover:text-emerald-700"
        >
          Enter fullscreen
        </button>
      )}
      {isBrowserFullscreenActive && (
        <button
          type="button"
          onClick={() => {
            void exitFocusedMode();
          }}
          className="app-inline-action text-slate-700 hover:text-slate-900"
        >
          Exit fullscreen
        </button>
      )}
    </div>
  );
}
