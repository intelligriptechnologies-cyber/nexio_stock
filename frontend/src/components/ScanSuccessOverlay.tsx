import { useEffect, useState } from "react";

interface ScanSuccessOverlayProps {
  brand: string;
  sizeLabel: string;
  onDone: () => void;
}

export function ScanSuccessOverlay({ brand, sizeLabel, onDone }: ScanSuccessOverlayProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const showTimer = window.setTimeout(() => setVisible(true), 0);
    const fadeTimer = window.setTimeout(() => setVisible(false), 800);
    const doneTimer = window.setTimeout(onDone, 1000);

    return () => {
      window.clearTimeout(showTimer);
      window.clearTimeout(fadeTimer);
      window.clearTimeout(doneTimer);
    };
  }, [onDone]);

  return (
    <div
      aria-live="polite"
      className={`pointer-events-none fixed inset-0 z-20 flex items-center justify-center bg-success/90 px-gutter text-on-secondary transition-opacity duration-200 ${
        visible ? "opacity-100" : "opacity-0"
      }`}
      data-testid="scan-success-overlay"
    >
      <div className="text-center">
        <div className="text-label-xl uppercase tracking-wide">Added</div>
        <div className="mt-stack-gap break-words text-display-lg font-black leading-tight">
          {brand} {sizeLabel}
        </div>
      </div>
    </div>
  );
}
