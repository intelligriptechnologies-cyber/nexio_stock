import { useEffect, useMemo, useState } from "react";
import type { CheckoutLine, PaymentInput, PaymentMode } from "../api/checkout";
import type { OfflineCatalogItem, OfflineReceiptPayload } from "../api/offline-sessions";
import { ModalDialog } from "./ModalDialog";
import {
  PAYMENT_MODES,
  formatPaymentLabel,
  requiresPaymentNote,
} from "../payment-modes";

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
  const noteRequired = requiresPaymentNote(draft.payments, draft.note);
  const canSave =
    draft.lines.length > 0 &&
    draft.payments.length > 0 &&
    lineTotalCents === paymentTotalCents &&
    !noteRequired &&
    !busy;

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
    if (noteRequired) {
      setError("Add a note when any payment split uses Other.");
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
    <ModalDialog labelledBy="offline-receipt-editor-title" onDismiss={onCancel} className="animate-fade-in fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm">
      <div className="animate-modal-in flex max-h-[90vh] w-full max-w-4xl flex-col gap-6 overflow-y-auto rounded-xl bg-white p-8 shadow-[0_20px_60px_rgba(0,0,0,0.1)] ring-1 ring-slate-200/50">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h2 id="offline-receipt-editor-title" className="text-xl font-semibold tracking-tight text-slate-900">
              Edit {receipt.temp_receipt_id}
            </h2>
            <p className="mt-2 text-sm text-slate-500">
              Temporary receipts stay local until sync. Edits here update the offline stock snapshot.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onDelete}
              disabled={busy}
              className="flex h-11 items-center justify-center rounded-xl bg-red-50 px-6 text-sm font-bold tracking-wide text-red-600 shadow-sm transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:bg-red-100 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-900 disabled:opacity-50"
              aria-label="Close receipt editor"
            >
              &times;
            </button>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <section className="flex flex-col gap-6 rounded-xl border border-slate-200/50 bg-slate-50/50 p-6">
            <div className="flex items-end gap-3">
              <label className="flex flex-1 flex-col gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
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
                  className="h-11 w-full rounded-xl border border-slate-200 bg-white/50 px-4 text-sm font-medium normal-case text-slate-700 shadow-sm outline-none transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:bg-white focus:border-action focus:ring-1 focus:ring-action"
                  disabled={busy}
                />
              </label>
              <button
                type="button"
                onClick={addLine}
                disabled={busy}
                className="flex h-11 items-center justify-center rounded-xl bg-slate-200/50 px-6 text-sm font-bold tracking-wide text-slate-700 shadow-sm transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:bg-slate-200 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50"
              >
                Add
              </button>
            </div>

            <datalist id="offline-receipt-catalog">
              {catalog.map((item) => (
                <option key={item.id} value={item.barcode}>
                  {item.brand} {item.size_label}
                </option>
              ))}
            </datalist>

            <ul className="flex flex-col gap-4">
              {draft.lines.map((line) => {
                const item = catalogByBarcode.get(line.barcode);
                return (
                  <li key={line.barcode} className="flex flex-col gap-4 rounded-[16px] border border-slate-200/50 bg-white p-5 shadow-sm">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="text-base font-semibold text-slate-900">{item ? item.brand : line.barcode}</div>
                        <div className="text-sm font-medium text-slate-500">
                          {item ? item.size_label : "Unknown product"}
                        </div>
                        <div className="font-mono text-xs text-slate-400">{line.barcode}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeLine(line.barcode)}
                        disabled={busy}
                        className="rounded-md px-3 py-1 text-xs font-semibold text-red-500 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </div>
                    <div className="flex items-center justify-between gap-4 border-t border-slate-100 pt-3">
                      <label className="flex items-center gap-3 text-sm font-semibold uppercase tracking-wider text-slate-500">
                        Qty
                        <input
                          type="number"
                          min={1}
                          step="1"
                          value={line.quantity}
                          onChange={(e) => updateLine(line.barcode, Number(e.target.value))}
                          className="h-11 w-20 rounded-xl border border-slate-200 bg-white/50 text-center font-mono text-sm font-medium normal-case text-slate-700 shadow-sm outline-none transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:bg-white focus:border-action focus:ring-1 focus:ring-action"
                          disabled={busy}
                        />
                      </label>
                      <div className="font-mono text-lg font-medium text-slate-900">
                        {item ? `₹${moneyString(parseMoney(item.price) * line.quantity)}` : "--"}
                      </div>
                    </div>
                  </li>
                );
              })}
              {draft.lines.length === 0 && (
                <li className="rounded-xl border border-dashed border-slate-300 py-8 text-center text-sm font-medium text-slate-500">
                  No line items yet.
                </li>
              )}
            </ul>
          </section>

          <aside className="flex flex-col gap-6 rounded-xl border border-slate-200/50 bg-slate-50/50 p-6">
            <div className="relative overflow-hidden rounded-xl bg-slate-900 p-6 text-white shadow-lg">
              <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-gradient-to-br from-[rgba(34,197,94,0.2)] to-white/5 blur-2xl" />
              <div className="relative z-10 text-xs font-bold uppercase tracking-widest text-slate-400">Receipt total</div>
              <div className="relative z-10 mt-2 font-mono text-4xl font-semibold tracking-tight">₹{moneyString(lineTotalCents)}</div>
            </div>

            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold tracking-tight text-slate-900">Payments</h3>
              <button
                type="button"
                onClick={addPayment}
                disabled={busy}
                className="flex items-center justify-center rounded-xl bg-white px-3 py-1 text-xs font-bold tracking-wide text-slate-600 shadow-sm ring-1 ring-slate-200 transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:bg-slate-50 hover:text-slate-900 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50"
              >
                + Split
              </button>
            </div>

            <div className="flex flex-col gap-3">
              {draft.payments.map((payment, idx) => (
                <div key={idx} className="flex items-center gap-3">
                  <select
                    value={payment.mode}
                    onChange={(e) => setPaymentMode(idx, e.target.value as PaymentMode)}
                    className="h-11 flex-1 rounded-xl border border-slate-200 bg-white/50 px-4 text-sm font-medium text-slate-700 shadow-sm outline-none transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:bg-white focus:border-action focus:ring-1 focus:ring-action"
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
                    className="h-11 w-28 rounded-xl border border-slate-200 bg-white/50 px-4 text-right font-mono text-sm font-medium text-slate-700 shadow-sm outline-none transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:bg-white focus:border-action focus:ring-1 focus:ring-action"
                    disabled={busy}
                  />
                  {draft.payments.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removePayment(idx)}
                      disabled={busy}
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-red-50 text-[24px] font-black leading-none text-red-500 transition-colors hover:bg-red-100 disabled:opacity-50"
                      aria-label="Remove payment split"
                    >
                      &times;
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className="flex justify-between border-t border-slate-200/60 pt-4 text-sm font-semibold uppercase tracking-wider text-slate-500">
              <span>Payments sum</span>
              <span className={`font-mono text-base ${paymentTotalCents === lineTotalCents ? "text-emerald-600" : "text-red-500"}`}>
                ₹{moneyString(paymentTotalCents)}
              </span>
            </div>

            <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
              Note {noteRequired ? "(required for Other)" : ""}
              <textarea
                value={draft.note}
                onChange={(e) => setDraft((current) => ({ ...current, note: e.target.value }))}
                maxLength={200}
                rows={3}
                aria-invalid={noteRequired && !draft.note.trim()}
                className="w-full rounded-xl border border-slate-200 bg-white/50 p-4 text-sm font-medium normal-case text-slate-700 shadow-sm outline-none transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:bg-white focus:border-action focus:ring-1 focus:ring-action"
                disabled={busy}
              />
              {noteRequired && !draft.note.trim() && (
                <span className="text-xs font-medium text-red-600">
                  Add a note before saving this receipt.
                </span>
              )}
            </label>

            {error && (
              <div role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600 ring-1 ring-red-200">
                {error}
              </div>
            )}

            <div className="flex flex-wrap justify-end gap-3 pt-4 border-t border-slate-200/60">
              <button
                type="button"
                onClick={onCancel}
                className="flex h-11 items-center justify-center rounded-xl bg-white px-6 text-sm font-semibold tracking-wide text-slate-600 shadow-sm ring-1 ring-slate-200 transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:bg-slate-50 hover:text-slate-900 active:scale-[0.97] disabled:opacity-50"
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={save}
                disabled={!canSave}
                className="flex h-11 items-center justify-center rounded-xl bg-action px-6 text-sm font-bold tracking-wide text-white shadow-sm transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[var(--color-action)]/30 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50"
              >
                Save changes
              </button>
            </div>
          </aside>
        </div>
      </div>
    </ModalDialog>
  );
}
