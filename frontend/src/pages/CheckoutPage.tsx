import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { ApiError, toUserMessage } from "../api/client";
import {
  prefetchCatalog,
  resolveBarcode,
  type CatalogProduct,
  invalidateCache,
  hydrateCatalog,
} from "../api/catalog";
import {
  finalizeCheckout,
  downloadInvoicePdf,
  getInvoice,
  validateCheckoutCart,
  type PaymentMode,
  type InvoicePublic,
} from "../api/checkout";
import { listQueued, clearQueued } from "../api/finalize-queue";
import {
  extendOfflineSession,
  offlineItemToCatalogProduct,
  startOfflineSession,
  syncOfflineSession,
} from "../api/offline-sessions";
import {
  addOfflineReceipt,
  clearOfflineSessionData,
  listOfflineReceipts,
  loadOpenOfflineSession,
  saveStartedOfflineSession,
  saveStoredOfflineSession,
  updateStoredOfflineSession,
  type StoredOfflineSession,
} from "../api/offline-session-store";
import { QuickSearch } from "../components/QuickSearch";
import { QuickAddModal } from "../components/QuickAddModal";
import { ScanSuccessOverlay } from "../components/ScanSuccessOverlay";
import { useBarcodeScanner } from "../hooks/useBarcodeScanner";
import { useQuickAdd } from "../hooks/useQuickAdd";
import { useOnlineStatus } from "../hooks/useOnlineStatus";
import { useRetryQueue } from "../hooks/useRetryQueue";
import { useShopScope } from "../auth/ShopScopeProvider";

interface CartLine {
  lineId: string;
  product: CatalogProduct;
  quantity: number;
}

interface PaymentSplit {
  mode: PaymentMode;
  amount: string;
}

interface LineValidation {
  message: string;
  invalid: boolean;
}

interface CheckoutDraft {
  id: string;
  label: string;
  cart: CartLine[];
  payments: PaymentSplit[];
  note: string;
}

interface AddByBarcodeOptions {
  showScanOverlay?: boolean;
}

interface ScanOverlayProduct {
  id: string;
  brand: string;
  sizeLabel: string;
}

const PAYMENT_MODES: PaymentMode[] = ["cash", "upi", "card"];

function moneyString(cents: number): string {
  return (cents / 100).toFixed(2);
}

