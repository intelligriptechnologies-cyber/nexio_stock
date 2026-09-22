import { useEffect, useRef } from "react";
import { lastPage, pageWindow } from "../utils/pagination";

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange(page: number): void;
  onPageSizeChange(pageSize: number): void;
  pageSizes?: readonly number[];
  disabled?: boolean;
  label?: string;
  position?: "top" | "bottom";
}

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizes = [25, 50, 100],
  disabled = false,
  label = "results",
  position,
}: PaginationProps) {
  const navRef = useRef<HTMLElement>(null);
  const settledPage = useRef(page);
  const ownsEffects = position !== "top";
  const accessibleLabel = position ? `${label} ${position}` : label;
  const pages = lastPage(total, pageSize);
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);

  useEffect(() => {
    if (ownsEffects && page > pages) onPageChange(pages);
  }, [ownsEffects, page, pages, onPageChange]);

  useEffect(() => {
    if (!ownsEffects || disabled || settledPage.current === page) return;
    settledPage.current = page;
    const container = navRef.current?.closest("section") ?? navRef.current?.parentElement;
    const heading = container?.querySelector<HTMLElement>("h1, h2, h3");
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
      heading.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [disabled, ownsEffects, page]);

  const button = (text: string, target: number, ariaLabel: string, current = false) => (
    <button
      type="button"
      className="min-h-10 min-w-10 rounded-lg border border-slate-300 px-3 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
      onClick={() => onPageChange(target)}
      disabled={disabled || target === page || target < 1 || target > pages}
      aria-label={ariaLabel}
      aria-current={current ? "page" : undefined}
    >
      {text}
    </button>
  );

  return (
    <nav
      ref={navRef}
      className={`${position === "top" ? "mb-4" : "mt-4"} flex flex-wrap items-center justify-between gap-3`}
      aria-label={`${accessibleLabel} pagination`}
    >
      <p className="text-sm text-slate-600">Items {first}–{last} of {total}</p>
      <div className="flex flex-wrap items-center gap-1">
        {button("«", 1, "First page")}
        {button("‹", page - 1, "Previous page")}
        {pageWindow(page, pages).map((value) => button(String(value), value, `Page ${value}`, value === page))}
        {button("›", page + 1, "Next page")}
        {button("»", pages, "Last page")}
      </div>
      <label className="flex items-center gap-2 text-sm text-slate-600">
        Items per page
        <select
          className="min-h-10 rounded-lg border border-slate-300 bg-white px-2"
          value={pageSize}
          disabled={disabled}
          onChange={(event) => onPageSizeChange(Number(event.target.value))}
          aria-label={`${accessibleLabel} items per page`}
        >
          {pageSizes.map((size) => <option key={size} value={size}>{size}</option>)}
        </select>
      </label>
      <span className="sr-only" aria-live="polite">Showing items {first} to {last} of {total}</span>
    </nav>
  );
}
