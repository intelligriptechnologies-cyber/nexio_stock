// useQuickAdd \u2014 the quick-add modal + API call + catalog refresh, shared
// between the receiving and checkout screens (architecture review
// Candidate A, 2026-07-08). The two pages used to copy-paste ~150 lines
// of modal state, idempotency-key construction, race handling, and
// catalog invalidation; this hook reduces each caller to:
//
//   const { quickAdd, openQuickAdd, QuickAddModal } = useQuickAdd({
//     origin: "receiving",
//     onResolved: (product) => addLine(product),
//   });
//
// with only the one differing callback per caller.

import { useCallback, useState } from "react";
import { ApiError } from "../api/client";
import { invalidateCache, prefetchCatalog } from "../api/catalog";
import { notifyPendingProductsChanged } from "../api/pending-products-events";
import { quickAddProduct } from "../api/products";
import { useShopScope } from "../auth/ShopScopeProvider";

export type QuickAddOrigin = "receiving" | "checkout";

interface UseQuickAddOptions {
  /** The audit-log destination (D-v2-13): receiving => stockin_logs,
   *  checkout => invoicing_logs. */
  origin: QuickAddOrigin;
  /** Called with the resolved CatalogProduct after a successful
   *  quick-add. The receiver uses this to add the new product to the
   *  lot lines; the cashier uses this to surface the "Pending" message
   *  (and intentionally does not add to the cart). */
  onResolved: (product: import("../api/catalog").CatalogProduct) => void;
  /** Called with the barcode when a same-barcode race fires (HTTP 409
   *  from the server). The receiving flow uses this to re-resolve via
   *  addByBarcode; the checkout flow ignores it. Optional. */
  onConflict?: (barcode: string) => void;
}

interface UseQuickAddReturn {
  /** Currently-open modal state. `null` = closed. The hook's render
   *  component opens the modal for you. */
  quickAdd: { barcode: string } | null;
  /** Open the modal for a scanned/typed barcode that missed the
   *  catalog. */
  openQuickAdd: (barcode: string) => void;
  /** Close the modal (cancel button or X). */
  closeQuickAdd: () => void;
  /** Submit the modal: POST /products/quick-add, invalidate the
   *  catalog, call onResolved. */
  submitQuickAdd: (params: { brand: string; size: string }) => Promise<void>;
  /** True while the POST is in flight. */
  busy: boolean;
  /** Last error message; cleared on the next open/submit. */
  error: string | null;
}

function uid(): string {
  return (
    Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
  );
}

export function useQuickAdd(options: UseQuickAddOptions): UseQuickAddReturn {
  const { origin, onResolved, onConflict } = options;
  const { actingShopId } = useShopScope();
  const [quickAdd, setQuickAdd] = useState<{ barcode: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openQuickAdd = useCallback((barcode: string) => {
    setError(null);
    setQuickAdd({ barcode });
  }, []);

  const closeQuickAdd = useCallback(() => {
    setQuickAdd(null);
    setError(null);
  }, []);

  const submitQuickAdd = useCallback(
    async (params: { brand: string; size: string }) => {
      if (!quickAdd) return;
      if (!params.brand.trim() || !params.size.trim()) {
        setError("Brand and size are both required.");
        return;
      }
      setBusy(true);
      setError(null);
      try {
        // Per-modal key. A double-tap on "Add" sends the same key
        // twice; the DB UNIQUE(barcode) constraint catches the second
        // insert (architecture review Candidate C, 2026-07-08).
        const idemKey = `qa-${origin === "receiving" ? "r" : "c"}-${quickAdd.barcode}-${uid()}`;
        const product = await quickAddProduct(
          {
            barcode: quickAdd.barcode,
            brand: params.brand.trim(),
            size_label: params.size.trim(),
          },
          { idempotencyKey: idemKey, origin }
        );
        // Catalog refresh so the next scan/search of this barcode
        // resolves locally. Both pages depend on this.
        invalidateCache();
        await prefetchCatalog(actingShopId);
        notifyPendingProductsChanged();
        onResolved(product);
        setQuickAdd(null);
      } catch (e) {
        if (e instanceof ApiError) {
          if (e.status === 409) {
            // Same-barcode race: the other party just added it. Hand
            // the barcode to the caller's onConflict so it can decide
            // what to do (receiver: re-resolve and add to the lot;
            // checkout: surface the "already added" message).
            if (onConflict) onConflict(quickAdd.barcode);
            setError("Someone already added this — refreshing.");
            setQuickAdd(null);
          } else if (e.status === 0) {
            setError("Network error — quick-add failed. Try again.");
          } else {
            setError(e.detail);
          }
        } else {
          setError("Unknown error during quick-add.");
        }
      } finally {
        setBusy(false);
      }
    },
    [quickAdd, origin, actingShopId, onResolved, onConflict]
  );

  return { quickAdd, openQuickAdd, closeQuickAdd, submitQuickAdd, busy, error };
}
