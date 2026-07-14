import { useEffect, useRef, type ReactNode } from "react";
import { useModalLock } from "../hooks/useModalLock";

function getFocusableElements(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      [
        'a[href]',
        'button:not([disabled])',
        'input:not([disabled])',
        'select:not([disabled])',
        'textarea:not([disabled])',
        '[tabindex]:not([tabindex="-1"])',
      ].join(",")
    )
  ).filter((element) => !element.hasAttribute("disabled") && !element.getAttribute("aria-hidden"));
}

interface ModalDialogProps {
  children: ReactNode;
  labelledBy?: string;
  describedBy?: string;
  onDismiss?: () => void;
  className?: string;
}

export function ModalDialog({
  children,
  labelledBy,
  describedBy,
  onDismiss,
  className = "animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm transition-opacity",
}: ModalDialogProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);
  useModalLock(true);

  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    previousActiveElementRef.current = document.activeElement as HTMLElement | null;
    const root = rootRef.current;
    const focusables = getFocusableElements(contentRef.current);
    const target = focusables[0] ?? root;
    target?.focus();
    return () => {
      previousActiveElementRef.current?.focus?.();
    };
  }, []);

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      tabIndex={-1}
      className={className}
      onClick={(e) => {
        if (e.target === e.currentTarget && onDismiss) {
          onDismiss();
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && onDismiss) {
          e.preventDefault();
          e.stopPropagation();
          onDismiss();
          return;
        }
        if (e.key !== "Tab") return;
        const root = contentRef.current;
        const focusables = getFocusableElements(root);
        if (focusables.length === 0) {
          e.preventDefault();
          rootRef.current?.focus();
          return;
        }

        const activeElement = document.activeElement as HTMLElement | null;
        const currentIndex = activeElement ? focusables.indexOf(activeElement) : -1;
        const nextIndex = e.shiftKey
          ? currentIndex <= 0
            ? focusables.length - 1
            : currentIndex - 1
          : currentIndex === focusables.length - 1
            ? 0
            : currentIndex + 1;

        e.preventDefault();
        focusables[nextIndex]?.focus();
      }}
    >
      <div ref={contentRef} className="contents">
        {children}
      </div>
    </div>
  );
}
