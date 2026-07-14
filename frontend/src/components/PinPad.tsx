import { useEffect } from "react";

// Oversized 12-key pad per docs/frontend_initial/barstock_design.md:
//   - keys are 64px tall (min touch target)
//   - large digit labels
//   - accent-colored primary action
// Renders three "actions" below the digits: backspace, clear, submit.

export interface PinPadProps {
  onDigit: (digit: string) => void;
  onBackspace: () => void;
  onClear: () => void;
  onSubmit: () => void;
  disabled?: boolean;
  accentLabel?: string;
}

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "clear", "0", "back"];

export function PinPad({
  onDigit,
  onBackspace,
  onClear,
  onSubmit,
  disabled = false,
  accentLabel = "SUBMIT",
}: PinPadProps) {
  useEffect(() => {
    const handleKey = (e: globalThis.KeyboardEvent) => {
      if (disabled) return;

      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        onDigit(e.key);
      } else if (e.key === "Backspace") {
        e.preventDefault();
        onBackspace();
      } else if (e.key === "Enter") {
        e.preventDefault();
        onSubmit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClear();
      }
    };

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [disabled, onBackspace, onClear, onDigit, onSubmit]);

  return (
    <div
      className="grid w-full max-w-xs grid-cols-3 gap-3 outline-none"
      aria-label="PIN pad"
    >
      {KEYS.map((k) => {
        if (k === "clear") {
          return (
            <button
              key="clear"
              type="button"
              disabled={disabled}
              onClick={onClear}
              className="h-16 rounded-2xl bg-slate-100 text-lg font-bold text-slate-700 transition-colors hover:bg-slate-200 active:bg-slate-300 disabled:opacity-50"
            >
              CLR
            </button>
          );
        }
        if (k === "back") {
          return (
            <button
              key="back"
              type="button"
              disabled={disabled}
              onClick={onBackspace}
              className="h-16 rounded-2xl bg-slate-100 text-lg font-bold text-slate-700 transition-colors hover:bg-slate-200 active:bg-slate-300 disabled:opacity-50"
              aria-label="Backspace"
            >
              ⌫
            </button>
          );
        }
        return (
          <button
            key={k}
            type="button"
            disabled={disabled}
            onClick={() => onDigit(k)}
            className="min-h-touchTarget rounded-md bg-primary text-display-lg text-on-primary active:bg-primary-container disabled:opacity-50"
            aria-label={`Digit ${k}`}
          >
            {k}
          </button>
        );
      })}
      <button
        type="button"
        disabled={disabled}
        onClick={onSubmit}
        className="col-span-3 min-h-touchTarget rounded-md bg-action text-label-xl text-on-action active:opacity-90 disabled:opacity-50"
      >
        {accentLabel}
      </button>
    </div>
  );
}