function parseMoney(s: string): number {
  const n = Number.parseFloat(s);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function formatPaymentLabel(m: PaymentMode): string {
  return { cash: "Cash", upi: "UPI", card: "Card" }[m];
}

function formatRemaining(ms: number): string {
  const clamped = Math.max(0, ms);
  const totalSeconds = Math.floor(clamped / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function stockValidationMessage(
  availableQuantity: number,
  requestedQuantity: number
): LineValidation | null {
  if (availableQuantity <= 0) {
    return { message: "Out of stock", invalid: true };
  }
  if (requestedQuantity > availableQuantity) {
    return {
      message: `Only ${availableQuantity} available; reduce quantity or remove this item.`,
      invalid: true,
    };
  }
  if (availableQuantity <= 3) {
    return { message: `Last ${availableQuantity} remaining`, invalid: false };
  }
  return null;
}

export function CheckoutPage() {
  const online = useOnlineStatus();
  const { actingShopId } = useShopScope();
  const retryQueue = useRetryQueue({
    onFlush: (outcomes) => {
      const failed = outcomes.filter((o) => !o.ok);
      if (failed.length === 0) return;
      const lines = failed
        .map((o) => `Queued sale ${o.key.slice(0, 6)}: HTTP ${o.status} — ${o.detail}`)
        .join("\n");
      setError((prev) => (prev ? `${prev}\n${lines}` : lines));
    },
  });

  const [cart, setCart] = useState<CartLine[]>([]);
  const [drafts, setDrafts] = useState<CheckoutDraft[]>([]);
  const [lineValidation, setLineValidation] = useState<Record<string, LineValidation>>({});
  const [barcode, setBarcode] = useState("");
  const [payments, setPayments] = useState<PaymentSplit[]>([{ mode: "cash", amount: "0.00" }]);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [catalogReady, setCatalogReady] = useState(false);
  const [lastInvoice, setLastInvoice] = useState<InvoicePublic | null>(null);
  const [offlineSession, setOfflineSession] = useState<StoredOfflineSession | null>(null);
  const [offlineReceiptCount, setOfflineReceiptCount] = useState(0);
  const [timerNow, setTimerNow] = useState(Date.now());
  const [scanOverlay, setScanOverlay] = useState<ScanOverlayProduct | null>(null);
  // Architecture review Candidate A: the quick-add modal + state +
  // submission is shared with the receiving flow via the
  // useQuickAdd hook. The checkout's onResolved shows the
  // "Pending — no price yet, contact admin" message (it does NOT
  // add the new product to the cart, per issue #26).
  const {
    quickAdd,
    openQuickAdd,
    closeQuickAdd,
    submitQuickAdd,
    busy: quickAddBusy,
    error: quickAddError,
  } = useQuickAdd({
    origin: "checkout",
    onResolved: (product) => {
      setCatalogReady(true);
      setInfo(
        `Quick-added (pending — owner needs to set the price): ${product.brand} ${product.size_label}. ` +
          `Cannot be sold until priced + stock received.`
      );
    },
  });
  const idempotencyKeyRef = useRef<string>(uid());
  const draftMinuteCountersRef = useRef<Record<string, number>>({});
  const [queuedSnapshot, setQueuedSnapshot] = useState(() => listQueued());

  useEffect(() => {
    if (!info) return;
    const timer = window.setTimeout(() => setInfo(null), 4000);
    return () => window.clearTimeout(timer);
  }, [info]);

  const applyOfflineCatalog = useCallback(
    (record: StoredOfflineSession) => {
      hydrateCatalog(record.catalog.map(offlineItemToCatalogProduct), actingShopId);
      setCatalogReady(true);
    },
    [actingShopId]
  );

  useEffect(() => {
    let cancelled = false;
    loadOpenOfflineSession()
      .then(async (record) => {
        if (!record || cancelled) return;
        setOfflineSession(record);
        applyOfflineCatalog(record);
        const receipts = await listOfflineReceipts(record.session.id);
        if (!cancelled) setOfflineReceiptCount(receipts.length);
      })
      .catch((e) => setError(`Offline session restore failed: ${toUserMessage(e, "unknown error")}`));
    return () => {
      cancelled = true;
    };
  }, [applyOfflineCatalog]);

  useEffect(() => {
    const timer = window.setInterval(() => setTimerNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const refreshQueueSnapshot = useCallback(() => {
    setQueuedSnapshot(listQueued());
  }, []);

  // Sync snapshot when the queue changes (auto-flush effects etc.).
  useEffect(() => {
    refreshQueueSnapshot();
  }, [retryQueue.pending, refreshQueueSnapshot]);

  // Prefetch the catalog on mount, and again if the acting shop changes
  // (superadmin, D-66) so the cache doesn't serve another shop's products.
  useEffect(() => {
    if (offlineSession) {
      applyOfflineCatalog(offlineSession);
      return;
    }
    setCatalogReady(false);
    prefetchCatalog(actingShopId)
      .then(() => setCatalogReady(true))
      .catch((e) => setError(`Catalog load failed: ${toUserMessage(e, "unknown error")}`));
  }, [actingShopId, offlineSession, applyOfflineCatalog]);

  const totalCents = useMemo(
    () =>
      cart.reduce((acc, l) => {
        const unit = parseMoney(l.product.price ?? "0");
        return acc + unit * l.quantity;
      }, 0),
    [cart]
  );

  const totalLabel = useMemo(() => `₹${moneyString(totalCents)}`, [totalCents]);
  const offlineRemainingMs = offlineSession
    ? new Date(offlineSession.session.expires_at).getTime() - timerNow
    : 0;
  const offlineExpired = Boolean(offlineSession && offlineRemainingMs <= 0);

  // When total changes, snap the default payment amount to match (single-mode).
  useEffect(() => {
    if (payments.length === 1) {
      setPayments((p) => [{ ...p[0], amount: moneyString(totalCents) }]);
    }
  }, [totalCents]); // eslint-disable-line react-hooks/exhaustive-deps

  const addByBarcode = useCallback(
    async (raw: string, options: AddByBarcodeOptions = {}) => {
      const code = raw.trim();
      if (!code) return;
      setError(null);
      setInfo(null);
      if (offlineSession) {
        const item = offlineSession.catalog.find((p) => p.barcode === code);
        if (!item) {
          setError(`Offline catalog does not contain barcode: ${code}`);
          return;
        }
        if (item.current_stock <= 0) {
          setError(`Out of offline baseline stock: ${item.brand} ${item.size_label}`);
          return;
        }
        const product = offlineItemToCatalogProduct(item);
        setCart((prev) => {
          const existing = prev.find((l) => l.product.barcode === code);
          if (existing) {
            return prev.map((l) =>
              l.lineId === existing.lineId ? { ...l, quantity: l.quantity + 1 } : l
            );
          }
          return [...prev, { lineId: uid(), product, quantity: 1 }];
        });
        setInfo(`Added: ${product.brand} ${product.size_label}`);
        if (options.showScanOverlay) {
          setScanOverlay({
            id: uid(),
            brand: product.brand,
            sizeLabel: product.size_label,
          });
        }
        return;
      }
      try {
        const product = await resolveBarcode(code, actingShopId);
        // Issue #26 (D-v2-7): a pending product is unsellable. The
        // cashier UI must NOT add it to the cart -- the user sees
        // the same "Pending — no price yet, contact admin" message
        // and continues with the rest of the cart. The backend
        // finalize path also rejects pending lines (see
        // app/services/checkout.py), so this is a UX defense, not
        // the sole guard.
        if (product.status === "pending" || product.price === null) {
          setError(
            `Pending — no price yet, contact admin: ${product.brand} ${product.size_label}`
          );
          return;
        }
        setCart((prev) => {
          const existing = prev.find((l) => l.product.barcode === code);
          if (existing) {
            return prev.map((l) =>
              l.lineId === existing.lineId ? { ...l, quantity: l.quantity + 1 } : l
            );
          }
          return [...prev, { lineId: uid(), product, quantity: 1 }];
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
            // Issue #26: same as the receiving flow, a missing barcode
            // at checkout opens the quick-add modal so the cashier
            // can register the brand-new product on the spot.
            openQuickAdd(code);
            setError(
              `Barcode not found in catalog: ${code}. Quick-add it?`
            );
          } else if (e.status === 0) setError("Network error — catalog lookup failed.");
          else setError(e.detail);
        } else {
          setError("Unknown error resolving barcode.");
        }
      }
    },
    [actingShopId, offlineSession, openQuickAdd]
  );

  // Quicksearch (issue #23) — taps on a search-result dropdown add the
  // product to the cart exactly like a scan would. The catalog is
  // already prefetched client-side, so no network round-trip is
  // involved. Pending products are still passed through; the same
  // "Pending — no price yet, contact admin" check as addByBarcode
  // blocks them from the cart (issue #26).
  const addByPick = useCallback((product: CatalogProduct) => {
    setError(null);
    setInfo(null);
    if (product.status === "pending" || product.price === null) {
      setError(
        `Pending — no price yet, contact admin: ${product.brand} ${product.size_label}`
      );
      return;
    }
    setCart((prev) => {
      const existing = prev.find((l) => l.product.barcode === product.barcode);
      if (existing) {
        return prev.map((l) =>
          l.lineId === existing.lineId ? { ...l, quantity: l.quantity + 1 } : l
        );
      }
      return [...prev, { lineId: uid(), product, quantity: 1 }];
    });
    setInfo(`Added: ${product.brand} ${product.size_label}`);
  }, []);

  const clearLineValidation = (lineId: string) => {
    setLineValidation((prev) => {
      if (!(lineId in prev)) return prev;
      const next = { ...prev };
      delete next[lineId];
      return next;
    });
  };

  const removeLine = (lineId: string) => {
    setCart((prev) => prev.filter((l) => l.lineId !== lineId));
    clearLineValidation(lineId);
    setError(null);
  };

  const changeQty = (lineId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((l) =>
          l.lineId === lineId ? { ...l, quantity: Math.max(1, l.quantity + delta) } : l
        )
    );
    clearLineValidation(lineId);
  };

  const validateLineQuantity = async (lineId: string, nextQty: number) => {
    const line = cart.find((l) => l.lineId === lineId);
    if (!line) return;
    const requested = Math.max(1, Math.floor(nextQty || 1));
    if (line.quantity !== requested) {
      setCart((prev) => prev.map((l) => (l.lineId === lineId ? { ...l, quantity: requested } : l)));
    }
    if (offlineSession) {
      const message = stockValidationMessage(line.product.current_stock ?? 0, requested);
      setLineValidation((prev) => {
        const next = { ...prev };
        if (message) next[lineId] = message;
        else delete next[lineId];
        return next;
      });
      return;
    }
    try {
      const result = await validateCheckoutCart(
        [{ barcode: line.product.barcode, quantity: requested }],
        actingShopId
      );
      const checked = result.lines[0];
      const message = stockValidationMessage(
        checked.available_quantity,
        checked.requested_quantity
      );
      setLineValidation((prev) => {
        const next = { ...prev };
        if (message) next[lineId] = message;
        else delete next[lineId];
        return next;
      });
    } catch (e) {
      setError(toUserMessage(e, "Could not validate stock."));
    }
  };

  useEffect(() => {
    if (cart.length === 0) return;
    const timer = window.setTimeout(() => {
      cart.forEach((line) => {
        void validateLineQuantity(line.lineId, line.quantity);
      });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [cart, actingShopId]); // eslint-disable-line react-hooks/exhaustive-deps

  const clearActiveCheckout = () => {
    setCart([]);
    setLineValidation({});
    setPayments([{ mode: "cash", amount: "0.00" }]);
    setNote("");
    setError(null);
    setInfo(null);
  };

  const nextDraftLabel = () => {
    const now = new Date();
    const minuteKey = `${now.getHours()}:${now.getMinutes()}`;
    const timeLabel = now.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const nextCount = (draftMinuteCountersRef.current[minuteKey] ?? 0) + 1;
    draftMinuteCountersRef.current[minuteKey] = nextCount;
    const counterLabel = nextCount < 10 ? `0${nextCount}` : String(nextCount);
    return `Draft ${timeLabel} #${counterLabel}`;
  };

  const parkDraft = () => {
    if (cart.length === 0) return;
    setDrafts((prev) => [
      ...prev,
      {
        id: uid(),
        label: nextDraftLabel(),
        cart,
        payments,
        note,
      },
    ]);
    setCart([]);
    setLineValidation({});
    setPayments([{ mode: "cash", amount: "0.00" }]);
    setNote("");
    setInfo("Checkout parked as a draft.");
  };

  const restoreDraft = (draft: CheckoutDraft) => {
    if (cart.length > 0) parkDraft();
    setCart(draft.cart);
    setLineValidation({});
    setPayments(draft.payments);
    setNote(draft.note);
    setDrafts((prev) => prev.filter((d) => d.id !== draft.id));
    setError(null);
    setInfo(`Restored ${draft.label}.`);
  };

  const setPaymentMode = (idx: number, mode: PaymentMode) => {
    setPayments((p) => p.map((row, i) => (i === idx ? { ...row, mode } : row)));
  };

  const setPaymentAmount = (idx: number, amount: string) => {
    setPayments((p) => p.map((row, i) => (i === idx ? { ...row, amount } : row)));
  };

  const addPayment = () => {
    setPayments((p) => [...p, { mode: "upi", amount: "0.00" }]);
  };

  const removePayment = (idx: number) => {
    setPayments((p) => (p.length === 1 ? p : p.filter((_, i) => i !== idx)));
  };

  const paymentsCents = useMemo(
    () => payments.reduce((acc, p) => acc + parseMoney(p.amount), 0),
    [payments]
  );

  const canFinalize =
    cart.length > 0 &&
    payments.length > 0 &&
    paymentsCents === totalCents &&
    !busy &&
    !offlineExpired;

  const handleSubmitBarcode = (e: React.FormEvent) => {
    e.preventDefault();
    void addByBarcode(barcode);
    setBarcode("");
  };

  useBarcodeScanner({
    enabled: catalogReady && !quickAdd && !lastInvoice && !offlineExpired,
    onScan: (code) => void addByBarcode(code, { showScanOverlay: true }),
  });

  const dismissScanOverlay = useCallback(() => {
    setScanOverlay(null);
  }, []);

  const validateCartBeforeFinalize = async (): Promise<boolean> => {
    if (offlineSession) {
      const nextValidation: Record<string, LineValidation> = {};
      const blockingMessages: string[] = [];
      for (const line of cart) {
        const message = stockValidationMessage(line.product.current_stock ?? 0, line.quantity);
        if (!message) continue;
        nextValidation[line.lineId] = message;
        if (message.invalid) {
          blockingMessages.push(`${line.product.brand} ${line.product.size_label}: ${message.message}`);
        }
      }
      setLineValidation(nextValidation);
      if (blockingMessages.length > 0) {
        setError(blockingMessages.join("\n"));
        return false;
      }
      return true;
    }
    const result = await validateCheckoutCart(
      cart.map((l) => ({ barcode: l.product.barcode, quantity: l.quantity })),
      actingShopId
    );
    const checkedByBarcode = new Map(result.lines.map((line) => [line.barcode, line]));
    const nextValidation: Record<string, LineValidation> = {};
    const blockingMessages: string[] = [];

    for (const line of cart) {
      const checked = checkedByBarcode.get(line.product.barcode);
      if (!checked) continue;
      const message = stockValidationMessage(
        checked.available_quantity,
        checked.requested_quantity
      );
      if (!message) continue;
      nextValidation[line.lineId] = message;
      if (message.invalid) {
        blockingMessages.push(`${line.product.brand} ${line.product.size_label}: ${message.message}`);
      }
    }

    setLineValidation(nextValidation);
    if (blockingMessages.length > 0) {
      setError(blockingMessages.join("\n"));
      return false;
    }
    return true;
  };

  const finalize = async () => {
    setError(null);
    setInfo(null);
    if (!canFinalize) {
      setError(offlineExpired ? "Offline session expired. Temporary receipts cannot be edited." : "Payments must equal the cart total.");
      return;
    }
    setBusy(true);
    const body = {
      lines: cart.map((l) => ({ barcode: l.product.barcode, quantity: l.quantity })),
      payments: payments.map((p) => ({ mode: p.mode, amount: moneyString(parseMoney(p.amount)) })),
      note: note.trim() || undefined,
    };
    const idemKey = idempotencyKeyRef.current;
    try {
      const stockOk = await validateCartBeforeFinalize();
      if (!stockOk) return;
      if (offlineSession) {
        const nextNumber = offlineReceiptCount + 1;
        const tempReceiptId = `OFF-${offlineSession.session.id}-${String(nextNumber).padStart(4, "0")}`;
        await addOfflineReceipt(offlineSession.session.id, {
          temp_receipt_id: tempReceiptId,
          idempotency_key: `offline-${offlineSession.session.id}-${tempReceiptId}`,
          lines: body.lines,
          payments: body.payments,
          note: body.note,
          created_at: new Date().toISOString(),
        });
        const nextCatalog = offlineSession.catalog.map((item) => {
          const sold = cart.find((line) => line.product.barcode === item.barcode)?.quantity ?? 0;
          return sold > 0 ? { ...item, current_stock: Math.max(0, item.current_stock - sold) } : item;
        });
        const nextSession: StoredOfflineSession = {
          ...offlineSession,
          catalog: nextCatalog,
          session: {
            ...offlineSession.session,
            receipt_counter: nextNumber,
            receipt_count: nextNumber,
            gross_total: moneyString(parseMoney(offlineSession.session.gross_total) + totalCents),
          },
        };
        await saveStoredOfflineSession(nextSession);
        setOfflineSession(nextSession);
        setOfflineReceiptCount(nextNumber);
        applyOfflineCatalog(nextSession);
        clearActiveCheckout();
        idempotencyKeyRef.current = uid();
        setInfo(`Saved temporary receipt ${tempReceiptId}. Sync required for official invoice number.`);
        return;
      }
      const res = await finalizeCheckout(body, idemKey, actingShopId);
      setLastInvoice(res.invoice);
      clearActiveCheckout();
      idempotencyKeyRef.current = uid();
      setInfo(res.is_replay ? "Idempotent replay — same invoice shown." : "Invoice created.");
    } catch (e) {
      if (e instanceof ApiError) {
        // Network / timeout / 429 -> queue for retry. The local cart is
        // cleared so the cashier can keep ringing; on a successful retry
        // we display the resulting invoice via the queue hook below.
        if (e.status === 0 || e.status === 408 || e.status === 429) {
          setError(
            online
              ? "Network error. Retry, or start Work offline while connected if an outage is expected."
              : "Offline finalizing is locked unless Work offline was started online first."
          );
        } else if (e.status === 409) {
          try {
            const stockOk = await validateCartBeforeFinalize();
            if (stockOk) setError(e.detail);
          } catch {
            setError(e.detail);
          }
        } else if (e.status === 400) {
          setError(`Validation error: ${e.detail}`);
        } else {
          // 5xx / other 4xx: surface directly. Invariant failures (e.g.
          // insufficient_stock) must NOT be silently dropped.
          setError(e.detail);
        }
      } else {
        setError("Unknown error finalizing invoice.");
      }
    } finally {
      setBusy(false);
    }
  };

  // (online status + retry queue wired at the top of the component.)

  const beginOfflineSession = async () => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const started = await startOfflineSession(actingShopId);
      const stored = await saveStartedOfflineSession(started);
      setOfflineSession(stored);
      setOfflineReceiptCount(0);
      applyOfflineCatalog(stored);
      clearActiveCheckout();
      setInfo("Offline session started. Temporary receipts must be synced before normal checkout resumes.");
    } catch (e) {
      setError(toUserMessage(e, "Could not start offline session."));
    } finally {
      setBusy(false);
    }
  };

  const extendCurrentOfflineSession = async () => {
    if (!offlineSession) return;
    setBusy(true);
    setError(null);
    try {
      const extended = await extendOfflineSession(offlineSession.session.id);
      const stored = await updateStoredOfflineSession(
        extended.session,
        extended.offline_token
      );
      setOfflineSession(stored);
      setInfo("Offline session extended.");
    } catch (e) {
      setError(toUserMessage(e, "Could not extend offline session."));
    } finally {
      setBusy(false);
    }
  };

  const syncCurrentOfflineSession = async () => {
    if (!offlineSession) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const receipts = await listOfflineReceipts(offlineSession.session.id);
      if (receipts.length === 0) {
        setError("No offline receipts to sync. Ask an owner to discard this session.");
        return;
      }
      const result = await syncOfflineSession(
        offlineSession.session.id,
        receipts,
        offlineSession.offlineToken
      );
      await clearOfflineSessionData(offlineSession.session.id);
      setOfflineSession(null);
      setOfflineReceiptCount(0);
      invalidateCache();
      void prefetchCatalog(actingShopId).then(() => setCatalogReady(true));
      setInfo(
        `Synced ${result.mappings.length} receipt(s). Official invoice numbers: ${result.mappings
          .map((m) => `#${m.invoice_number}`)
          .join(", ")}.`
      );
    } catch (e) {
      setError(toUserMessage(e, "Offline sync failed. Checkout remains locked until sync or owner discard."));
      const refreshed = await loadOpenOfflineSession();
      if (refreshed) setOfflineSession(refreshed);
    } finally {
      setBusy(false);
    }
  };

  const handleDismissQueued = (key: string) => {
    clearQueued(key);
    refreshQueueSnapshot();
  };

  const downloadPdf = async () => {
    if (!lastInvoice) return;
    if (offlineSession) {
      setError("PDF download is blocked during an offline session.");
      return;
    }
    try {
      const blob = await downloadInvoicePdf(lastInvoice.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `invoice-${lastInvoice.invoice_number}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(toUserMessage(e, "PDF download failed."));
    }
  };

  // Replay / re-fetch on demand — used after a finalize error to refresh
  // the invoice view if it was previously opened.
  const refreshInvoice = async () => {
    if (!lastInvoice) return;
    try {
      const fresh = await getInvoice(lastInvoice.id);
      setLastInvoice(fresh);
    } catch {
      // ignore — user can retry
    }
  };

  return (
    <div className="grid gap-gutter">
      {scanOverlay && (
        <ScanSuccessOverlay
          key={scanOverlay.id}
          brand={scanOverlay.brand}
          sizeLabel={scanOverlay.sizeLabel}
          onDone={dismissScanOverlay}
        />
      )}

      {/* Connectivity + queue banner */}
      <div className="flex flex-col gap-stack-gap" aria-live="polite">
        {!online && (
          <div
            role="status"
            className="flex items-center gap-stack-gap rounded-md bg-warning px-stack-gap py-3 text-on-warning"
          >
            <span className="text-headline-md">⚠</span>
            <div className="flex-1">
              <div className="text-label-xl">You&apos;re offline</div>
              <div className="text-label-md">
                Offline sales require an active Work offline session started while online.
              </div>
            </div>
          </div>
        )}
        {queuedSnapshot.length > 0 && (
          <div
            role="region"
            aria-label="Pending finalize queue"
            className="flex flex-col gap-stack-gap rounded-md bg-surface-container p-stack-gap"
          >
            <div className="flex items-center justify-between">
              <div className="text-label-xl text-primary">
                Pending finalize queue ({queuedSnapshot.length})
              </div>
              <div className="flex gap-stack-gap">
                <button
                  type="button"
                  onClick={() => {
                    void retryQueue.flush();
                    refreshQueueSnapshot();
                  }}
                  className="min-h-touchTarget-sm rounded-md bg-action px-stack-gap text-label-md text-on-action disabled:opacity-50"
                  disabled={!online}
                >
                  Retry now
                </button>
              </div>
            </div>
            <ul className="flex flex-col gap-stack-gap">
              {queuedSnapshot.map((q) => (
                <li
                  key={q.idempotencyKey}
                  className="flex items-center justify-between rounded-md bg-surface px-stack-gap py-2 text-label-md"
                >
                  <div className="flex flex-col">
                    <span className="font-mono">{q.idempotencyKey.slice(0, 12)}…</span>
                    <span className="text-on-surface-variant">
                      {q.body.lines.length} line(s) · attempts {q.attempts}
                      {q.lastError ? ` · last error: ${q.lastError}` : ""}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDismissQueued(q.idempotencyKey)}
                    className="flex h-12 w-12 items-center justify-center rounded-md bg-error text-[28px] font-black leading-none text-on-error"
                    aria-label="Dismiss queued sale"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {offlineSession ? (
          <div
            role="region"
            aria-label="Offline session"
            className="flex flex-col gap-stack-gap rounded-md bg-surface-container p-stack-gap"
          >
            <div className="flex flex-wrap items-center justify-between gap-stack-gap">
              <div>
                <div className="text-label-xl text-primary">Offline session #{offlineSession.session.id}</div>
                <div className="text-label-md text-on-surface-variant">
                  {offlineReceiptCount} temporary receipt(s) saved · sync required for official invoice numbers
                </div>
              </div>
              <div className={`font-mono text-headline-md ${offlineExpired ? "text-error" : "text-on-surface"}`}>
                {formatRemaining(offlineRemainingMs)}
              </div>
            </div>
            {offlineSession.session.failure_reason?.message && (
              <div role="alert" className="rounded-md bg-error px-stack-gap py-2 text-on-error">
                {offlineSession.session.failure_reason.message}
              </div>
            )}
            <div className="flex flex-wrap gap-stack-gap">
              <button
                type="button"
                onClick={extendCurrentOfflineSession}
                disabled={busy || offlineSession.session.extension_count >= 1 || offlineExpired}
                className="min-h-touchTarget-sm rounded-md bg-warning px-stack-gap text-label-md text-on-warning disabled:opacity-50"
              >
                Extend 2h
              </button>
              <button
                type="button"
                onClick={syncCurrentOfflineSession}
                disabled={busy || !online || offlineReceiptCount === 0}
                className="min-h-touchTarget-sm rounded-md bg-action px-stack-gap text-label-md text-on-action disabled:opacity-50"
              >
                Sync receipts
              </button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={beginOfflineSession}
              disabled={busy || !online}
              className="min-h-touchTarget-sm rounded-md bg-primary px-stack-gap text-label-md text-on-primary disabled:opacity-50"
            >
              Work offline
            </button>
          </div>
        )}
      </div>

      {/* Quick-add modal (issue #26). Same UI as the receiving flow,
          opened when a scan misses the catalog at checkout. The newly
          created product starts as 'pending' with no price, so the
          success path doesn't add it to the cart -- the cashier sees
          the "Pending — no price yet" message and continues with the
          rest of the sale. */}
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

      <div className="grid gap-gutter lg:grid-cols-[2fr_1fr]">
      {/* LEFT — cart */}
      <section className="flex flex-col gap-stack-gap rounded-lg bg-surface-container p-gutter">
        <header className="flex items-center justify-between">
          <h1 className="text-headline-md text-primary">Checkout</h1>
          <div className="flex items-center gap-stack-gap text-label-md text-on-surface-variant">
            <span>{catalogReady ? "Catalog cached" : "Loading catalog…"}</span>
            <button
              type="button"
              onClick={() => {
                invalidateCache();
                setCatalogReady(false);
                void prefetchCatalog(actingShopId).then(() => setCatalogReady(true));
              }}
              disabled={Boolean(offlineSession)}
              className="rounded-md bg-surface-container-high px-stack-gap py-1 text-on-surface-variant disabled:opacity-50"
            >
              Refresh
            </button>
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

        <div className="flex flex-wrap items-center gap-stack-gap">
          <button
            type="button"
            onClick={parkDraft}
            disabled={cart.length === 0}
            className="min-h-touchTarget-sm rounded-md bg-warning px-stack-gap text-label-md text-on-warning disabled:opacity-50"
          >
            Park
          </button>
          <div className="flex flex-wrap items-center gap-2">
            {drafts.map((draft) => (
              <span key={draft.id} className="flex items-center gap-2">
                <span className="text-on-surface-variant">|</span>
                <button
                  type="button"
                  onClick={() => restoreDraft(draft)}
                  className="min-h-touchTarget-sm rounded-md bg-primary px-stack-gap text-label-md text-on-primary"
                >
                  {draft.label} ({draft.cart.length})
                </button>
                <span className="text-on-surface-variant">|</span>
              </span>
            ))}
          </div>
          <button
            type="button"
            onClick={clearActiveCheckout}
            className="ml-auto min-h-touchTarget-sm rounded-md bg-surface-container-high px-stack-gap text-label-md text-on-surface"
          >
            All Clear
          </button>
        </div>

        {/* Quicksearch (issue #23). Cashier types a brand or barcode
            substring; tapping a match adds it like a scan. */}
        <QuickSearch
          onPick={addByPick}
          placeholder="Search by name or barcode"
          ariaLabel="Quick-search products by name or barcode"
        />

        <ul className="flex flex-col gap-stack-gap">
          {cart.length === 0 && (
            <li className="rounded-md bg-surface p-stack-gap text-center text-on-surface-variant">
              No items in cart. Scan a barcode to begin.
            </li>
          )}
          {cart.map((l) => (
            <li
              key={l.lineId}
              className="flex items-center justify-between rounded-md bg-surface px-stack-gap py-3 shadow-sm"
            >
              <div className="flex flex-col">
                              <span className="text-label-xl text-on-surface">{l.product.brand}</span>
                              <span className="text-label-md text-on-surface-variant">{l.product.size_label}</span>
                              <span className="font-mono text-label-md text-on-surface-variant">
                                {l.product.barcode}
                              </span>
                              {/* Issue #42 — show current derived stock at this shop,
                                  sourced from the catalog snapshot at scan time. Helps
                                  the cashier catch a potential oversell before submit. */}
                              <span className="text-label-md text-on-surface-variant">
                                In stock:{" "}
                                <span className="font-mono">{l.product.current_stock ?? 0}</span>
                              </span>
                              {lineValidation[l.lineId] && (
                                <span
                                  className={`text-label-md ${
                                    lineValidation[l.lineId].invalid ? "text-error" : "text-warning"
                                  }`}
                                >
                                  {lineValidation[l.lineId].message}
                                </span>
                              )}
                            </div>
              <div className="flex items-center gap-stack-gap">
                <button
                  type="button"
                  onClick={() => changeQty(l.lineId, -1)}
                  className="flex h-12 w-12 items-center justify-center rounded-md bg-surface-container-high text-[28px] font-black leading-none text-on-surface"
                  aria-label="Decrease quantity"
                >
                  −
                </button>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={l.quantity}
                  onChange={(e) => {
                    clearLineValidation(l.lineId);
                    setCart((prev) =>
                      prev.map((row) =>
                        row.lineId === l.lineId
                          ? { ...row, quantity: Math.max(1, Number(e.target.value) || 1) }
                          : row
                      )
                    );
                  }}
                  onFocus={(e) => e.currentTarget.select()}
                  onBlur={(e) => void validateLineQuantity(l.lineId, Number(e.target.value))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void validateLineQuantity(l.lineId, Number(e.currentTarget.value));
                    }
                  }}
                  className="h-12 w-16 rounded-md border border-outline bg-surface text-center font-mono text-headline-md"
                  aria-label="Quantity"
                />
                <button
                  type="button"
                  onClick={() => changeQty(l.lineId, +1)}
                  className="flex h-12 w-12 items-center justify-center rounded-md bg-surface-container-high text-[28px] font-black leading-none text-on-surface"
                  aria-label="Increase quantity"
                >
                  +
                </button>
                <span className="w-24 text-right font-mono text-headline-md text-on-surface">
                  ₹
                  {moneyString(parseMoney(l.product.price ?? "0") * l.quantity)}
                </span>
                <button
                  type="button"
                  onClick={() => removeLine(l.lineId)}
                  className="flex h-12 w-12 items-center justify-center rounded-md bg-error text-[28px] font-black leading-none text-on-error"
                  aria-label="Remove line"
                >
                  ×
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* RIGHT — payment + finalize */}
      <aside className="flex flex-col gap-stack-gap rounded-lg bg-surface-container p-gutter">
        <div className="rounded-md bg-primary p-gutter text-on-primary">
          <div className="text-label-md uppercase">Total Payable</div>
          <div className="font-mono text-display-lg">{totalLabel}</div>
        </div>

        <div className="flex flex-col gap-stack-gap">
          <div className="flex items-center justify-between">
            <h2 className="text-headline-md text-on-surface">Payment</h2>
            <button
              type="button"
              onClick={addPayment}
              className="rounded-md bg-surface-container-high px-stack-gap py-1 text-label-md text-on-surface-variant"
            >
              + Split
            </button>
          </div>

          {payments.map((p, idx) => (
            <div key={idx} className="flex items-center gap-stack-gap">
              <select
                value={p.mode}
                onChange={(e) => setPaymentMode(idx, e.target.value as PaymentMode)}
                className="min-h-touchTarget-sm flex-1 rounded-md border border-outline bg-surface px-stack-gap text-body-md"
                aria-label="Payment mode"
              >
                {PAYMENT_MODES.map((m) => (
                  <option key={m} value={m}>
                    {formatPaymentLabel(m)}
                  </option>
                ))}
              </select>
              <input
                type="number"
                step="0.01"
                min="0"
                value={p.amount}
                onChange={(e) => setPaymentAmount(idx, e.target.value)}
                onFocus={(e) => e.currentTarget.select()}
                className="min-h-touchTarget-sm w-32 rounded-md border border-outline bg-surface px-stack-gap text-right font-mono text-body-md"
                aria-label="Payment amount"
              />
              {payments.length > 1 && (
                <button
                  type="button"
                  onClick={() => removePayment(idx)}
                  className="flex h-12 w-12 items-center justify-center rounded-md bg-error text-[28px] font-black leading-none text-on-error"
                  aria-label="Remove payment"
                >
                  ×
                </button>
              )}
            </div>
          ))}

          <div className="flex justify-between text-label-md text-on-surface-variant">
            <span>Payments sum</span>
            <span
              className={`font-mono ${paymentsCents === totalCents ? "text-success" : "text-error"}`}
            >
              ₹{moneyString(paymentsCents)}
            </span>
          </div>
        </div>

        <label className="flex flex-col gap-1 text-label-md">
          Note (optional)
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={200}
            className="min-h-touchTarget-sm rounded-md border border-outline bg-surface px-stack-gap text-body-md"
          />
        </label>

        <button
          type="button"
          onClick={finalize}
          disabled={!canFinalize}
          className="min-h-touchTarget rounded-md bg-action text-label-xl text-on-action disabled:opacity-50"
        >
          {busy ? "Finishing..." : offlineSession ? "Save temporary receipt" : "Finish & pay"}
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

      {/* Modal-ish invoice preview */}
      {lastInvoice && (
        <div
          className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 p-stack-gap"
          role="dialog"
          aria-modal="true"
        >
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col gap-stack-gap overflow-y-auto rounded-lg bg-surface-container p-gutter">
            <header className="flex items-center justify-between">
              <h2 className="text-headline-md text-primary">
                Invoice #{lastInvoice.invoice_number}
              </h2>
              <div className="flex gap-stack-gap">
                <button
                  type="button"
                  onClick={refreshInvoice}
                  className="rounded-md bg-surface-container-high px-stack-gap py-2 text-label-md"
                >
                  Refresh
                </button>
                <button
                  type="button"
                  onClick={downloadPdf}
                  disabled={Boolean(offlineSession)}
                  className="rounded-md bg-primary px-stack-gap py-2 text-label-md text-on-primary disabled:opacity-50"
                >
                  PDF
                </button>
                <button
                  type="button"
                  onClick={() => setLastInvoice(null)}
                  className="flex h-12 w-12 items-center justify-center rounded-md bg-error text-[28px] font-black leading-none text-on-error"
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
            </header>
            <div className="text-label-md text-on-surface-variant">
              {new Date(lastInvoice.finalized_at).toLocaleString()}
            </div>
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-outline text-label-md text-on-surface-variant">
                  <th className="py-2 text-left">Product</th>
                  <th className="py-2 text-right">Qty</th>
                  <th className="py-2 text-right">Unit</th>
                  <th className="py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {lastInvoice.lines.map((l) => (
                                  <tr key={l.id} className="border-b border-outline/40">
                                    {/* Issue #38: render snapshot brand + size instead of raw product_id. */}
                                    <td className="py-2">{l.product_brand} {l.product_size_label}</td>
                                    <td className="py-2 text-right font-mono">{l.quantity}</td>
                                    <td className="py-2 text-right font-mono">₹{l.unit_price}</td>
                                    <td className="py-2 text-right font-mono">₹{l.line_total}</td>
                                  </tr>
                                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3} className="py-3 text-right text-label-xl">
                    Total
                  </td>
                  <td className="py-3 text-right font-mono text-headline-md">
                    ₹{lastInvoice.total_amount}
                  </td>
                </tr>
              </tfoot>
            </table>
            <div>
              <div className="text-label-md uppercase text-on-surface-variant">Payments</div>
              {lastInvoice.payments.map((p) => (
                <div key={p.id} className="flex justify-between text-body-md">
                  <span>{formatPaymentLabel(p.mode)}</span>
                  <span className="font-mono">₹{p.amount}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
