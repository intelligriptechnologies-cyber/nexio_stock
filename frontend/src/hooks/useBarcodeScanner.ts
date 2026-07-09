import { useEffect, useRef } from "react";

interface UseBarcodeScannerOptions {
  enabled: boolean;
  onScan: (barcode: string) => void;
  minLength?: number;
  maxGapMs?: number;
  maxTotalMs?: number;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select";
}

function hasOpenDialog(): boolean {
  return document.querySelector('[role="dialog"][aria-modal="true"], dialog[open]') !== null;
}

export function useBarcodeScanner({
  enabled,
  onScan,
  minLength = 6,
  maxGapMs = 45,
  maxTotalMs = 750,
}: UseBarcodeScannerOptions): void {
  const onScanRef = useRef(onScan);

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  useEffect(() => {
    let buffer = "";
    let firstAt = 0;
    let lastAt = 0;

    const reset = () => {
      buffer = "";
      firstAt = 0;
      lastAt = 0;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (!enabled || hasOpenDialog()) {
        reset();
        return;
      }
      if (event.ctrlKey || event.altKey || event.metaKey || event.isComposing) {
        reset();
        return;
      }

      const now = event.timeStamp || performance.now();
      if (event.key === "Enter") {
        const totalMs = firstAt ? now - firstAt : 0;
        const averageGap = buffer.length > 1 ? totalMs / (buffer.length - 1) : totalMs;
        const scannerLike =
          buffer.length >= minLength && totalMs <= maxTotalMs && averageGap <= maxGapMs;
        if (scannerLike) {
          event.preventDefault();
          event.stopPropagation();
          const code = buffer;
          reset();
          onScanRef.current(code);
          return;
        }
        reset();
        return;
      }

      if (event.key.length !== 1 || /\s/.test(event.key)) {
        if (!isEditableTarget(event.target)) reset();
        return;
      }

      if (!firstAt || now - lastAt > maxGapMs) {
        buffer = event.key;
        firstAt = now;
      } else {
        buffer += event.key;
      }
      lastAt = now;
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [enabled, maxGapMs, maxTotalMs, minLength]);
}
