import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { ApiError } from "../api/client";
import {
  prefetchCatalog,
  resolveBarcode,
  type CatalogProduct,
  invalidateCache,
} from "../api/catalog";
import {
  finalizeCheckout,
  downloadInvoicePdf,
  getInvoice,
  type PaymentMode,
  type InvoicePublic,
} from "../api/checkout";

interface CartLine {
  lineId: string;
  product: CatalogProduct;
  quantity: number;
}

interface PaymentSplit {
  mode: PaymentMode;
  amount: string;
}

const PAYMENT_MODES: PaymentMode[] = ["cash", "upi", "card", "credit"];

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
  return { cash: "Cash", upi: "UPI", card: "Card", credit: "Credit" }[m];
}

export function CheckoutPage() {
  const [cart, setCart] = useState<CartLine[]>([]);
  const [barcode, setBarcode] = useState("");
  const [payments, setPayments] = useState<PaymentSplit[]>([{ mode: "cash", amount: "0.00" }]);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [catalogReady, setCatalogReady] = useState(false);
  const [lastInvoice, setLastInvoice] = useState<InvoicePublic | null>(null);
  const idempotencyKeyRef = useRef<string>(uid());

  // Prefetch the catalog on mount (D-30).
  useEffect(() => {
    prefetchCatalog()
      .then(() => setCatalogReady(true))
      .catch((e) => setError(`Catalog load failed: ${e instanceof Error ? e.message : e}`));
  }, []);

  const totalCents = useMemo(
    () =>
      cart.reduce((acc, l) => {
        const unit = parseMoney(l.product.price);
        return acc + unit * l.quantity;
      }, 0),
    [cart]
  );

  const totalLabel = useMemo(() => `₹${moneyString(totalCents)}`, [totalCents]);

  // When total changes, snap the default payment amount to match (single-mode).
  useEffect(() => {
    if (payments.length === 1) {
      setPayments((p) => [{ ...p[0], amount: moneyString(totalCents) }]);
    }
  }, [totalCents]); // eslint-disable-line react-hooks/exhaustive-deps

  const addByBarcode = useCallback(
    async (raw: string) => {
      const code = raw.trim();
      if (!code) return;
      setError(null);
      setInfo(null);
      try {
        const product = await resolveBarcode(code);
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
      } catch (e) {
        if (e instanceof ApiError) {
          if (e.status === 404) setError(`Barcode not found in catalog: ${code}`);
          else if (e.status === 0) setError("Network error — catalog lookup failed.");
          else setError(e.detail);
        } else {
          setError("Unknown error resolving barcode.");
        }
      }
    },
    []
  );

  const removeLine = (lineId: string) => {
    setCart((prev) => prev.filter((l) => l.lineId !== lineId));
    setError(null);
  };

  const changeQty = (lineId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((l) =>
          l.lineId === lineId ? { ...l, quantity: Math.max(1, l.quantity + delta) } : l
        )
    );
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
    !busy;

  const handleSubmitBarcode = (e: React.FormEvent) => {
    e.preventDefault();
    void addByBarcode(barcode);
    setBarcode("");
  };

  const finalize = async () => {
    setError(null);
    setInfo(null);
    if (!canFinalize) {
      setError("Payments must equal the cart total.");
      return;
    }
    setBusy(true);
    try {
      const res = await finalizeCheckout(
        {
          lines: cart.map((l) => ({ barcode: l.product.barcode, quantity: l.quantity })),
          payments: payments.map((p) => ({ mode: p.mode, amount: moneyString(parseMoney(p.amount)) })),
          note: note.trim() || undefined,
        },
        idempotencyKeyRef.current
      );
      setLastInvoice(res.invoice);
      setCart([]);
      setPayments([{ mode: "cash", amount: "0.00" }]);
      setNote("");
      idempotencyKeyRef.current = uid();
      setInfo(res.is_replay ? "Idempotent replay — same invoice shown." : "Invoice created.");
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 409) setError("Stock changed since scan — refresh the cart.");
        else if (e.status === 400) setError(`Validation error: ${e.detail}`);
        else if (e.status === 0) setError("Network error — finalize failed.");
        else setError(e.detail);
      } else {
        setError("Unknown error finalizing invoice.");
      }
    } finally {
      setBusy(false);
    }
  };

  const downloadPdf = async () => {
    if (!lastInvoice) return;
    try {
      const token = sessionStorage.getItem("barstock.token") ?? "";
      const base = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";
      const blob = await downloadInvoicePdf(lastInvoice.id, base, token);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `invoice-${lastInvoice.invoice_number}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDF download failed.");
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
                void prefetchCatalog().then(() => setCatalogReady(true));
              }}
              className="rounded-md bg-surface-container-high px-stack-gap py-1 text-on-surface-variant"
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
            className="min-h-touchTarget rounded-md bg-accent px-gutter text-label-xl text-on-accent"
            disabled={!catalogReady}
          >
            ADD
          </button>
        </form>

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
              </div>
              <div className="flex items-center gap-stack-gap">
                <button
                  type="button"
                  onClick={() => changeQty(l.lineId, -1)}
                  className="h-12 w-12 rounded-md bg-surface-container-high text-display-lg text-on-surface"
                  aria-label="Decrease quantity"
                >
                  −
                </button>
                <span className="w-12 text-center text-headline-md">{l.quantity}</span>
                <button
                  type="button"
                  onClick={() => changeQty(l.lineId, +1)}
                  className="h-12 w-12 rounded-md bg-surface-container-high text-display-lg text-on-surface"
                  aria-label="Increase quantity"
                >
                  +
                </button>
                <span className="w-24 text-right font-mono text-headline-md text-on-surface">
                  ₹
                  {moneyString(parseMoney(l.product.price) * l.quantity)}
                </span>
                <button
                  type="button"
                  onClick={() => removeLine(l.lineId)}
                  className="h-12 w-12 rounded-md bg-error text-display-lg text-on-error"
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
                className="min-h-touchTarget-sm w-32 rounded-md border border-outline bg-surface px-stack-gap text-right font-mono text-body-md"
                aria-label="Payment amount"
              />
              {payments.length > 1 && (
                <button
                  type="button"
                  onClick={() => removePayment(idx)}
                  className="h-12 w-12 rounded-md bg-error text-display-lg text-on-error"
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
          className="min-h-touchTarget rounded-md bg-accent text-display-lg text-on-accent disabled:opacity-50"
        >
          {busy ? "FINISHING…" : "FINISH & PAY"}
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
                  className="rounded-md bg-primary px-stack-gap py-2 text-label-md text-on-primary"
                >
                  PDF
                </button>
                <button
                  type="button"
                  onClick={() => setLastInvoice(null)}
                  className="h-12 w-12 rounded-md bg-error text-display-lg text-on-error"
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
                    <td className="py-2">{l.product_id}</td>
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
  );
}