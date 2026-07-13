import { useEffect, useMemo, useState } from "react";
import type { CheckoutLine, PaymentInput, PaymentMode } from "../api/checkout";
import type { OfflineCatalogItem, OfflineReceiptPayload } from "../api/offline-sessions";

const PAYMENT_MODES: PaymentMode[] = ["cash", "upi", "card"];

interface DraftLine {
  barcode: string;
  quantity: number;
}

interface ReceiptDraft {
  lines: DraftLine[];
  payments: PaymentInput[];
  note: string;
  newBarcode: string;
}

interface OfflineReceiptEditorModalProps {
  receipt: OfflineReceiptPayload | null;
  catalog: OfflineCatalogItem[];
  busy?: boolean;
  onCancel: () => void;
  onDelete: () => void;
  onSave: (receipt: OfflineReceiptPayload) => void;
}

function moneyString(cents: number): string {
  return (cents / 100).toFixed(2);
}

function parseMoney(value: string): number {
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

function formatPaymentLabel(mode: PaymentMode): string {
  return { cash: "Cash", upi: "UPI", card: "Card" }[mode];
}

function createDraft(receipt: OfflineReceiptPayload | null): ReceiptDraft {
  return {
    lines: receipt?.lines.map((line) => ({ barcode: line.barcode, quantity: line.quantity })) ?? [],
    payments: receipt?.payments.map((payment) => ({ ...payment })) ?? [{ mode: "cash", amount: "0.00" }],
    note: receipt?.note ?? "",
    newBarcode: "",
  };
}

function receiptLineTotalCents(lines: DraftLine[], catalogByBarcode: Map<string, OfflineCatalogItem>): number {
  return lines.reduce((acc, line) => {
    const item = catalogByBarcode.get(line.barcode);
    return acc + (item ? parseMoney(item.price) * line.quantity : 0);
  }, 0);
}

export function OfflineReceiptEditorModal({
  receipt,
  catalog,
  busy = false,
  onCancel,
  onDelete,
  onSave,
}: OfflineReceiptEditorModalProps) {
  const [draft, setDraft] = useState<ReceiptDraft>(() => createDraft(receipt));
  const [error, setError] = useState<string | null>(null);
  const catalogByBarcode = useMemo(
    () => new Map(catalog.map((item) => [item.barcode, item])),
    [catalog]
  );

  useEffect(() => {
    setDraft(createDraft(receipt));
    setError(null);
  }, [receipt]);

  if (!receipt) return null;

  const lineTotalCents = receiptLineTotalCents(draft.lines, catalogByBarcode);
  const paymentTotalCents = draft.payments.reduce((acc, payment) => acc + parseMoney(payment.amount), 0);
  const canSave = draft.lines.length > 0 && draft.payments.length > 0 && lineTotalCents === paymentTotalCents && !busy;

  const addLine = () => {
    const barcode = draft.newBarcode.trim();
    if (!barcode) return;
    const item = catalogByBarcode.get(barcode);
    if (!item) {
      setError(`Barcode not found in offline catalog: ${barcode}`);
      return;
    }
    setDraft((current) => {
      const existing = current.lines.find((line) => line.barcode === barcode);
      const nextLines = existing
        ? current.lines.map((line) =>
            line.barcode === barcode ? { ...line, quantity: line.quantity + 1 } : line
          )
        : [...current.lines, { barcode, quantity: 1 }];
      return { ...current, lines: nextLines, newBarcode: "" };
    });
    setError(null);
  };

  const updateLine = (barcode: string, quantity: number) => {
    setDraft((current) => ({
      ...current,
      lines: current.lines.map((line) =>
        line.barcode === barcode ? { ...line, quantity: Math.max(1, Math.floor(quantity) || 1) } : line
      ),
    }));
  };

  const removeLine = (barcode: string) => {
    setDraft((current) => ({
      ...current,
      lines: current.lines.filter((line) => line.barcode !== barcode),
    }));
  };

  const setPaymentMode = (idx: number, mode: PaymentMode) => {
    setDraft((current) => ({
      ...current,
      payments: current.payments.map((payment, i) => (i === idx ? { ...payment, mode } : payment)),
    }));
  };

  const setPaymentAmount = (idx: number, amount: string) => {
    setDraft((current) => ({
      ...current,
      payments: current.payments.map((payment, i) => (i === idx ? { ...payment, amount } : payment)),
    }));
  };

  const addPayment = () => {
    setDraft((current) => ({
      ...current,
      payments: [...current.payments, { mode: "upi", amount: "0.00" }],
    }));
  };

  const removePayment = (idx: number) => {
    setDraft((current) => ({
      ...current,
      payments: current.payments.length === 1 ? current.payments : current.payments.filter((_, i) => i !== idx),
    }));
  };

  const save = () => {
    setError(null);
    if (draft.lines.length === 0) {
      setError("Add at least one line item.");
      return;
    }
    if (draft.payments.length === 0) {
      setError("Add at least one payment split.");
      return;
    }
    if (lineTotalCents !== paymentTotalCents) {
      setError("Payment splits must equal the receipt total.");
      return;
    }

    onSave({
      temp_receipt_id: receipt.temp_receipt_id,
      idempotency_key: receipt.idempotency_key,
      lines: draft.lines as CheckoutLine[],
      payments: draft.payments,
      note: draft.note.trim() || undefined,
      created_at: receipt.created_at,
    });
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-stack-gap"
      role="dialog"
      aria-modal="true"
      aria-labelledby="offline-receipt-editor-title"
    >
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col gap-stack-gap overflow-y-auto rounded-lg bg-surface-container p-gutter">
        <header className="flex items-start justify-between gap-stack-gap">
          <div>
            <h2 id="offline-receipt-editor-title" className="text-headline-md text-primary">
              Edit {receipt.temp_receipt_id}
            </h2>
            <p className="mt-1 text-label-md text-on-surface-variant">
              Temporary receipts stay local until sync. Edits here update the offline stock snapshot.
            </p>
          </div>
          <div className="flex gap-stack-gap">
            <button
              type="button"
              onClick={onDelete}
              disabled={busy}
              className="rounded-md bg-error px-stack-gap py-2 text-label-md text-on-error disabled:opacity-50"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="flex h-12 w-12 items-center justify-center rounded-md bg-surface-container-high text-[28px] font-black leading-none text-on-surface"
              aria-label="Close receipt editor"
            >
              &times;
            </button>
          </div>
        </header>

        <div className="grid gap-stack-gap lg:grid-cols-[1.4fr_1fr]">
          <section className="flex flex-col gap-stack-gap rounded-md bg-surface p-stack-gap">
            <div className="flex items-end gap-stack-gap">
              <label className="flex flex-1 flex-col gap-1 text-label-md">
                Add barcode
                <input
                  type="text"
                  list="offline-receipt-catalog"
                  value={draft.newBarcode}
                  onChange={(e) => setDraft((current) => ({ ...current, newBarcode: e.target.value }))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addLine();
                    }
                  }}
                  placeholder="Scan or type barcode"
                  className="min-h-touchTarget-sm rounded-md border border-outline bg-surface px-stack-gap text-body-md"
                  disabled={busy}
                />
              </label>
              <button
                type="button"
                onClick={addLine}
                disabled={busy}
                className="min-h-touchTarget-sm rounded-md bg-action px-stack-gap text-label-md text-on-action"
              >
                Add line
              </button>
            </div>

            <datalist id="offline-receipt-catalog">
              {catalog.map((item) => (
                <option key={item.id} value={item.barcode}>
                  {item.brand} {item.size_label}
                </option>
              ))}
            </datalist>

            <ul className="flex flex-col gap-stack-gap">
              {draft.lines.map((line) => {
                const item = catalogByBarcode.get(line.barcode);
                return (
                  <li key={line.barcode} className="flex flex-col gap-3 rounded-md border border-outline/60 bg-surface-container-high p-stack-gap">
                    <div className="flex items-start justify-between gap-stack-gap">
                      <div>
                        <div className="text-label-xl text-on-surface">{item ? item.brand : line.barcode}</div>
                        <div className="text-label-md text-on-surface-variant">
                          {item ? item.size_label : "Unknown product"}
                        </div>
                        <div className="font-mono text-label-md text-on-surface-variant">{line.barcode}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeLine(line.barcode)}
                        disabled={busy}
                        className="rounded-md bg-error px-stack-gap py-2 text-label-md text-on-error"
                      >
                        Remove
                      </button>
                    </div>
                    <div className="flex items-center justify-between gap-stack-gap">
                      <label className="flex items-center gap-2 text-label-md">
                        Qty
                        <input
                          type="number"
                          min={1}
                          step="1"
                          value={line.quantity}
                          onChange={(e) => updateLine(line.barcode, Number(e.target.value))}
                          className="h-12 w-20 rounded-md border border-outline bg-surface text-center font-mono text-body-md"
                          disabled={busy}
                        />
                      </label>
                      <div className="font-mono text-body-md">
                        {item ? `₹${moneyString(parseMoney(item.price) * line.quantity)}` : "--"}
                      </div>
                    </div>
                  </li>
                );
              })}
              {draft.lines.length === 0 && (
                <li className="rounded-md bg-surface-container-high px-stack-gap py-3 text-label-md text-on-surface-variant">
                  No line items yet.
                </li>
              )}
            </ul>
          </section>

          <aside className="flex flex-col gap-stack-gap rounded-md bg-surface p-stack-gap">
            <div className="rounded-md bg-primary p-stack-gap text-on-primary">
              <div className="text-label-md uppercase">Receipt total</div>
              <div className="font-mono text-headline-md">₹{moneyString(lineTotalCents)}</div>
            </div>

            <div className="flex items-center justify-between">
              <h3 className="text-headline-sm text-on-surface">Payments</h3>
              <button
                type="button"
                onClick={addPayment}
                disabled={busy}
                className="rounded-md bg-surface-container-high px-stack-gap py-1 text-label-md text-on-surface-variant"
              >
                + Split
              </button>
            </div>

            {draft.payments.map((payment, idx) => (
              <div key={idx} className="flex items-center gap-stack-gap">
                <select
                  value={payment.mode}
                  onChange={(e) => setPaymentMode(idx, e.target.value as PaymentMode)}
                  className="min-h-touchTarget-sm flex-1 rounded-md border border-outline bg-surface px-stack-gap text-body-md"
                  disabled={busy}
                >
                  {PAYMENT_MODES.map((mode) => (
                    <option key={mode} value={mode}>
                      {formatPaymentLabel(mode)}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={payment.amount}
                  onChange={(e) => setPaymentAmount(idx, e.target.value)}
                  className="min-h-touchTarget-sm w-32 rounded-md border border-outline bg-surface px-stack-gap text-right font-mono text-body-md"
                  disabled={busy}
                />
                {draft.payments.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removePayment(idx)}
                    disabled={busy}
                    className="flex h-12 w-12 items-center justify-center rounded-md bg-error text-[28px] font-black leading-none text-on-error"
                    aria-label="Remove payment split"
                  >
                    &times;
                  </button>
                )}
              </div>
            ))}

            <div className="flex justify-between text-label-md text-on-surface-variant">
              <span>Payments sum</span>
              <span className={`font-mono ${paymentTotalCents === lineTotalCents ? "text-success" : "text-error"}`}>
                ₹{moneyString(paymentTotalCents)}
              </span>
            </div>

            <label className="flex flex-col gap-1 text-label-md">
              Note
              <textarea
                value={draft.note}
                onChange={(e) => setDraft((current) => ({ ...current, note: e.target.value }))}
                maxLength={200}
                rows={5}
                className="rounded-md border border-outline bg-surface px-stack-gap py-2 text-body-md"
                disabled={busy}
              />
            </label>

            {error && (
              <div role="alert" className="rounded-md bg-error px-stack-gap py-3 text-on-error">
                {error}
              </div>
            )}

            <div className="flex gap-stack-gap">
              <button
                type="button"
                onClick={onCancel}
                className="min-h-touchTarget flex-1 rounded-md bg-surface-container-high text-label-xl text-on-surface"
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={save}
                disabled={!canSave}
                className="min-h-touchTarget flex-1 rounded-md bg-action text-label-xl text-on-action disabled:opacity-50"
              >
                Save changes
              </button>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
