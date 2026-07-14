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
  type OfflineReceiptPayload,
  startOfflineSession,
  syncOfflineSession,
} from "../api/offline-sessions";
import {
  buildOfflineReceiptId,
  clearOfflineSessionData,
  deleteOfflineReceipt,
  listOfflineReceipts,
  loadOpenOfflineSession,
  recalculateStoredOfflineSession,
  saveStartedOfflineSession,
  saveStoredOfflineSession,
  updateStoredOfflineSession,
  upsertOfflineReceipt,
  type StoredOfflineSession,
} from "../api/offline-session-store";
import { OfflineReceiptEditorModal } from "../components/OfflineReceiptEditorModal";
import { QuickSearch } from "../components/QuickSearch";
import { QuickAddModal } from "../components/QuickAddModal";
import { ScanSuccessOverlay } from "../components/ScanSuccessOverlay";
import { useBarcodeScanner } from "../hooks/useBarcodeScanner";
import { useQuickAdd } from "../hooks/useQuickAdd";
import { probeHealthz, useConnectivityStatus } from "../hooks/useOnlineStatus";
import { useRetryQueue } from "../hooks/useRetryQueue";
import { useShopScope } from "../auth/ShopScopeProvider";
import { RefreshCw, ShoppingBag, CreditCard, ShoppingCart } from "lucide-react";

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
  const connectivity = useConnectivityStatus();
  const online = connectivity.online;
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
  const [offlineReceipts, setOfflineReceipts] = useState<OfflineReceiptPayload[]>([]);
  const [offlineReceiptCount, setOfflineReceiptCount] = useState(0);
  const [editingReceiptId, setEditingReceiptId] = useState<string | null>(null);
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
        const receipts = await listOfflineReceipts(record.session.id);
        if (cancelled) return;
        setOfflineSession(record);
        setOfflineReceipts(receipts);
        setOfflineReceiptCount(receipts.length);
        applyOfflineCatalog(record);
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
  const checkoutLocked = busy;
  const offlinePriceByBarcode = useMemo(
    () => new Map((offlineSession?.catalog ?? []).map((item) => [item.barcode, parseMoney(item.price)])),
    [offlineSession]
  );
  const editingReceipt =
    editingReceiptId != null
      ? offlineReceipts.find((receipt) => receipt.temp_receipt_id === editingReceiptId) ?? null
      : null;

  // When total changes, snap the default payment amount to match (single-mode).
  useEffect(() => {
    if (payments.length === 1) {
      setPayments((p) => [{ ...p[0], amount: moneyString(totalCents) }]);
    }
  }, [totalCents]); // eslint-disable-line react-hooks/exhaustive-deps

  const addByBarcode = useCallback(
    async (raw: string, options: AddByBarcodeOptions = {}) => {
      if (checkoutLocked) return;
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
    [actingShopId, checkoutLocked, offlineSession, openQuickAdd]
  );

  // Quicksearch (issue #23) — taps on a search-result dropdown add the
  // product to the cart exactly like a scan would. The catalog is
  // already prefetched client-side, so no network round-trip is
  // involved. Pending products are still passed through; the same
  // "Pending — no price yet, contact admin" check as addByBarcode
  // blocks them from the cart (issue #26).
  const addByPick = useCallback((product: CatalogProduct) => {
    if (checkoutLocked) return;
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
  }, [checkoutLocked]);

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

  const persistOfflineReceiptSet = useCallback(
    async (nextReceipts: OfflineReceiptPayload[]) => {
      if (!offlineSession) return null;
      const nextSession = recalculateStoredOfflineSession(offlineSession, nextReceipts);
      await saveStoredOfflineSession(nextSession);
      setOfflineSession(nextSession);
      setOfflineReceipts(nextReceipts);
      setOfflineReceiptCount(nextReceipts.length);
      applyOfflineCatalog(nextSession);
      return nextSession;
    },
    [applyOfflineCatalog, offlineSession]
  );

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
    if (checkoutLocked) return;
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
    if (checkoutLocked) return;
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
        const nextNumber = offlineSession.nextReceiptNumber ?? offlineSession.session.receipt_counter + 1;
        const tempReceiptId = buildOfflineReceiptId(offlineSession.session.id, nextNumber);
        const receipt: OfflineReceiptPayload = {
          temp_receipt_id: tempReceiptId,
          idempotency_key: `offline-${offlineSession.session.id}-${tempReceiptId}`,
          lines: body.lines,
          payments: body.payments,
          note: body.note,
          created_at: new Date().toISOString(),
        };
        await upsertOfflineReceipt(offlineSession.session.id, receipt);
        await persistOfflineReceiptSet([...offlineReceipts, receipt]);
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
      setOfflineReceipts([]);
      setOfflineReceiptCount(0);
      setEditingReceiptId(null);
      applyOfflineCatalog(stored);
      clearActiveCheckout();
      setInfo("Offline session started. Temporary receipts must be synced before normal checkout resumes.");
    } catch (e) {
      setError(toUserMessage(e, "Could not start offline session."));
    } finally {
      setBusy(false);
    }
  };

  const resumeOnline = async () => {
    if (!offlineSession) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 2500);
    try {
      await probeHealthz(controller.signal);
      const receipts = await listOfflineReceipts(offlineSession.session.id);
      if (receipts.length === 0) {
        setError("No offline receipts to sync. Save a temporary receipt before resuming online.");
        return;
      }
      const result = await syncOfflineSession(
        offlineSession.session.id,
        receipts,
        offlineSession.offlineToken
      );
      await clearOfflineSessionData(offlineSession.session.id);
      setOfflineSession(null);
      setOfflineReceipts([]);
      setOfflineReceiptCount(0);
      setEditingReceiptId(null);
      clearActiveCheckout();
      idempotencyKeyRef.current = uid();
      invalidateCache();
      void prefetchCatalog(actingShopId).then(() => setCatalogReady(true));
      setInfo(
        `Resumed online after syncing ${result.mappings.length} receipt(s). Official invoice numbers: ${result.mappings
          .map((m) => `#${m.invoice_number}`)
          .join(", ")}.`
      );
    } catch (e) {
      setError(
        `Could not resume online. ${toUserMessage(
          e,
          "Offline session remains active and receipts were not discarded."
        )}`
      );
    } finally {
      window.clearTimeout(timeout);
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

  const saveEditedOfflineReceipt = async (updated: OfflineReceiptPayload) => {
    if (!offlineSession) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const existing = offlineReceipts.find((receipt) => receipt.temp_receipt_id === updated.temp_receipt_id);
      if (!existing) {
        setError("Temporary receipt was not found.");
        return;
      }
      await upsertOfflineReceipt(offlineSession.session.id, updated);
      const nextReceipts = offlineReceipts.map((receipt) =>
        receipt.temp_receipt_id === updated.temp_receipt_id ? updated : receipt
      );
      await persistOfflineReceiptSet(nextReceipts);
      setEditingReceiptId(null);
      setInfo(`Updated ${updated.temp_receipt_id}.`);
    } catch (e) {
      setError(toUserMessage(e, "Could not update temporary receipt."));
    } finally {
      setBusy(false);
    }
  };

  const deleteEditedOfflineReceipt = async () => {
    if (!offlineSession || !editingReceiptId) return;
    const receipt = offlineReceipts.find((row) => row.temp_receipt_id === editingReceiptId);
    if (!receipt) {
      setError("Temporary receipt was not found.");
      return;
    }
    if (!window.confirm(`Delete ${receipt.temp_receipt_id}? This cannot be undone before sync.`)) {
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await deleteOfflineReceipt(offlineSession.session.id, receipt.temp_receipt_id);
      const nextReceipts = offlineReceipts.filter((row) => row.temp_receipt_id !== receipt.temp_receipt_id);
      await persistOfflineReceiptSet(nextReceipts);
      setEditingReceiptId(null);
      setInfo(`Deleted ${receipt.temp_receipt_id}.`);
    } catch (e) {
      setError(toUserMessage(e, "Could not delete temporary receipt."));
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
      setOfflineReceipts([]);
      setOfflineReceiptCount(0);
      setEditingReceiptId(null);
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
      if (refreshed) {
        setOfflineSession(refreshed);
        const refreshedReceipts = await listOfflineReceipts(refreshed.session.id);
        setOfflineReceipts(refreshedReceipts);
        setOfflineReceiptCount(refreshedReceipts.length);
      }
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
        {connectivity.status === "offline" && (
          <div
            role="status"
            className="flex items-center gap-stack-gap rounded-md bg-warning px-stack-gap py-3 text-on-warning"
          >
            <span className="text-headline-md">⚠</span>
            <div className="flex-1">
              <div className="text-label-xl">You&apos;re offline</div>
              <div className="text-label-md">
                The API probe to /healthz failed. Offline sales still require an active Work offline session started while online.
              </div>
            </div>
          </div>
        )}
        {queuedSnapshot.length > 0 && (
          <div
            role="region"
            aria-label="Pending finalize queue"
            className="flex flex-col gap-4 rounded-[24px] bg-slate-50 p-6 ring-1 ring-slate-200"
          >
            <div className="flex items-center justify-between">
              <div className="text-lg font-semibold tracking-tight text-slate-900">
                Pending finalize queue ({queuedSnapshot.length})
              </div>
              <div className="flex gap-4">
                <button
                  type="button"
                  onClick={() => {
                    void retryQueue.flush();
                    refreshQueueSnapshot();
                  }}
                  className="flex h-11 items-center justify-center rounded-xl bg-action px-6 text-sm font-bold tracking-wide text-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--color-action)]/30 active:scale-95 disabled:pointer-events-none disabled:opacity-50"
                  disabled={!online}
                >
                  Retry now
                </button>
              </div>
            </div>
            <ul className="flex flex-col gap-3">
              {queuedSnapshot.map((q) => (
                <li
                  key={q.idempotencyKey}
                  className="flex items-center justify-between rounded-xl bg-white px-4 py-3 text-sm shadow-sm ring-1 ring-slate-200"
                >
                  <div className="flex flex-col">
                    <span className="font-mono font-medium text-slate-900">{q.idempotencyKey.slice(0, 12)}…</span>
                    <span className="text-slate-500">
                      {q.body.lines.length} line(s) · attempts {q.attempts}
                      {q.lastError ? ` · last error: ${q.lastError}` : ""}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDismissQueued(q.idempotencyKey)}
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-red-50 text-red-500 transition-colors hover:bg-red-100 hover:text-red-700 active:bg-red-200"
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
            className="flex flex-col gap-6 rounded-[24px] bg-slate-50 p-6 ring-1 ring-slate-200"
          >
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="text-lg font-semibold tracking-tight text-slate-900">Offline session #{offlineSession.session.id}</div>
                <div className="text-sm font-medium text-slate-500">
                  {offlineReceiptCount} temporary receipt(s) saved · sync required for official invoice numbers
                </div>
              </div>
              <div className={`font-mono text-xl font-bold tracking-tight ${offlineExpired ? "text-red-500" : "text-slate-900"}`}>
                {formatRemaining(offlineRemainingMs)}
              </div>
            </div>
            {offlineSession.session.failure_reason?.message && (
              <div role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600 ring-1 ring-red-200">
                {offlineSession.session.failure_reason.message}
              </div>
            )}
            <section className="flex flex-col gap-4 rounded-[20px] bg-white p-5 shadow-sm ring-1 ring-slate-200">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <div className="text-base font-semibold tracking-tight text-slate-900">Offline receipts</div>
                  <div className="text-sm font-medium text-slate-500">
                    {offlineReceipts.length} editable temporary receipt(s) · next temp number {String(
                      offlineSession.nextReceiptNumber ?? offlineSession.session.receipt_counter + 1
                    ).padStart(4, "0")}
                  </div>
                </div>
                <div className="text-sm font-semibold text-slate-700">
                  Session total ₹{moneyString(parseMoney(offlineSession.session.gross_total))}
                </div>
              </div>
              <ul className="flex flex-col gap-4">
                {offlineReceipts.length === 0 && (
                  <li className="rounded-xl bg-slate-50 px-4 py-3 text-sm font-medium text-slate-500 ring-1 ring-slate-200">
                    No temporary receipts yet.
                  </li>
                )}
                {offlineReceipts.map((receipt) => {
                  const totalCents = receipt.lines.reduce(
                    (acc, line) => acc + (offlinePriceByBarcode.get(line.barcode) ?? 0) * line.quantity,
                    0
                  );
                  return (
                    <li
                      key={receipt.temp_receipt_id}
                      className="flex flex-col gap-4 rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="flex flex-col gap-1">
                          <div className="text-base font-semibold text-slate-900">{receipt.temp_receipt_id}</div>
                          <div className="text-sm font-medium text-slate-500">
                            {receipt.lines.length} line(s) · {receipt.payments.length} payment split(s)
                            {receipt.note ? ` · note: ${receipt.note}` : ""}
                          </div>
                          <div className="font-mono text-sm font-bold text-slate-700">
                            Total ₹{moneyString(totalCents)}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setEditingReceiptId(receipt.temp_receipt_id)}
                          disabled={checkoutLocked}
                          className="flex h-9 items-center justify-center rounded-lg bg-slate-900 px-4 text-xs font-semibold text-white shadow-sm transition-all hover:bg-slate-800 disabled:opacity-50"
                        >
                          Edit
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-2 text-xs font-medium text-slate-600">
                        {receipt.lines.map((line) => (
                          <span key={`${receipt.temp_receipt_id}-${line.barcode}`} className="rounded-lg bg-white px-3 py-1 shadow-sm ring-1 ring-slate-200">
                            {line.barcode} x{line.quantity}
                          </span>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
            <div className="flex flex-wrap gap-4">
              <button
                type="button"
                onClick={extendCurrentOfflineSession}
                disabled={checkoutLocked || offlineSession.session.extension_count >= 1 || offlineExpired}
                className="flex h-11 items-center justify-center rounded-xl bg-amber-100 px-6 text-sm font-bold tracking-wide text-amber-700 shadow-sm transition-all duration-200 hover:bg-amber-200 disabled:pointer-events-none disabled:opacity-50"
              >
                Extend 2h
              </button>
              <button
                type="button"
                onClick={syncCurrentOfflineSession}
                disabled={checkoutLocked || !online || offlineReceiptCount === 0}
                className="flex h-11 items-center justify-center rounded-xl bg-action px-6 text-sm font-bold tracking-wide text-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--color-action)]/30 active:scale-95 disabled:pointer-events-none disabled:opacity-50"
              >
                Sync receipts
              </button>
              <button
                type="button"
                onClick={() => {
                  void resumeOnline();
                }}
                disabled={checkoutLocked}
                className="flex h-11 items-center justify-center rounded-xl bg-slate-900 px-6 text-sm font-bold tracking-wide text-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-slate-900/20 active:scale-95 disabled:pointer-events-none disabled:opacity-50"
              >
                Resume Online
              </button>
            </div>
          </div>
        ) : (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={beginOfflineSession}
              disabled={checkoutLocked || !online}
              className="flex h-11 items-center justify-center rounded-xl bg-slate-900 px-6 text-sm font-bold tracking-wide text-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-slate-900/20 active:scale-95 disabled:pointer-events-none disabled:opacity-50"
            >
              Work offline
            </button>
          </div>
        )}
      </div>

      {offlineSession && editingReceipt && (
        <OfflineReceiptEditorModal
          receipt={editingReceipt}
          catalog={offlineSession.catalog}
          busy={busy}
          onCancel={() => setEditingReceiptId(null)}
          onDelete={() => {
            void deleteEditedOfflineReceipt();
          }}
          onSave={(updated) => {
            void saveEditedOfflineReceipt(updated);
          }}
        />
      )}

      {/* Quick-add modal (issue #26). Same UI as the receiving flow,
          opened when a scan misses the catalog at checkout. The newly
          created product starts as 'pending' with no price, so the
          success path doesn't add it to the cart -- the cashier sees
          the "Pending — no price yet" message and continues with the
          rest of the sale. */}
      {quickAdd && (
        <div
          className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm transition-opacity"
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

      <div className="grid gap-8 font-sans lg:grid-cols-[2fr_1fr]">
      {/* LEFT — cart */}
      <section className="flex flex-col gap-6 rounded-[32px] border border-slate-200/50 bg-white/60 p-8 shadow-[0_8px_40px_rgb(0,0,0,0.02)] backdrop-blur-xl">
        <header className="flex items-center justify-between">
          <h1 className="flex items-center gap-2 text-2xl font-light tracking-tight text-slate-900">
            <ShoppingCart className="h-6 w-6 text-action" /> Checkout
          </h1>
          <div className="flex items-center gap-stack-gap text-label-md text-on-surface-variant">
            <span>{catalogReady ? "Catalog cached" : "Loading catalog…"}</span>
            <button
              type="button"
              onClick={() => {
                invalidateCache();
                setCatalogReady(false);
                void prefetchCatalog(actingShopId).then(() => setCatalogReady(true));
              }}
              disabled={Boolean(offlineSession) || checkoutLocked}
              className="group flex h-8 items-center gap-2 rounded-md bg-slate-100 px-3 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-200 disabled:opacity-50"
            >
              <RefreshCw className="h-3 w-3 transition-transform duration-300 group-hover:rotate-180" /> Refresh
            </button>
          </div>
        </header>

        <form onSubmit={handleSubmitBarcode} className="flex gap-4">
          <input
            type="text"
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            placeholder="Scan or enter barcode"
            className="h-14 flex-1 rounded-2xl border border-slate-200 bg-white px-5 text-lg font-medium text-slate-900 shadow-sm outline-none transition-all focus:border-action focus:ring-1 focus:ring-action disabled:opacity-50"
            autoFocus
            disabled={checkoutLocked}
          />
          <button
            type="submit"
            className="flex h-14 items-center justify-center rounded-2xl bg-action px-8 text-lg font-bold tracking-wide text-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--color-action)]/30 active:scale-95 disabled:pointer-events-none disabled:opacity-50"
            disabled={!catalogReady || checkoutLocked}
          >
            ADD
          </button>
        </form>

        <div className="flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={parkDraft}
            disabled={checkoutLocked || cart.length === 0}
            className="flex h-11 items-center justify-center rounded-xl bg-amber-100 px-6 text-sm font-bold tracking-wide text-amber-700 shadow-sm transition-all duration-200 hover:bg-amber-200 disabled:pointer-events-none disabled:opacity-50"
          >
            Park
          </button>
          <div className="flex flex-wrap items-center gap-2">
            {drafts.map((draft) => (
              <span key={draft.id} className="flex items-center gap-2">
                <span className="text-slate-300">|</span>
                <button
                  type="button"
                  onClick={() => restoreDraft(draft)}
                  disabled={checkoutLocked}
                  className="flex h-11 items-center justify-center rounded-xl bg-slate-900 px-6 text-sm font-bold tracking-wide text-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-slate-900/20 active:scale-95 disabled:pointer-events-none disabled:opacity-50"
                >
                  {draft.label} ({draft.cart.length})
                </button>
                <span className="text-slate-300">|</span>
              </span>
            ))}
          </div>
          <button
            type="button"
            onClick={clearActiveCheckout}
            disabled={checkoutLocked}
            className="ml-auto flex h-11 items-center justify-center rounded-xl bg-slate-100 px-6 text-sm font-semibold tracking-wide text-slate-600 shadow-sm transition-all duration-200 hover:bg-slate-200 hover:text-slate-900 active:scale-95 disabled:pointer-events-none disabled:opacity-50"
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
          disabled={checkoutLocked}
        />

        <ul className="flex flex-col gap-stack-gap">
          {cart.length === 0 && (
            <li className="rounded-xl bg-slate-50 p-6 text-center text-sm font-medium text-slate-500 ring-1 ring-slate-200">
              Cart is empty. Scan a barcode to begin.
            </li>
          )}
          {cart.map((l) => (
            <li
              key={l.lineId}
              className="group flex flex-col gap-4 rounded-[24px] bg-white p-5 shadow-[0_4px_20px_rgba(0,0,0,0.03)] ring-1 ring-slate-200/50 transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_12px_40px_rgba(0,0,0,0.06)] sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex flex-col gap-0.5">
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
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => changeQty(l.lineId, -1)}
                  disabled={checkoutLocked}
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-xl font-medium text-slate-600 transition-colors hover:bg-slate-200 active:bg-slate-300 disabled:opacity-50"
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
                  className="h-11 w-16 rounded-xl border-none bg-slate-50 text-center font-mono text-lg font-semibold text-slate-900 shadow-inner outline-none ring-1 ring-inset ring-slate-200 focus:ring-2 focus:ring-action disabled:opacity-50"
                  aria-label="Quantity"
                  disabled={checkoutLocked}
                />
                <button
                  type="button"
                  onClick={() => changeQty(l.lineId, +1)}
                  disabled={checkoutLocked}
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-xl font-medium text-slate-600 transition-colors hover:bg-slate-200 active:bg-slate-300 disabled:opacity-50"
                  aria-label="Increase quantity"
                >
                  +
                </button>
                <span className="w-24 text-right font-mono text-xl font-medium text-slate-900">
                  ₹{moneyString(parseMoney(l.product.price ?? "0") * l.quantity)}
                </span>
                <button
                  type="button"
                  onClick={() => removeLine(l.lineId)}
                  disabled={checkoutLocked}
                  className="flex h-11 w-11 items-center justify-center rounded-full bg-red-50 text-xl font-medium text-red-500 opacity-0 transition-all duration-300 hover:bg-red-100 active:bg-red-200 group-hover:opacity-100 disabled:opacity-50"
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
      <aside className="flex flex-col gap-6 rounded-[32px] border border-slate-200/50 bg-white/60 p-8 shadow-[0_8px_40px_rgb(0,0,0,0.02)] backdrop-blur-xl">
        <div className="relative overflow-hidden rounded-[24px] bg-slate-900 p-8 text-white shadow-lg">
          <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-gradient-to-br from-indigo-500/30 to-purple-500/30 blur-2xl" />
          <div className="relative z-10 flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-slate-400">
            <ShoppingBag className="h-4 w-4" /> Total Payable
          </div>
          <div className="relative z-10 mt-2 font-mono text-5xl font-light tracking-tight">{totalLabel}</div>
        </div>

        <div className="flex flex-col gap-6">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-xl font-light tracking-tight text-slate-900">
              <CreditCard className="h-5 w-5 text-action" /> Payment
            </h2>
              <button
                type="button"
                onClick={addPayment}
                disabled={checkoutLocked}
                className="rounded-lg bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-200"
              >
                + Split
            </button>
          </div>

          {payments.map((p, idx) => (
            <div key={idx} className="flex items-center gap-3">
              <select
                value={p.mode}
                onChange={(e) => setPaymentMode(idx, e.target.value as PaymentMode)}
                className="h-12 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm font-semibold text-slate-900 shadow-sm outline-none transition-all focus:border-action focus:ring-1 focus:ring-action disabled:opacity-50"
                aria-label="Payment mode"
                disabled={checkoutLocked}
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
                className="h-12 w-32 rounded-xl border border-slate-200 bg-white px-4 text-right font-mono text-sm font-semibold text-slate-900 shadow-sm outline-none transition-all focus:border-action focus:ring-1 focus:ring-action disabled:opacity-50"
                aria-label="Payment amount"
                disabled={checkoutLocked}
              />
              {payments.length > 1 && (
                <button
                  type="button"
                  onClick={() => removePayment(idx)}
                  disabled={checkoutLocked}
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-red-50 text-red-500 transition-colors hover:bg-red-100 hover:text-red-700 active:bg-red-200"
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

        <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
          Note (optional)
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={200}
            className="h-12 rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium text-slate-900 shadow-sm outline-none transition-all focus:border-action focus:ring-1 focus:ring-action disabled:opacity-50"
            disabled={checkoutLocked}
          />
        </label>

        <button
          type="button"
          onClick={finalize}
          disabled={!canFinalize}
          className="group relative flex min-h-[64px] w-full items-center justify-center overflow-hidden rounded-[20px] bg-action text-lg font-bold tracking-wide text-on-action shadow-lg transition-all duration-300 hover:-translate-y-1 hover:shadow-[var(--color-action)]/30 active:scale-[0.98] disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none"
        >
          <div className="absolute inset-0 flex h-full w-full justify-center [transform:skew(-12deg)_translateX(-150%)] group-hover:duration-1000 group-hover:[transform:skew(-12deg)_translateX(150%)]">
            <div className="relative h-full w-8 bg-white/20" />
          </div>
          <span className="relative z-10">{busy ? "Finishing..." : offlineSession ? "Save temporary receipt" : "Finish & Pay"}</span>
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
          className="fixed inset-0 z-30 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm transition-opacity"
          role="dialog"
          aria-modal="true"
        >
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col gap-6 overflow-y-auto rounded-[24px] bg-white p-8 shadow-[0_20px_60px_rgba(0,0,0,0.1)] ring-1 ring-slate-200/50">
            <header className="flex items-start justify-between gap-4">
              <h2 className="text-xl font-light tracking-tight text-slate-900">
                Invoice #{lastInvoice.invoice_number}
              </h2>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={refreshInvoice}
                  className="flex h-11 items-center justify-center rounded-xl bg-slate-100 px-4 text-sm font-semibold tracking-wide text-slate-600 shadow-sm transition-all duration-200 hover:bg-slate-200 hover:text-slate-900 active:scale-95"
                >
                  Refresh
                </button>
                <button
                  type="button"
                  onClick={downloadPdf}
                  disabled={Boolean(offlineSession)}
                  className="flex h-11 items-center justify-center rounded-xl bg-action px-6 text-sm font-bold tracking-wide text-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--color-action)]/30 active:scale-95 disabled:pointer-events-none disabled:opacity-50"
                >
                  PDF
                </button>
                <button
                  type="button"
                  onClick={() => setLastInvoice(null)}
                  className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-900"
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
