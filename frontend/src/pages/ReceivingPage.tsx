import { useEffect, useMemo, useState, useCallback } from "react";
import { ApiError } from "../api/client";
import { invalidateCache, prefetchCatalog, type CatalogProduct } from "../api/catalog";
import { createLotSafe, type LotPublic } from "../api/lots";
import { listVendors, type VendorPublic } from "../api/vendors";
import { QuickSearch } from "../components/QuickSearch";
import { QuickAddModal } from "../components/QuickAddModal";
import { ScanSuccessOverlay } from "../components/ScanSuccessOverlay";
import { useBarcodeScanner } from "../hooks/useBarcodeScanner";
import { useQuickAdd } from "../hooks/useQuickAdd";
import { useAuth } from "../auth/AuthProvider";
import { useShopScope } from "../auth/ShopScopeProvider";

interface ReceivingLine {
  lineId: string;
  barcode: string;
  brand: string;
  sizeLabel: string;
  quantity: number;
  currentStock?: number;
}

interface ScanOverlayProduct {
  id: string;
  brand: string;
  sizeLabel: string;
}

interface PurchaseReviewState {
  vendorId: number | "";
  purchaseDate: string;
  vendorInvoiceNumber: string;
  invoiceValue: string;
  lineConditions: Record<string, number>;
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function localDateInputValue(): string {
  return new Date().toLocaleDateString("en-CA");
}

export function ReceivingPage() {
  const { user } = useAuth();
  const { actingShopId } = useShopScope();
  const [barcode, setBarcode] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<ReceivingLine[]>([]);
  const [vendors, setVendors] = useState<VendorPublic[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [catalogReady, setCatalogReady] = useState(false);
  const [lastLot, setLastLot] = useState<LotPublic | null>(null);
  const [scanOverlay, setScanOverlay] = useState<ScanOverlayProduct | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);

  const {
    quickAdd,
    openQuickAdd,
    closeQuickAdd,
    submitQuickAdd,
    busy: quickAddBusy,
    error: quickAddError,
  } = useQuickAdd({
    origin: "receiving",
    onResolved: (product) => {
      setCatalogReady(true);
      setLines((prev) => [
        ...prev,
        {
          lineId: uid(),
          barcode: product.barcode,
          brand: product.brand,
          sizeLabel: product.size_label,
          quantity: 1,
          currentStock: product.current_stock,
        },
      ]);
      setInfo(
        `Quick-added (pending - owner needs to set the price): ${product.brand} ${product.size_label}`
      );
    },
    onConflict: (missingBarcode) => {
      void addByBarcode(missingBarcode);
    },
  });

  useEffect(() => {
    setCatalogReady(false);
    prefetchCatalog(actingShopId)
      .then(() => setCatalogReady(true))
      .catch((e) => setError(`Catalog load failed: ${e instanceof Error ? e.message : e}`));
  }, [actingShopId]);

  useEffect(() => {
    void listVendors(actingShopId)
      .then((rows) => {
        setVendors(rows);
        setError(null);
      })
      .catch((e) => {
        setVendors([]);
        setError(e instanceof Error ? e.message : "Could not load vendors.");
      });
  }, [actingShopId]);

  useEffect(() => {
    if (!info) return;
    const timer = window.setTimeout(() => setInfo(null), 4000);
    return () => window.clearTimeout(timer);
  }, [info]);

  const addByBarcode = useCallback(
    async (raw: string, options: { showScanOverlay?: boolean } = {}) => {
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
              currentStock: product.current_stock,
            },
          ];
        });
        setInfo(`Added: ${product.brand} ${product.size_label}`);
        if (options.showScanOverlay) {
          setScanOverlay({
            id: uid(),
            brand: product.brand,
            sizeLabel: product.size_label,
          });
        }
      } catch (e) {
        if (e instanceof ApiError) {
          if (e.status === 404) {
            openQuickAdd(code);
            setError(`Barcode not found in catalog: ${code}. Quick-add it?`);
          } else if (e.status === 0) setError("Network error - catalog lookup failed.");
          else setError(e.detail);
        } else {
          setError("Unknown error resolving barcode.");
        }
      }
    },
    [actingShopId, openQuickAdd]
  );

  const addByPick = useCallback((product: CatalogProduct) => {
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
          currentStock: product.current_stock,
        },
      ];
    });
    setInfo(`Added: ${product.brand} ${product.size_label}`);
  }, []);

  const handleSubmitBarcode = (e: React.FormEvent) => {
    e.preventDefault();
    void addByBarcode(barcode);
    setBarcode("");
  };

  useBarcodeScanner({
    enabled: catalogReady && !quickAdd && !lastLot && !reviewOpen,
    onScan: (code) => void addByBarcode(code, { showScanOverlay: true }),
  });

  const dismissScanOverlay = useCallback(() => {
    setScanOverlay(null);
  }, []);

  const removeLine = (lineId: string) => {
    setLines((prev) => prev.filter((l) => l.lineId !== lineId));
  };

  const resetForm = () => {
    setLines([]);
    setReference("");
    setNotes("");
    setBarcode("");
  };

  const openReview = () => {
    setError(null);
    if (lines.length === 0) {
      setError("Scan at least one product before saving.");
      return;
    }
    if (user?.role === "superadmin" && actingShopId === null) {
      setError("Pick a shop first (top of the sidebar).");
      return;
    }
    if (vendors.length === 0) {
      setError("Add at least one active vendor before saving a lot.");
      return;
    }
    setReviewOpen(true);
  };

  const handleFinalSave = async (review: PurchaseReviewState) => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const lot = await createLotSafe(
        {
          vendor_id: Number(review.vendorId),
          purchase_date: review.purchaseDate,
          vendor_invoice_number: review.vendorInvoiceNumber.trim(),
          invoice_value: review.invoiceValue.trim(),
          reference: reference.trim() || undefined,
          notes: notes.trim() || undefined,
          lines: lines.map((line) => ({
            barcode: line.barcode,
            quantity: line.quantity,
            good_condition_quantity: review.lineConditions[line.lineId] ?? line.quantity,
          })),
        },
        actingShopId
      );
      setLastLot(lot);
      setReviewOpen(false);
      resetForm();
      invalidateCache();
      void prefetchCatalog(actingShopId).then(() => setCatalogReady(true));
      setInfo(`Lot #${lot.id} saved with ${lot.lines.length} line(s).`);
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 400) setError(`Validation error: ${e.detail}`);
        else if (e.status === 404) setError("Unknown vendor or barcode in one of the lines.");
        else if (e.status === 0) setError("Network error - save failed.");
        else setError(e.detail);
      } else {
        setError("Unknown error saving lot.");
      }
    } finally {
      setBusy(false);
    }
  };

  const totalUnits = useMemo(() => lines.reduce((acc, line) => acc + line.quantity, 0), [lines]);

  return (
    <div className="grid gap-gutter lg:grid-cols-[2fr_1fr]">
      {scanOverlay && (
        <ScanSuccessOverlay
          key={scanOverlay.id}
          brand={scanOverlay.brand}
          sizeLabel={scanOverlay.sizeLabel}
          onDone={dismissScanOverlay}
        />
      )}

      <section className="flex flex-col gap-stack-gap rounded-lg bg-surface-container p-gutter">
        <header className="flex items-center justify-between">
          <h1 className="text-headline-md text-primary">Stock Receiving</h1>
          <div className="text-label-md text-on-surface-variant">
            {catalogReady ? "Catalog cached" : "Loading catalog..."}
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
            className="min-h-touchTarget rounded-md bg-action px-gutter text-label-xl text-on-action"
            disabled={!catalogReady}
          >
            ADD
          </button>
        </form>

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
          {lines.map((line) => (
            <li
              key={line.lineId}
              className="flex items-center justify-between rounded-md bg-surface px-stack-gap py-3 shadow-sm"
            >
              <div className="flex flex-col">
                <span className="text-label-xl text-on-surface">{line.brand}</span>
                <span className="text-label-md text-on-surface-variant">{line.sizeLabel}</span>
                <span className="font-mono text-label-md text-on-surface-variant">{line.barcode}</span>
                <span className="text-label-md text-on-surface-variant">
                  Received qty: <span className="font-mono">{line.quantity}</span>
                </span>
                <span className="text-label-md text-on-surface-variant">
                  On shelf: <span className="font-mono">{line.currentStock ?? "—"}</span>
                </span>
              </div>
              <button
                type="button"
                onClick={() => removeLine(line.lineId)}
                className="flex h-14 w-14 items-center justify-center rounded-md bg-error text-[32px] font-black leading-none text-on-error"
                aria-label="Remove line"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      </section>

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
          <div className="font-mono text-headline-md">{totalUnits}</div>
        </div>

        <button
          type="button"
          onClick={openReview}
          disabled={lines.length === 0 || busy}
          className="min-h-touchTarget rounded-md bg-action text-headline-md font-bold text-on-action disabled:opacity-50"
        >
          Review & Save
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

      {quickAdd && (
        <div
          className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 p-stack-gap"
          role="dialog"
          aria-modal="true"
          aria-labelledby="quick-add-title"
        >
          <QuickAddModal
            barcode={quickAdd.barcode}
            busy={quickAddBusy}
            error={quickAddError}
            onCancel={closeQuickAdd}
            onSubmit={({ brand, size }) => {
              void submitQuickAdd({ brand, size });
            }}
          />
        </div>
      )}

      {reviewOpen && (
        <PurchaseReviewModal
          vendors={vendors}
          lines={lines}
          busy={busy}
          onCancel={() => setReviewOpen(false)}
          onSubmit={(review) => {
            void handleFinalSave(review);
          }}
        />
      )}

      {lastLot && (
        <div
          className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 p-stack-gap"
          role="dialog"
          aria-modal="true"
        >
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col gap-stack-gap overflow-y-auto rounded-lg bg-surface-container p-gutter">
            <header className="flex items-center justify-between">
              <h2 className="text-headline-md text-primary">Lot #{lastLot.id} saved</h2>
              <button
                type="button"
                onClick={() => setLastLot(null)}
                className="flex h-12 w-12 items-center justify-center rounded-md bg-error text-[28px] font-black leading-none text-on-error"
                aria-label="Close"
              >
                ×
              </button>
            </header>
            <div className="grid gap-2 text-label-md text-on-surface-variant md:grid-cols-2">
              <div>Vendor: {lastLot.vendor.name}</div>
              <div>Purchase date: {lastLot.purchase_date}</div>
              <div>Vendor invoice: {lastLot.vendor_invoice_number}</div>
              <div>Invoice value: Rs {lastLot.invoice_value}</div>
            </div>
            <div className="text-label-md text-on-surface-variant">
              {new Date(lastLot.received_at).toLocaleString()}
            </div>
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-outline text-label-md text-on-surface-variant">
                  <th className="py-2 text-left">Product</th>
                  <th className="py-2 text-right">Received</th>
                  <th className="py-2 text-right">Good</th>
                  <th className="py-2 text-right">Breakage</th>
                </tr>
              </thead>
              <tbody>
                {lastLot.lines.map((line) => (
                  <tr key={line.id} className="border-b border-outline/40">
                    <td className="py-2">
                      {line.product_brand} {line.product_size_label}
                    </td>
                    <td className="py-2 text-right font-mono">{line.quantity}</td>
                    <td className="py-2 text-right font-mono">{line.good_condition_quantity}</td>
                    <td className="py-2 text-right font-mono">{line.breakage_quantity}</td>
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

function PurchaseReviewModal({
  vendors,
  lines,
  busy,
  onCancel,
  onSubmit,
}: {
  vendors: VendorPublic[];
  lines: ReceivingLine[];
  busy: boolean;
  onCancel: () => void;
  onSubmit: (review: PurchaseReviewState) => void;
}) {
  const defaultVendorId = vendors.find((vendor) => vendor.is_active)?.id ?? vendors[0]?.id;
  const [vendorId, setVendorId] = useState<number | "">(defaultVendorId ?? "");
  const [purchaseDate, setPurchaseDate] = useState(localDateInputValue());
  const [vendorInvoiceNumber, setVendorInvoiceNumber] = useState("");
  const [invoiceValue, setInvoiceValue] = useState("");
  const [lineConditions, setLineConditions] = useState<Record<string, number>>(() =>
    Object.fromEntries(lines.map((line) => [line.lineId, line.quantity]))
  );
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    setLineConditions(Object.fromEntries(lines.map((line) => [line.lineId, line.quantity])));
  }, [lines]);

  useEffect(() => {
    if (vendorId === "" && defaultVendorId !== undefined) {
      setVendorId(defaultVendorId);
    }
  }, [defaultVendorId, vendorId]);

  const updateCondition = (lineId: string, value: number) => {
    setLineConditions((current) => ({ ...current, [lineId]: value }));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    if (vendorId === "") {
      setLocalError("Pick a vendor.");
      return;
    }
    if (!purchaseDate) {
      setLocalError("Pick a purchase date.");
      return;
    }
    if (!vendorInvoiceNumber.trim()) {
      setLocalError("Enter the vendor invoice number.");
      return;
    }
    if (!invoiceValue.trim() || Number(invoiceValue) <= 0) {
      setLocalError("Enter a valid invoice value.");
      return;
    }
    for (const line of lines) {
      const good = lineConditions[line.lineId] ?? 0;
      if (good < 0 || good > line.quantity) {
        setLocalError("Good-condition quantity cannot exceed received quantity.");
        return;
      }
    }
    onSubmit({
      vendorId,
      purchaseDate,
      vendorInvoiceNumber,
      invoiceValue,
      lineConditions,
    });
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-stack-gap"
      role="dialog"
      aria-modal="true"
      aria-labelledby="purchase-review-title"
    >
      <form
        onSubmit={submit}
        className="flex max-h-[92vh] w-full max-w-4xl flex-col gap-stack-gap overflow-y-auto rounded-lg bg-surface-container p-gutter"
      >
        <header className="flex items-center justify-between">
          <h2 id="purchase-review-title" className="text-headline-md text-primary">
            Review purchase details
          </h2>
          <button
            type="button"
            onClick={onCancel}
            className="flex h-12 w-12 items-center justify-center rounded-md bg-error text-[28px] font-black leading-none text-on-error"
            aria-label="Close purchase review"
          >
            ×
          </button>
        </header>

        <div className="grid gap-stack-gap md:grid-cols-2">
          <label className="flex flex-col gap-1 text-label-md">
            Vendor
            <select
              value={vendorId}
              onChange={(e) =>
                setVendorId(e.target.value === "" ? "" : Number.parseInt(e.target.value, 10))
              }
              className="min-h-touchTarget-sm rounded-md border border-outline bg-surface px-stack-gap text-body-md"
            >
              <option value="">Select vendor</option>
              {vendors.map((vendor) => (
                <option key={vendor.id} value={vendor.id}>
                  {vendor.name}
                  {!vendor.is_active ? " (inactive)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-label-md">
            Purchase date
            <input
              type="date"
              value={purchaseDate}
              onChange={(e) => setPurchaseDate(e.target.value)}
              className="min-h-touchTarget-sm rounded-md border border-outline bg-surface px-stack-gap text-body-md"
            />
          </label>
          <label className="flex flex-col gap-1 text-label-md">
            Vendor invoice number
            <input
              type="text"
              value={vendorInvoiceNumber}
              onChange={(e) => setVendorInvoiceNumber(e.target.value)}
              className="min-h-touchTarget-sm rounded-md border border-outline bg-surface px-stack-gap text-body-md"
            />
          </label>
          <label className="flex flex-col gap-1 text-label-md">
            Invoice value
            <input
              type="number"
              min="0"
              step="0.01"
              value={invoiceValue}
              onChange={(e) => setInvoiceValue(e.target.value)}
              className="min-h-touchTarget-sm rounded-md border border-outline bg-surface px-stack-gap text-body-md"
            />
          </label>
        </div>

        <div className="overflow-hidden rounded-md border border-outline bg-surface">
          <div className="border-b border-outline px-stack-gap py-2 text-label-md text-on-surface-variant">
            Good-condition quantity is the only editable line-level field.
          </div>
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-outline text-label-md text-on-surface-variant">
                <th className="px-stack-gap py-2 text-left">Product</th>
                <th className="px-stack-gap py-2 text-right">Received</th>
                <th className="px-stack-gap py-2 text-right">Good</th>
                <th className="px-stack-gap py-2 text-right">Breakage</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => {
                const good = lineConditions[line.lineId] ?? line.quantity;
                return (
                  <tr key={line.lineId} className="border-b border-outline/40">
                    <td className="px-stack-gap py-2">
                      <div className="font-medium text-on-surface">{line.brand}</div>
                      <div className="text-label-md text-on-surface-variant">{line.sizeLabel}</div>
                      <div className="font-mono text-label-md text-on-surface-variant">
                        {line.barcode}
                      </div>
                    </td>
                    <td className="px-stack-gap py-2 text-right font-mono">{line.quantity}</td>
                    <td className="px-stack-gap py-2 text-right">
                      <input
                        type="number"
                        min="0"
                        max={line.quantity}
                        value={good}
                        onChange={(e) =>
                          updateCondition(
                            line.lineId,
                            Math.max(0, Math.floor(Number(e.target.value || 0)))
                          )
                        }
                        className="w-24 rounded-md border border-outline bg-surface px-2 py-1 text-right font-mono"
                      />
                    </td>
                    <td className="px-stack-gap py-2 text-right font-mono">{line.quantity - good}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {localError && (
          <div role="alert" className="rounded-md bg-error px-stack-gap py-3 text-on-error">
            {localError}
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-stack-gap">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-touchTarget-sm rounded-md bg-surface-container-high px-gutter text-label-md"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="min-h-touchTarget-sm rounded-md bg-action px-gutter text-label-md text-on-action disabled:opacity-50"
          >
            {busy ? "Saving..." : "Confirm save"}
          </button>
        </div>
      </form>
    </div>
  );
}
