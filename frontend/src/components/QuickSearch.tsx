// Reusable quicksearch component (issue #23, D-v2-11).
//
// Pure client-side filter over the already-prefetched catalog cache.
// The cashier/receiver types a barcode or brand-name substring and taps
// a match to add it to the cart/lot exactly like a scan would. The
// underlying `quickSearch()` lives in `../api/catalog.ts`.
//
// No new backend endpoint, no per-keystroke network round trip — this
// is the whole point of having the catalog prefetched.

import { useEffect, useState } from "react";
import { quickSearch, type CatalogProduct } from "../api/catalog";
import { useShopScope } from "../auth/ShopScopeProvider";

interface QuickSearchProps {
  /** Called when the user taps a match. The parent treats it like a scan. */
  onPick: (product: CatalogProduct) => void;
  /** Placeholder for the input — different at receiving vs checkout. */
  placeholder?: string;
  /** aria-label for the input. */
  ariaLabel?: string;
  /** Auto-focus when mounted (true on receiving/checkout, false in modals). */
  autoFocus?: boolean;
}

export function QuickSearch({
  onPick,
  placeholder = "Search by name or barcode",
  ariaLabel = "Search products by name or barcode",
  autoFocus = false,
}: QuickSearchProps) {
  const { actingShopId } = useShopScope();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CatalogProduct[]>([]);
  const [open, setOpen] = useState(false);

  // Debounce-free filter: the catalog is small (max 500 active products
  // for one shop, D-30), the substring match is O(n), and the
  // keystroke handler runs on every change. No need to throttle.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    let cancelled = false;
    void quickSearch(q, actingShopId).then((items) => {
      if (!cancelled) setResults(items);
    });
    return () => {
      cancelled = true;
    };
  }, [query, actingShopId]);

  const handlePick = (p: CatalogProduct) => {
    onPick(p);
    setQuery("");
    setResults([]);
    setOpen(false);
  };

  return (
    <div className="relative flex flex-col gap-1">
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // Delay close so a tap on a result registers before the
          // dropdown unmounts.
          window.setTimeout(() => setOpen(false), 150);
        }}
        placeholder={placeholder}
        aria-label={ariaLabel}
        autoFocus={autoFocus}
        className="min-h-touchTarget-sm w-full rounded-md border border-outline bg-surface px-stack-gap text-body-md"
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-autocomplete="list"
      />
      {open && results.length > 0 && (
        <ul
          className="absolute left-0 right-0 top-full z-20 mt-1 flex max-h-72 flex-col gap-0 overflow-y-auto rounded-md border border-outline bg-surface shadow-lg"
          role="listbox"
        >
          {results.map((p) => (
            <li key={p.id} role="option">
              <button
                type="button"
                // Prevent the parent form's submit handler from firing
                // when the user taps a match — this is a pick, not an
                // "Add by barcode" submission.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handlePick(p)}
                className="flex w-full items-center justify-between px-stack-gap py-2 text-left hover:bg-surface-container-high"
              >
                <span className="flex flex-col">
                  <span className="text-label-md text-on-surface">
                    {p.brand}
                    {p.size_label ? (
                      <span className="ml-2 text-on-surface-variant">{p.size_label}</span>
                    ) : null}
                  </span>
                  <span className="font-mono text-label-md text-on-surface-variant">
                    {p.barcode}
                  </span>
                </span>
                <span className="font-mono text-label-md text-on-surface">
                  ₹{p.price}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && query.trim() !== "" && results.length === 0 && (
        <div
          className="absolute left-0 right-0 top-full z-20 mt-1 rounded-md border border-outline bg-surface px-stack-gap py-2 text-label-md text-on-surface-variant shadow-lg"
          role="status"
        >
          No matches.
        </div>
      )}
    </div>
  );
}