import { useEffect, useState, useCallback } from "react";
import { ApiError } from "../api/client";
import { invalidateCache, prefetchCatalog, type CatalogProduct } from "../api/catalog";
import { createLotSafe, type LotPublic } from "../api/lots";
import { quickAddProduct } from "../api/products";
import { QuickSearch } from "../components/QuickSearch";
import { useAuth } from "../auth/AuthProvider";
import { useShopScope } from "../auth/ShopScopeProvider";

interface ReceivingLine {
  lineId: string;
  barcode: string;
  brand: string;
  sizeLabel: string;
  quantity: number;
}

function uid(): string {
  // Stable, opaque per-tab id used as the Idempotency-Key for quick-add
  // (D-v2-12). Math.random() is enough for the "double-tap on the same
  // button within seconds" shape that the cache is designed for — not a
  // cryptographic context.
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

interface QuickAddState {
  // The barcode the receiver just scanned/typed that didn't resolve.
  // null = the quick-add modal is closed.
  barcode: string;
}

export function ReceivingPage() {
  const { user } = useAuth();
  const { actingShopId } = useShopScope();
  const [barcode, setBarcode] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<ReceivingLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [catalogReady, setCatalogReady] = useState(false);
  const [lastLot, setLastLot] = useState<LotPublic | null>(null);
  // Quick-add modal state (issue #22). When a scan misses, we surface
  // a one-shot form so the receiver can register the brand-new product
  // on the spot instead of rejecting the lot.
  const [quickAdd, setQuickAdd] = useState<QuickAddState | null>(null);
  const [quickAddBusy, setQuickAddBusy] = useState(false);
  const [quickAddError, setQuickAddError] = useState<string | null>(null);
  const [quickAddBrand, setQuickAddBrand] = useState("");
  const [quickAddSize, setQuickAddSize] = useState("");

  useEffect(() => {
    setCatalogReady(false);
    prefetchCatalog(actingShopId)
      .then(() => setCatalogReady(true))
      .catch((e) => setError(`Catalog load failed: ${e instanceof Error ? e.message : e}`));
  }, [actingShopId]);

  const addByBarcode = useCallback(
    async (raw: string) => {
      const code = raw.trim();
      if (!code) return;
      setError(null);
      setInfo(null);
      try {
        const { resolveBarcode } = await import("../api/catalog");
        const product = await resolveBarcode(code, actingShopId);
        setLines((prev) => {
          const existing = prev.find((l) => l.barcode === code);
          if (existing) {
            return prev.map((l) =>
              l.lineId === existing.lineId ? { ...l, quantity: l.quantity + 1 } : l
            );
          }
          return [
            ...prev,
            {
              lineId: uid(),
              barcode: product.barcode,
              brand: product.brand,
              sizeLabel: product.size_label,
              quantity: 1,
            },
          ];
        });
        setInfo(`Added: ${product.brand} ${product.size_label}`);
      } catch (e) {
        if (e instanceof ApiError) {
          if (e.status === 404) {
            // Barcode not in catalog. Offer quick-add (issue #22, AC #5)
            // rather than flat-rejecting the line — receivers on the
            // counter need a way to register brand-new stock the owner
            // hasn't seen yet.
            setQuickAdd({ barcode: code });
            setQuickAddBrand("");
            setQuickAddSize("");
            setQuickAddError(null);
            setError(`Barcode not found in catalog: ${code}. Quick-add it?`);
          } else if (e.status === 0) setError("Network error — catalog lookup failed.");
          else setError(e.detail);
        } else {
          setError("Unknown error resolving barcode.");
        }
      }
    },
    [actingShopId]
  );

  // Quicksearch (issue #23) — when the receiver taps a match in the
  // search dropdown, add it exactly like a scan would. The component
  // does the filtering; we just normalise the picked product into the
  // same shape the scan resolver returns.
  const addByPick = useCallback(
    (product: CatalogProduct) => {
      setError(null);
      setInfo(null);
      setLines((prev) => {
        const existing = prev.find((l) => l.barcode === product.barcode);
        if (existing) {
          return prev.map((l) =>
            l.lineId === existing.lineId ? { ...l, quantity: l.quantity + 1 } : l
          );
        }
        return [
          ...prev,
          {
            lineId: uid(),
            barcode: product.barcode,
            brand: product.brand,
            sizeLabel: product.size_label,
            quantity: 1,
          },
        ];
      });
      setInfo(`Added: ${product.brand} ${product.size_label}`);
    },
    []
  );

  const handleSubmitBarcode = (e: React.FormEvent) => {
    e.preventDefault();
    void addByBarcode(barcode);
    setBarcode("");
  };

  const changeQty = (lineId: string, delta: number) => {
    setLines((prev) =>
      prev.map((l) =>
        l.lineId === lineId ? { ...l, quantity: Math.max(1, l.quantity + delta) } : l
      )
    );
  };

  const setLineQty = (lineId: string, qty: number) => {
    setLines((prev) =>
      prev.map((l) =>
        l.lineId === lineId ? { ...l, quantity: Math.max(1, Math.floor(qty)) } : l
      )
    );
  };

  const removeLine = (lineId: string) => {
    setLines((prev) => prev.filter((l) => l.lineId !== lineId));
  };

  const resetForm = () => {
    setLines([]);
    setReference("");
    setNotes("");
    setBarcode("");
  };

  const submitQuickAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickAdd) return;
    if (!quickAddBrand.trim() || !quickAddSize.trim()) {
      setQuickAddError("Brand and size are both required.");
      return;
    }
    setQuickAddBusy(true);
    setQuickAddError(null);
    try {
      // One idempotency key per open modal: a double-tap on "Add" returns
      // the same product instead of producing a duplicate row OR a
      // duplicate-error toast (D-v2-12, AC #5 / Story #16).
      const idemKey = `qa-r-${quickAdd.barcode}-${uid()}`;
      const product = await quickAddProduct(
        {
          barcode: quickAdd.barcode,
          brand: quickAddBrand.trim(),
          size_label: quickAddSize.trim(),
        },
        { idempotencyKey: idemKey, origin: "receiving" }
      );
      // Refresh the catalog so the next scan of this barcode resolves
      // instantly (the receiver will scan the same code into a Lot
      // line right after).
      invalidateCache();
      await prefetchCatalog(actingShopId);
      setCatalogReady(true);

      // Drop the new product into the lines table so the receiver can
      // immediately set its quantity and save the lot without an extra
      // scan.
      setLines((prev) => [
        ...prev,
        {
          lineId: uid(),
          barcode: product.barcode,
          brand: product.brand,
          sizeLabel: product.size_label,
          quantity: 1,
        },
      ]);
      setInfo(
        `Quick-added (pending — owner needs to set the price): ${product.brand} ${product.size_label}`
      );
      setQuickAdd(null);
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 409) {
          // Someone (probably the owner on another terminal) just
          // added this barcode. Re-resolve and add it to the lines.
          setQuickAddError("Someone already added this — refreshing.");
          setQuickAdd(null);
          void addByBarcode(quickAdd.barcode);
        } else if (e.status === 0) {
          setQuickAddError("Network error — quick-add failed. Try again.");
        } else {
          setQuickAddError(e.detail);
        }
      } else {
        setQuickAddError("Unknown error during quick-add.");
      }
    } finally {
      setQuickAddBusy(false);
    }
  };

  const cancelQuickAdd = () => {
    setQuickAdd(null);
    setQuickAddError(null);
    setQuickAddBrand("");
    setQuickAddSize("");
  };

  const save = async () => {
    setError(null);
    setInfo(null);
    if (lines.length === 0) {
      setError("Scan at least one product before saving.");
      return;
    }
    if (user?.role === "superadmin" && actingShopId === null) {
      setError("Pick a shop first (top of the sidebar).");
      return;
    }
    setBusy(true);
    try {
      const lot = await createLotSafe(
        {
          reference: reference.trim() || undefined,
          notes: notes.trim() || undefined,
          lines: lines.map((l) => ({ barcode: l.barcode, quantity: l.quantity })),
        },
        actingShopId
      );
      setLastLot(lot);
      resetForm();
      // Catalog's effective stock now reflects the lot — but the cached
      // product records don't carry stock (the backend computes it from
      // lots). Force a refresh so the next /products lookup is fresh.
      invalidateCache();
      void prefetchCatalog(actingShopId).then(() => setCatalogReady(true));
      setInfo(`Lot #${lot.id} saved with ${lot.lines.length} line(s).`);
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 400) setError(`Validation error: ${e.detail}`);
        else if (e.status === 404) setError("Unknown barcode in one of the lines.");
        else if (e.status === 0) setError("Network error — save failed.");
        else setError(e.detail);
      } else {
        setError("Unknown error saving lot.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-gutter lg:grid-cols-[2fr_1fr]">
      {/* LEFT — incoming lines */}
      <section className="flex flex-col gap-stack-gap rounded-lg bg-surface-container p-gutter">
        <header className="flex items-center justify-between">
          <h1 className="text-headline-md text-primary">Stock Receiving</h1>
          <div className="text-label-md text-on-surface-variant">
            {catalogReady ? "Catalog cached" : "Loading catalog…"}
          </div>
        </header>

        <form onSubmit={handleSubmitBarcode} className="flex gap-stack-gap">
          <input
            type="text"
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            placeholder="Scan or enter barcode"
            className="min-h-touchTarget flex-1 rounded-md border border-outline bg-surface px-stack-gap text-body-lg"
            autoFocus
          />
          <button
            type="submit"
            className="min-h-touchTarget rounded-md bg-accent px-gutter text-label-xl text-on-accent"
            disabled={!catalogReady}
          >
            ADD
          </button>
        </form>

        {/* Quicksearch (issue #23). Receiver types a brand or barcode
            substring; tapping a match adds it like a scan. */}
        <QuickSearch
          onPick={addByPick}
          placeholder="Search by name or barcode"
          ariaLabel="Quick-search products by name or barcode"
        />

        <ul className="flex flex-col gap-stack-gap">
          {lines.length === 0 && (
            <li className="rounded-md bg-surface p-stack-gap text-center text-on-surface-variant">
              No items yet. Scan a barcode to begin.
            </li>
          )}
          {lines.map((l) => (
            <li
              key={l.lineId}
              className="flex items-center justify-between rounded-md bg-surface px-stack-gap py-3 shadow-sm"
            >
              <div className="flex flex-col">
                <span className="text-label-xl text-on-surface">{l.brand}</span>
                <span className="text-label-md text-on-surface-variant">{l.sizeLabel}</span>
                <span className="font-mono text-label-md text-on-surface-variant">
                  {l.barcode}
                </span>
              </div>
              <div className="flex items-center gap-stack-gap">
                <button
                  type="button"
                  onClick={() => changeQty(l.lineId, -1)}
                  className="h-14 w-14 rounded-md bg-surface-container-high text-display-lg text-on-surface"
                  aria-label="Decrease quantity"
                >
                  −
                </button>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={l.quantity}
                  onChange={(e) => setLineQty(l.lineId, Number(e.target.value))}
                  className="h-14 w-20 rounded-md border border-outline bg-surface text-center font-mono text-headline-md"
                  aria-label="Quantity"
                />
                <button
                  type="button"
                  onClick={() => changeQty(l.lineId, +1)}
                  className="h-14 w-14 rounded-md bg-surface-container-high text-display-lg text-on-surface"
                  aria-label="Increase quantity"
                >
                  +
                </button>
                <button
                  type="button"
                  onClick={() => removeLine(l.lineId)}
                  className="h-14 w-14 rounded-md bg-error text-display-lg text-on-error"
                  aria-label="Remove line"
                >
                  ×
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* RIGHT — save action */}
      <aside className="flex flex-col gap-stack-gap rounded-lg bg-surface-container p-gutter">
        <h2 className="text-headline-md text-primary">Lot</h2>

        <label className="flex flex-col gap-1 text-label-md">
          Reference (optional)
          <input
            type="text"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            maxLength={100}
            className="min-h-touchTarget-sm rounded-md border border-outline bg-surface px-stack-gap text-body-md"
          />
        </label>
        <label className="flex flex-col gap-1 text-label-md">
          Notes (optional)
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={500}
            className="min-h-touchTarget-sm rounded-md border border-outline bg-surface px-stack-gap text-body-md"
          />
        </label>

        <div className="rounded-md bg-primary p-stack-gap text-on-primary">
          <div className="text-label-md uppercase">Lines</div>
          <div className="font-mono text-headline-md">{lines.length}</div>
          <div className="text-label-md uppercase">Total units</div>
          <div className="font-mono text-headline-md">
            {lines.reduce((acc, l) => acc + l.quantity, 0)}
          </div>
        </div>

        <button
          type="button"
          onClick={save}
          disabled={lines.length === 0 || busy}
          className="min-h-touchTarget rounded-md bg-accent text-display-lg text-on-accent disabled:opacity-50"
        >
          {busy ? "SAVING…" : "SAVE STOCK"}
        </button>

        {error && (
          <div role="alert" className="rounded-md bg-error px-stack-gap py-3 text-on-error">
            {error}
          </div>
        )}
        {info && (
          <div role="status" className="rounded-md bg-success px-stack-gap py-3 text-on-secondary">
            {info}
          </div>
        )}
      </aside>

      {/* Quick-add modal (issue #22). Shown when a scan misses the
          catalog so the receiver can register the brand-new product on
          the spot. Modal stays above the page scroll. */}
      {quickAdd && (
        <div
          className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 p-stack-gap"
          role="dialog"
          aria-modal="true"
          aria-labelledby="quick-add-title"
        >
          <form
            onSubmit={submitQuickAdd}
            className="flex w-full max-w-md flex-col gap-stack-gap rounded-lg bg-surface-container p-gutter"
          >
            <header className="flex items-start justify-between">
              <div>
                <h2 id="quick-add-title" className="text-headline-md text-primary">
                  Quick-add new product
                </h2>
                <p className="mt-1 text-label-md text-on-surface-variant">
                  This barcode isn't in the catalog. Register it as
                  <strong> pending</strong> — the owner will set the price
                  later. Stock you receive for it counts immediately.
                </p>
              </div>
              <button
                type="button"
                onClick={cancelQuickAdd}
                className="h-12 w-12 rounded-md bg-error text-display-lg text-on-error"
                aria-label="Cancel quick-add"
              >
                ×
              </button>
            </header>

            <div className="rounded-md bg-surface p-stack-gap text-label-md">
              <span className="text-on-surface-variant">Barcode</span>
              <div className="font-mono text-body-md">{quickAdd.barcode}</div>
            </div>

            <label className="flex flex-col gap-1 text-label-md">
              Brand
              <input
                type="text"
                value={quickAddBrand}
                onChange={(e) => setQuickAddBrand(e.target.value)}
                placeholder="e.g. Royal Stag"
                maxLength={200}
                autoFocus
                className="min-h-touchTarget-sm rounded-md border border-outline bg-surface px-stack-gap text-body-md"
              />
            </label>

            <label className="flex flex-col gap-1 text-label-md">
              Size
              <input
                type="text"
                value={quickAddSize}
                onChange={(e) => setQuickAddSize(e.target.value)}
                placeholder="e.g. 750ml"
                maxLength={64}
                className="min-h-touchTarget-sm rounded-md border border-outline bg-surface px-stack-gap text-body-md"
              />
            </label>

            {quickAddError && (
              <div
                role="alert"
                className="rounded-md bg-error px-stack-gap py-3 text-on-error"
              >
                {quickAddError}
              </div>
            )}

            <div className="flex gap-stack-gap">
              <button
                type="button"
                onClick={cancelQuickAdd}
                className="min-h-touchTarget flex-1 rounded-md bg-surface-container-high text-label-xl text-on-surface"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={quickAddBusy}
                className="min-h-touchTarget flex-1 rounded-md bg-accent text-display-lg text-on-accent disabled:opacity-50"
              >
                {quickAddBusy ? "ADDING…" : "ADD"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Lot result modal */}
      {lastLot && (
        <div
          className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 p-stack-gap"
          role="dialog"
          aria-modal="true"
        >
          <div className="flex max-h-[90vh] w-full max-w-lg flex-col gap-stack-gap overflow-y-auto rounded-lg bg-surface-container p-gutter">
            <header className="flex items-center justify-between">
              <h2 className="text-headline-md text-primary">Lot #{lastLot.id} saved</h2>
              <button
                type="button"
                onClick={() => setLastLot(null)}
                className="h-12 w-12 rounded-md bg-error text-display-lg text-on-error"
                aria-label="Close"
              >
                ×
              </button>
            </header>
            <div className="text-label-md text-on-surface-variant">
              {new Date(lastLot.received_at).toLocaleString()}
            </div>
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-outline text-label-md text-on-surface-variant">
                  <th className="py-2 text-left">Product</th>
                  <th className="py-2 text-right">Qty</th>
                </tr>
              </thead>
              <tbody>
                {lastLot.lines.map((l) => (
                  <tr key={l.id} className="border-b border-outline/40">
                    <td className="py-2">{l.product_id}</td>
                    <td className="py-2 text-right font-mono">{l.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}