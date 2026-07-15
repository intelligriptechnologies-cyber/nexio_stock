import { useEffect, useMemo, useState, useCallback } from "react";
import { ApiError } from "../api/client";
import { invalidateCache, prefetchCatalog, type CatalogProduct } from "../api/catalog";
import { createLotSafe, type LotPublic } from "../api/lots";
import { notifyApprovalsChanged } from "../api/approvals-events";
import { listVendors, type VendorPublic } from "../api/vendors";
import { getMyShop } from "../api/shops";
import { FocusedModeActions } from "../components/FocusedModeActions";
import { QuickSearch } from "../components/QuickSearch";
import { QuickAddModal } from "../components/QuickAddModal";
import { ModalDialog } from "../components/ModalDialog";
import { ScanSuccessOverlay } from "../components/ScanSuccessOverlay";
import { useBarcodeScanner } from "../hooks/useBarcodeScanner";
import { useQuickAdd } from "../hooks/useQuickAdd";
import { useAuth } from "../auth/AuthProvider";
import { useShopScope } from "../auth/ShopScopeProvider";
import { PackagePlus, ScanLine, X, Trash2, CheckCircle2, Save, Calendar, FileDigit, IndianRupee } from "lucide-react";

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
  const [vendorLinkEnabled, setVendorLinkEnabled] = useState(true);
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
          `Quick-added to stock inward (pending approval): ${product.brand} ${product.size_label}`
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
    let cancelled = false;
    if (user?.role === "superadmin" && actingShopId == null) {
      setVendorLinkEnabled(true);
      setVendors([]);
      return () => {
        cancelled = true;
      };
    }
    void getMyShop(user?.role === "superadmin" ? actingShopId : undefined)
      .then((shop) => {
        if (cancelled) return;
        setVendorLinkEnabled(shop.receiving_vendor_link_enabled);
      })
      .catch(() => {
        if (!cancelled) setVendorLinkEnabled(true);
      });
    return () => {
      cancelled = true;
    };
  }, [actingShopId, user?.role]);

  useEffect(() => {
    if (user?.role === "superadmin" && actingShopId == null) {
      setVendors([]);
      return;
    }
    if (!vendorLinkEnabled) {
      setVendors([]);
      return;
    }
    void listVendors(actingShopId)
      .then((rows) => {
        setVendors(rows);
        setError(null);
      })
      .catch((e) => {
        setVendors([]);
        setError(e instanceof Error ? e.message : "Could not load vendors.");
      });
  }, [actingShopId, vendorLinkEnabled]);

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

  const changeLineQuantity = (lineId: string, delta: number) => {
    setLines((prev) =>
      prev.map((line) =>
        line.lineId === lineId
          ? { ...line, quantity: Math.max(1, line.quantity + delta) }
          : line
      )
    );
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
    if (vendorLinkEnabled && vendors.length === 0) {
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
          ...(vendorLinkEnabled
            ? {
                vendor_id: Number(review.vendorId),
                purchase_date: review.purchaseDate,
                vendor_invoice_number: review.vendorInvoiceNumber.trim(),
                invoice_value: review.invoiceValue.trim(),
              }
            : {}),
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
      notifyApprovalsChanged();
      setInfo(`Inward #${lot.id} submitted with ${lot.lines.length} line(s).`);
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
    <div className="grid gap-8 font-sans lg:grid-cols-[2fr_1fr]">
      {scanOverlay && (
        <ScanSuccessOverlay
          key={scanOverlay.id}
          brand={scanOverlay.brand}
          sizeLabel={scanOverlay.sizeLabel}
          onDone={dismissScanOverlay}
        />
      )}

      <section className="flex flex-col gap-6 rounded-xl border border-slate-200/50 bg-white/60 p-8 shadow-[0_8px_30px_rgb(0,0,0,0.02)] backdrop-blur-xl">
        <header className="flex items-center justify-between">
          <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight text-slate-900">
            <PackagePlus className="h-8 w-8 text-action" /> Stock Inward
          </h1>
          <div className="flex flex-col items-end gap-2">
            <FocusedModeActions />
            <div className="flex items-center gap-2 text-sm font-medium text-slate-500">
              {catalogReady ? (
                <><CheckCircle2 className="h-4 w-4 text-emerald-500" /> Catalog ready</>
              ) : (
                "Loading catalog..."
              )}
            </div>
          </div>
        </header>

        <form onSubmit={handleSubmitBarcode} className="flex gap-4">
          <div className="relative flex-1">
            <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
              <ScanLine className="h-5 w-5 text-slate-400" />
            </div>
            <input
              type="text"
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              placeholder="Scan or enter barcode"
              className="h-14 w-full rounded-xl border border-slate-200 bg-white/50 pl-11 pr-4 text-lg font-medium text-slate-700 shadow-sm outline-none transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:bg-white focus:border-action focus:ring-2 focus:ring-action/20"
              autoFocus
            />
          </div>
          <button
            type="submit"
            className="flex h-14 items-center justify-center rounded-xl bg-action px-8 text-sm font-bold tracking-wide text-white shadow-sm transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[var(--color-action)]/30 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50"
            disabled={!catalogReady}
          >
            ADD
          </button>
        </form>

        <div className="rounded-xl border border-slate-200/50 bg-white/50 p-1 shadow-sm">
          <QuickSearch
            onPick={addByPick}
            placeholder="Search by name or barcode"
            ariaLabel="Quick-search products by name or barcode"
          />
        </div>

        <ul className="mt-4 flex flex-col gap-3">
          {lines.length === 0 && (
            <li className="rounded-xl border border-dashed border-slate-300 py-12 text-center text-sm font-medium text-slate-500">
              No items yet. Scan a barcode to begin.
            </li>
          )}
          {lines.map((line) => (
            <li
              key={line.lineId}
              className="group flex flex-col gap-4 rounded-xl border border-slate-200/60 bg-white p-4 shadow-sm transition-colors duration-200 hover:border-slate-300 hover:bg-slate-50/50 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex flex-col gap-0.5">
                <span className="text-base font-semibold text-slate-900">{line.brand}</span>
                <span className="text-sm font-medium text-slate-500">{line.sizeLabel}</span>
                <span className="mt-1 font-mono text-xs text-slate-400">{line.barcode}</span>
                <span className="mt-3 inline-flex w-fit items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold tracking-wide text-slate-600">
                  On shelf: <span className="ml-1 font-mono text-slate-900">{line.currentStock ?? "—"}</span>
                </span>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => changeLineQuantity(line.lineId, -1)}
                  className="app-stepper-button"
                  aria-label="Decrease quantity"
                >
                  -
                </button>
                <input
                  type="number"
                  min={1}
                  value={line.quantity}
                  onChange={(e) => {
                    const next = Math.max(1, Math.floor(Number(e.target.value || 1)));
                    setLines((prev) =>
                      prev.map((row) =>
                        row.lineId === line.lineId ? { ...row, quantity: next } : row
                      )
                    );
                  }}
                  onFocus={(e) => e.currentTarget.select()}
                  className="h-11 w-16 rounded-xl border-none bg-slate-50 text-center font-mono text-lg font-semibold text-slate-900 shadow-inner outline-none ring-1 ring-inset ring-slate-200 focus:ring-2 focus:ring-action disabled:opacity-50"
                  aria-label="Quantity"
                />
                <button
                  type="button"
                  onClick={() => changeLineQuantity(line.lineId, +1)}
                  className="app-stepper-button"
                  aria-label="Increase quantity"
                >
                  +
                </button>
                <button
                  type="button"
                  onClick={() => removeLine(line.lineId)}
                  className="flex h-10 w-10 items-center justify-center rounded-lg bg-white text-red-500 shadow-sm ring-1 ring-slate-200 transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:bg-red-50 hover:text-red-600 hover:ring-red-200 active:scale-[0.97]"
                  aria-label="Remove line"
                >
                  <Trash2 className="h-5 w-5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <aside className="flex h-fit flex-col gap-6 rounded-xl border border-slate-200/50 bg-white/60 p-8 shadow-[0_8px_30px_rgb(0,0,0,0.02)] backdrop-blur-xl">
        <h2 className="text-xl font-semibold tracking-tight text-slate-900">Inward Summary</h2>

        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Reference (optional)
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              maxLength={100}
              className="h-11 w-full rounded-xl border border-slate-200 bg-white/50 px-4 text-sm font-medium text-slate-700 shadow-sm outline-none transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:bg-white focus-visible:ring-2 focus-visible:ring-action/40 focus-visible:border-action"
            />
          </label>
        </div>

        <div className="flex gap-4 rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200/50">
          <div className="flex-1">
            <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">Lines</div>
            <div className="mt-1 font-mono text-2xl font-bold text-slate-900">{lines.length}</div>
          </div>
          <div className="w-px bg-slate-200"></div>
          <div className="flex-1">
            <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">Total units</div>
            <div className="mt-1 font-mono text-2xl font-bold text-slate-900">{totalUnits}</div>
          </div>
        </div>

        <button
          type="button"
          onClick={openReview}
          disabled={lines.length === 0 || busy}
          className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-action px-6 text-sm font-bold tracking-wide text-white shadow-sm transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[var(--color-action)]/30 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50"
        >
          <Save className="h-5 w-5" /> Review & Submit
        </button>

        {error && (
          <div role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600 ring-1 ring-red-200">
            {error}
          </div>
        )}
        {info && (
          <div role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-600 ring-1 ring-emerald-200">
            {info}
          </div>
        )}
      </aside>

      {quickAdd && (
        <ModalDialog labelledBy="quick-add-title" onDismiss={closeQuickAdd}>
          <QuickAddModal
            barcode={quickAdd.barcode}
            busy={quickAddBusy}
            error={quickAddError}
            onCancel={closeQuickAdd}
            onSubmit={({ brand, size }) => {
              void submitQuickAdd({ brand, size });
            }}
          />
        </ModalDialog>
      )}

      {reviewOpen && (
        <PurchaseReviewModal
          vendors={vendors}
          vendorLinkEnabled={vendorLinkEnabled}
          lines={lines}
          busy={busy}
          notes={notes}
          onNotes={setNotes}
          onCancel={() => setReviewOpen(false)}
          onSubmit={(review) => {
            void handleFinalSave(review);
          }}
        />
      )}

      {lastLot && (
        <ModalDialog onDismiss={() => setLastLot(null)}>
          <div className="animate-modal-in flex max-h-[90vh] w-full max-w-2xl flex-col gap-6 overflow-y-auto rounded-xl bg-white p-8 shadow-2xl">
            <header className="flex items-center justify-between border-b border-slate-100 pb-4">
              <h2 className="flex items-center gap-3 text-2xl font-semibold tracking-tight text-slate-900">
                <CheckCircle2 className="h-8 w-8 text-emerald-500" /> Inward #{lastLot.id} submitted
              </h2>
              <button
                type="button"
                onClick={() => setLastLot(null)}
                className="flex h-10 w-10 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                aria-label="Close"
              >
                <X className="h-6 w-6" />
              </button>
            </header>
            
            <div className="grid gap-4 rounded-2xl bg-slate-50 p-6 ring-1 ring-slate-200/50 md:grid-cols-2">
              {vendorLinkEnabled ? (
                <>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                      Vendor
                    </div>
                    <div className="mt-1 font-medium text-slate-900">
                      {lastLot.vendor?.name ?? "Unknown vendor"}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                      Purchase date
                    </div>
                    <div className="mt-1 font-medium text-slate-900">{lastLot.purchase_date}</div>
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                      Vendor invoice
                    </div>
                    <div className="mt-1 font-mono font-medium text-slate-900">
                      {lastLot.vendor_invoice_number}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                      Invoice value
                    </div>
                    <div className="mt-1 font-mono font-medium text-slate-900">
                      Rs {lastLot.invoice_value}
                    </div>
                  </div>
                </>
              ) : (
                <div className="md:col-span-2">
                  <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                    Inward details
                  </div>
                  <div className="mt-1 text-sm font-medium text-slate-600">
                    Vendor link disabled. Hidden placeholder inward details were stored with this request.
                  </div>
                </div>
              )}
              <div className="md:col-span-2">
                <div className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">
                  Recorded at
                </div>
                <div className="mt-1 text-sm font-medium text-slate-600">
                  {new Date(lastLot.received_at).toLocaleString()}
                </div>
              </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-slate-200">
              <table className="app-list-table">
                <thead className="bg-slate-50/80 text-[11px] uppercase tracking-widest text-slate-500">
                  <tr>
                    <th className="px-6 py-4 font-semibold">Product</th>
                    <th className="px-6 py-4 text-right font-semibold">Received</th>
                    <th className="px-6 py-4 text-right font-semibold">Good</th>
                    <th className="px-6 py-4 text-right font-semibold">Breakage</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {lastLot.lines.map((line) => (
                    <tr key={line.id} className="bg-white">
                      <td className="px-6 py-3">
                        <div className="font-medium text-slate-900">{line.product_brand}</div>
                        <div className="text-slate-500">{line.product_size_label}</div>
                      </td>
                      <td className="px-6 py-3 text-right font-mono font-medium text-slate-900">{line.quantity}</td>
                      <td className="px-6 py-3 text-right font-mono font-medium text-emerald-600">{line.good_condition_quantity}</td>
                      <td className="px-6 py-3 text-right font-mono font-medium text-red-500">{line.breakage_quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </ModalDialog>
      )}
    </div>
  );
}

function PurchaseReviewModal({
  vendors,
  vendorLinkEnabled,
  lines,
  busy,
  notes,
  onNotes,
  onCancel,
  onSubmit,
}: {
  vendors: VendorPublic[];
  vendorLinkEnabled: boolean;
  lines: ReceivingLine[];
  busy: boolean;
  notes: string;
  onNotes: (value: string) => void;
  onCancel: () => void;
  onSubmit: (review: PurchaseReviewState) => void;
}) {
  const defaultVendorId = vendorLinkEnabled
    ? vendors.find((vendor) => vendor.is_active)?.id ?? vendors[0]?.id
    : undefined;
  const [vendorId, setVendorId] = useState<number | "">(defaultVendorId ?? "");
  const [purchaseDate, setPurchaseDate] = useState(localDateInputValue());
  const [vendorInvoiceNumber, setVendorInvoiceNumber] = useState("");
  const [invoiceValue, setInvoiceValue] = useState("");
  const [lineConditions, setLineConditions] = useState<Record<string, number>>(() =>
    Object.fromEntries(lines.map((line) => [line.lineId, line.quantity]))
  );
  const [localError, setLocalError] = useState<string | null>(null);
  const breakageExists = lines.some((line) => (lineConditions[line.lineId] ?? line.quantity) < line.quantity);

  useEffect(() => {
    setLineConditions(Object.fromEntries(lines.map((line) => [line.lineId, line.quantity])));
  }, [lines]);

  useEffect(() => {
    if (!vendorLinkEnabled) {
      setVendorId("");
      return;
    }
    if (vendorId === "" && defaultVendorId !== undefined) {
      setVendorId(defaultVendorId);
    }
  }, [defaultVendorId, vendorId, vendorLinkEnabled]);

  const updateCondition = (lineId: string, value: number) => {
    setLineConditions((current) => ({ ...current, [lineId]: value }));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    if (vendorLinkEnabled) {
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
    }
    for (const line of lines) {
      const good = lineConditions[line.lineId] ?? 0;
      if (good < 0 || good > line.quantity) {
        setLocalError("Good-condition quantity cannot exceed received quantity.");
        return;
      }
    }
    if (breakageExists && !notes.trim()) {
      setLocalError("Add notes when any breakage exists.");
      return;
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
    <ModalDialog labelledBy="purchase-review-title" onDismiss={onCancel}>
      <form
        onSubmit={submit}
        className="animate-modal-in flex max-h-[92vh] w-full max-w-4xl flex-col gap-6 overflow-y-auto rounded-xl bg-white p-8 shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-slate-100 pb-4">
          <h2 id="purchase-review-title" className="flex items-center gap-3 text-2xl font-semibold tracking-tight text-slate-900">
            <Save className="h-6 w-6 text-action" /> Review purchase details
          </h2>
          <button
            type="button"
            onClick={onCancel}
            className="flex h-10 w-10 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close purchase review"
          >
            <X className="h-6 w-6" />
          </button>
        </header>

        {vendorLinkEnabled ? (
          <div className="grid gap-6 md:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
              Vendor
              <select
                value={vendorId}
                onChange={(e) =>
                  setVendorId(e.target.value === "" ? "" : Number.parseInt(e.target.value, 10))
                }
                className="h-11 w-full rounded-xl border border-slate-200 bg-white/50 px-4 text-sm font-medium text-slate-700 shadow-sm outline-none transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:bg-white focus-visible:ring-2 focus-visible:ring-action/40 focus-visible:border-action"
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
            <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
              <span className="flex items-center gap-1.5">
                <Calendar className="h-4 w-4" /> Purchase date
              </span>
              <input
                type="date"
                value={purchaseDate}
                onChange={(e) => setPurchaseDate(e.target.value)}
                className="h-11 w-full rounded-xl border border-slate-200 bg-white/50 px-4 text-sm font-medium text-slate-700 shadow-sm outline-none transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:bg-white focus-visible:ring-2 focus-visible:ring-action/40 focus-visible:border-action"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
              <span className="flex items-center gap-1.5">
                <FileDigit className="h-4 w-4" /> Vendor invoice number
              </span>
              <input
                type="text"
                value={vendorInvoiceNumber}
                onChange={(e) => setVendorInvoiceNumber(e.target.value)}
                className="h-11 w-full rounded-xl border border-slate-200 bg-white/50 px-4 text-sm font-medium text-slate-700 shadow-sm outline-none transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:bg-white focus-visible:ring-2 focus-visible:ring-action/40 focus-visible:border-action"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
              <span className="flex items-center gap-1.5">
                <IndianRupee className="h-4 w-4" /> Invoice value
              </span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={invoiceValue}
                onChange={(e) => setInvoiceValue(e.target.value)}
                className="h-11 w-full rounded-xl border border-slate-200 bg-white/50 px-4 text-sm font-medium text-slate-700 shadow-sm outline-none transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:bg-white focus-visible:ring-2 focus-visible:ring-action/40 focus-visible:border-action"
              />
            </label>
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 py-5 text-sm text-slate-600">
            Vendor linking is disabled for this shop. The lot will save with hidden placeholder
            receiving details.
          </div>
        )}

        <div className="overflow-hidden rounded-2xl border border-slate-200">
          <div className="border-b border-slate-200 bg-slate-50/80 px-6 py-3 text-[11px] font-medium uppercase tracking-widest text-slate-500">
            Use the stepper to adjust good-condition quantity for each line.
          </div>
          <table className="app-list-table">
            <thead className="bg-slate-50/80 text-[11px] uppercase tracking-widest text-slate-500">
              <tr>
                <th className="px-6 py-4 font-semibold">Product</th>
                <th className="px-6 py-4 text-right font-semibold">Received</th>
                <th className="px-6 py-4 text-right font-semibold">Good</th>
                <th className="px-6 py-4 text-right font-semibold">Breakage</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lines.map((line) => {
                const good = lineConditions[line.lineId] ?? line.quantity;
                return (
                  <tr key={line.lineId} className="bg-white">
                    <td className="px-6 py-4">
                      <div className="font-medium text-slate-900">{line.brand}</div>
                      <div className="text-slate-500">{line.sizeLabel}</div>
                      <div className="mt-1 font-mono text-xs text-slate-400">
                        {line.barcode}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right font-mono font-medium text-slate-900">{line.quantity}</td>
                    <td className="px-6 py-4 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => updateCondition(line.lineId, Math.max(0, good - 1))}
                          className="app-stepper-button app-stepper-button--sm"
                          aria-label="Decrease good quantity"
                        >
                          -
                        </button>
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
                          className="w-20 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-right font-mono text-sm font-medium shadow-sm transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:border-slate-300 focus-visible:ring-2 focus-visible:ring-action/40 focus-visible:border-action outline-none"
                          aria-label="Good-condition quantity"
                        />
                        <button
                          type="button"
                          onClick={() => updateCondition(line.lineId, Math.min(line.quantity, good + 1))}
                          className="app-stepper-button app-stepper-button--sm"
                          aria-label="Increase good quantity"
                        >
                          +
                        </button>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-right font-mono font-medium text-slate-500">{line.quantity - good}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
          Notes {breakageExists ? "(required when breakage exists)" : "(optional)"}
          <textarea
            value={notes}
            onChange={(e) => onNotes(e.target.value)}
            maxLength={500}
            rows={3}
            className="w-full rounded-xl border border-slate-200 bg-white/50 p-4 text-sm font-medium normal-case text-slate-700 shadow-sm outline-none transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:bg-white focus-visible:ring-2 focus-visible:ring-action/40 focus-visible:border-action"
            placeholder={breakageExists ? "Explain any breakage before saving." : "Optional notes for this lot."}
          />
        </label>

        {localError && (
          <div role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600 ring-1 ring-red-200">
            {localError}
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-3 pt-4">
          <button
            type="button"
            onClick={onCancel}
            className="flex h-11 items-center justify-center rounded-xl bg-white px-6 text-sm font-semibold text-slate-600 shadow-sm ring-1 ring-slate-200 transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:bg-slate-50 hover:text-slate-900 active:scale-[0.97]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="flex h-11 items-center justify-center rounded-xl bg-action px-8 text-sm font-bold tracking-wide text-white shadow-sm transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[var(--color-action)]/30 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50"
          >
            {busy ? "Saving..." : "Confirm save"}
          </button>
        </div>
      </form>
    </ModalDialog>
  );
}
