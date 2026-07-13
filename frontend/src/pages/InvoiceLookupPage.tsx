import { useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useAuth } from "../auth/AuthProvider";
import { useShopScope } from "../auth/ShopScopeProvider";
import { ApiError } from "../api/client";
import {
  getEodTotals,
  signOffEod,
  todayLocalDateString,
  type EodTotalsResponse,
} from "../api/dashboard";
import {
  editInvoice,
  downloadInvoicePdf,
  listInvoices,
  type InvoicePublic,
  type PaymentMode,
} from "../api/checkout";
import { listShops, type ShopSummary } from "../api/shops";
import { requestVoid } from "../api/voids";
import { notifyVoidApprovalsChanged } from "../api/void-approvals-events";

type Source = "current" | "past";

const PAYMENT_MODES: PaymentMode[] = ["cash", "upi", "card"];
const STATUS_FILTERS: Array<InvoicePublic["status"]> = [
  "finalized",
  "voided",
  "pending_void",
  "reversal",
];

export function InvoiceLookupPage() {
  const { user } = useAuth();
  const { actingShopId, setActingShopId } = useShopScope();
  const [source, setSource] = useState<Source>("current");
  const [rows, setRows] = useState<InvoicePublic[]>([]);
  const [shops, setShops] = useState<ShopSummary[]>([]);
  const [eodTotals, setEodTotals] = useState<EodTotalsResponse | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [voidTarget, setVoidTarget] = useState<InvoicePublic | null>(null);
  const [voidReason, setVoidReason] = useState("");
  const [voidConfirmationText, setVoidConfirmationText] = useState("");
  const [confirmationText, setConfirmationText] = useState("");
  const [closeNotes, setCloseNotes] = useState("");
  const [closeBusy, setCloseBusy] = useState(false);
  const [selected, setSelected] = useState<InvoicePublic | null>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [paymentMode, setPaymentMode] = useState<PaymentMode | "">("");
  const [statusFilter, setStatusFilter] = useState<InvoicePublic["status"] | "">("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [downloadingInvoiceId, setDownloadingInvoiceId] = useState<number | null>(null);
  const [editNote, setEditNote] = useState("");
  const [editPayments, setEditPayments] = useState<{ mode: PaymentMode; amount: string }[]>([]);
  const [editLines, setEditLines] = useState<
    { barcode: string; quantity: number; label: string; unitPrice: string }[]
  >([]);

  const totalUnits = useMemo(
    () => rows.reduce((sum, invoice) => sum + invoice.lines.reduce((n, line) => n + line.quantity, 0), 0),
    [rows]
  );
  const totalValue = useMemo(
    () =>
      rows.reduce((sum, invoice) => {
        const amount = Number.parseFloat(invoice.total_amount);
        return sum + (Number.isFinite(amount) ? amount : 0);
      }, 0),
    [rows]
  );
  const today = todayLocalDateString();
  const selectedShop = useMemo(
    () => shops.find((shop) => shop.id === actingShopId) ?? null,
    [actingShopId, shops]
  );
  const canShowCloseToday =
    user?.role === "superadmin" &&
    source === "current" &&
    actingShopId !== null &&
    eodTotals !== null &&
    eodTotals?.signed_off !== true;
  const paymentTotals = useMemo(() => {
    const byMode = new Map(eodTotals?.payments_by_mode.map((row) => [row.mode, row.amount]) ?? []);
    return PAYMENT_MODES.map((mode) => ({ mode, amount: byMode.get(mode) ?? "0.00" }));
  }, [eodTotals]);

  useEffect(() => {
    if (user?.role !== "superadmin") return;
    let cancelled = false;
    listShops()
      .then((items) => {
        if (!cancelled) setShops(items);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load shops.");
      });
    return () => {
      cancelled = true;
    };
  }, [user?.role]);

  useEffect(() => {
    if (!info) return;
    const timer = window.setTimeout(() => setInfo(null), 4000);
    return () => window.clearTimeout(timer);
  }, [info]);

  const reload = useCallback(async () => {
    if (user?.role === "superadmin" && actingShopId === null) {
      setRows([]);
      setSelected(null);
      setEodTotals(null);
      setError(null);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await listInvoices({
        source,
        shopId: actingShopId,
        dateFrom: source === "past" ? dateFrom || undefined : undefined,
        dateTo: source === "past" ? dateTo || undefined : undefined,
        paymentMode: paymentMode || undefined,
        status: statusFilter || undefined,
      });
      setRows(result.invoices);
      setSelected((current) =>
        current ? result.invoices.find((row) => row.id === current.id) ?? null : null
      );
      if (source === "current") {
        setEodTotals(await getEodTotals(today, actingShopId));
      } else {
        setEodTotals(null);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.detail : "Could not load invoices.");
    } finally {
      setBusy(false);
    }
  }, [actingShopId, dateFrom, dateTo, paymentMode, source, statusFilter, today, user?.role]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const canEdit = (invoice: InvoicePublic) =>
    source === "current" &&
    invoice.status === "finalized" &&
    !invoice.eod_signed_off &&
    (user?.role === "owner" ||
      user?.role === "superadmin" ||
      (user?.role === "cashier_user" && invoice.cashier_user_id === user.id));

  const canRequestVoid = (invoice: InvoicePublic) =>
    invoice.status === "finalized" &&
    (user?.role === "owner" ||
      user?.role === "superadmin" ||
      (user?.role === "cashier_user" && invoice.cashier_user_id === user.id));

  const openVoidDialog = (invoice: InvoicePublic) => {
    if (!canRequestVoid(invoice)) return;
    setVoidTarget(invoice);
    setVoidReason("");
    setVoidConfirmationText("");
  };

  const beginEdit = (invoice: InvoicePublic) => {
    setSelected(invoice);
    setEditNote(invoice.note ?? "");
    setEditPayments(invoice.payments.map((p) => ({ mode: p.mode, amount: p.amount })));
    setEditLines(
      invoice.lines.map((line) => ({
        barcode: String(line.product_id),
        quantity: line.quantity,
        label: `${line.product_brand} ${line.product_size_label}`,
        unitPrice: line.unit_price,
      }))
    );
  };

  const editTotal = useMemo(
    () =>
      editLines
        .reduce((sum, line) => {
          const unit = Number.parseFloat(line.unitPrice);
          return sum + (Number.isFinite(unit) ? unit * line.quantity : 0);
        }, 0)
        .toFixed(2),
    [editLines]
  );

  const setEditLineQuantity = (index: number, quantity: number) => {
    const nextQuantity = Math.max(1, Number.isFinite(quantity) ? Math.floor(quantity) : 1);
    setEditLines((prev) =>
      prev.map((row, i) => (i === index ? { ...row, quantity: nextQuantity } : row))
    );
    if (editPayments.length === 1) {
      const currentLine = editLines[index];
      const currentUnit = Number.parseFloat(currentLine?.unitPrice ?? "0");
      const currentLineTotal = Number.isFinite(currentUnit) ? currentUnit * (currentLine?.quantity ?? 0) : 0;
      const nextLineTotal = Number.isFinite(currentUnit) ? currentUnit * nextQuantity : 0;
      const currentTotal = Number.parseFloat(editTotal);
      const nextTotal = (Number.isFinite(currentTotal) ? currentTotal : 0) - currentLineTotal + nextLineTotal;
      setEditPayments([{ ...editPayments[0], amount: nextTotal.toFixed(2) }]);
    }
  };

  const closeEdit = () => {
    setSelected(null);
    setEditNote("");
    setEditPayments([]);
    setEditLines([]);
    setError(null);
  };

  const saveEdit = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await editInvoice(selected.id, {
        lines: editLines.map((line) => ({ barcode: line.barcode, quantity: line.quantity })),
        payments: editPayments,
        note: editNote.trim() || undefined,
      });
      setSelected(updated);
      setInfo("Invoice updated.");
      await reload();
      closeEdit();
    } catch (e) {
      setError(e instanceof ApiError ? e.detail : "Invoice update failed.");
    } finally {
      setBusy(false);
    }
  };

  const requestVoidForInvoice = async (invoice: InvoicePublic, reason?: string) => {
    setBusy(true);
    setError(null);
    try {
      const updated = await requestVoid(invoice.id, reason);
      setSelected(updated);
      setInfo(
        updated.status === "voided"
          ? `Invoice #${updated.invoice_number} voided.`
          : `Approval request sent for invoice #${updated.invoice_number}.`
      );
      if (updated.status === "pending_void") notifyVoidApprovalsChanged();
      await reload();
      setVoidTarget(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.detail : "Void request failed.");
    } finally {
      setBusy(false);
    }
  };

  const downloadInvoiceForRow = async (invoice: InvoicePublic) => {
    setError(null);
    setDownloadingInvoiceId(invoice.id);
    try {
      const blob = await downloadInvoicePdf(invoice.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `invoice-${invoice.invoice_number}.pdf`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    } catch (e) {
      setError(e instanceof ApiError ? e.detail : "PDF download failed.");
    } finally {
      setDownloadingInvoiceId(null);
    }
  };

  const openSettlementSummary = async () => {
    if (actingShopId === null) return;
    setBusy(true);
    setError(null);
    try {
      const totals = await getEodTotals(today, actingShopId);
      setEodTotals(totals);
      setSummaryOpen(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.detail : "Could not load today summary.");
    } finally {
      setBusy(false);
    }
  };

  const closeSettlementModals = () => {
    setSummaryOpen(false);
    setConfirmOpen(false);
    setConfirmationText("");
    setCloseNotes("");
  };

  const closeToday = async () => {
    if (actingShopId === null || confirmationText !== "CLOSE TODAY") return;
    setCloseBusy(true);
    setError(null);
    try {
      const result = await signOffEod(today, actingShopId, closeNotes.trim() || undefined);
      closeSettlementModals();
      setDateFrom(result.business_date);
      setDateTo(result.business_date);
      setSource("past");
      setInfo(
        `Closed ${selectedShop?.name ?? "selected shop"} for ${result.business_date}. ` +
          `${result.invoices_signed_off} invoice(s) moved to Past Invoices.`
      );
    } catch (e) {
      const detail = e instanceof ApiError ? e.detail : "Could not close today.";
      setError(
        detail.includes("pending_void_approvals_exist")
          ? "Resolve pending void approvals before closing EOD. Open Approvals from the sidebar."
          : detail
      );
    } finally {
      setCloseBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-stack-gap">
      <header>
        <h1 className="text-headline-lg text-primary">Invoices</h1>
        <p className="text-label-md text-on-surface-variant">
          {source === "current"
            ? "Open business-day invoices that are not EOD archived."
            : "Archived invoices after EOD sign-off."}
        </p>
      </header>

      <div className="flex flex-wrap gap-2 border-b border-outline">
        <TabButton active={source === "current"} onClick={() => setSource("current")}>
          Today
        </TabButton>
        <TabButton active={source === "past"} onClick={() => setSource("past")}>
          Past Invoices
        </TabButton>
      </div>

      <section className="grid gap-stack-gap rounded-md bg-surface-container p-stack-gap md:grid-cols-4">
        {user?.role === "superadmin" && (
          <label className="flex flex-col gap-1 text-label-md text-on-surface">
            Shop
            <select
              value={actingShopId ?? ""}
              onChange={(e) => setActingShopId(e.target.value ? Number(e.target.value) : null)}
              className="min-h-touchTarget-sm rounded-md border border-outline bg-surface px-stack-gap"
            >
              <option value="">Select shop</option>
              {shops.map((shop) => (
                <option key={shop.id} value={shop.id}>
                  {shop.name} ({shop.code})
                </option>
              ))}
            </select>
          </label>
        )}
        {source === "past" && (
          <>
            <label className="flex flex-col gap-1 text-label-md text-on-surface">
              Date from
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="min-h-touchTarget-sm rounded-md border border-outline bg-surface px-stack-gap"
              />
            </label>
            <label className="flex flex-col gap-1 text-label-md text-on-surface">
              Date to
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="min-h-touchTarget-sm rounded-md border border-outline bg-surface px-stack-gap"
              />
            </label>
          </>
        )}
        <label className="flex flex-col gap-1 text-label-md text-on-surface">
          Payment mode
          <select
            value={paymentMode}
            onChange={(e) => setPaymentMode(e.target.value as PaymentMode | "")}
            className="min-h-touchTarget-sm rounded-md border border-outline bg-surface px-stack-gap"
          >
            <option value="">All payments</option>
            {PAYMENT_MODES.map((mode) => <option key={mode} value={mode}>{mode.toUpperCase()}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-label-md text-on-surface">
          Status
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as InvoicePublic["status"] | "")}
            className="min-h-touchTarget-sm rounded-md border border-outline bg-surface px-stack-gap"
          >
            <option value="">All statuses</option>
            {STATUS_FILTERS.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
        </label>
        <div className="flex flex-col justify-end gap-1">
          <span className="text-label-md text-transparent" aria-hidden="true">Action</span>
          <button
            type="button"
            onClick={() => void reload()}
            className="min-h-touchTarget-sm rounded-md bg-surface-container-high px-stack-gap text-label-md"
          >
            Refresh
          </button>
        </div>
        {canShowCloseToday && (
          <div className="flex flex-col justify-end gap-1 md:col-span-2">
            <span className="text-label-md text-transparent" aria-hidden="true">Close day</span>
            <button
              type="button"
              onClick={() => void openSettlementSummary()}
              disabled={busy}
              className="min-h-touchTarget-sm rounded-md bg-action px-stack-gap text-label-md text-on-action disabled:opacity-50"
            >
              Reconcile-Settle-Close Today
            </button>
          </div>
        )}
        {user?.role === "superadmin" && source === "current" && actingShopId === null && (
          <div className="flex items-end text-label-md text-on-surface-variant md:col-span-2">
            Select a shop to view and close today&apos;s invoices.
          </div>
        )}
        {user?.role === "superadmin" && source === "current" && eodTotals?.signed_off && (
          <div className="flex items-end text-label-md text-success md:col-span-2">
            Today is already closed for {selectedShop?.name ?? "this shop"}.
          </div>
        )}
      </section>

      {error && <div role="alert" className="rounded-md bg-error px-stack-gap py-3 text-on-error">{error}</div>}
      {info && <div role="status" className="rounded-md bg-success px-stack-gap py-3 text-on-secondary">{info}</div>}

      <section className="overflow-hidden rounded-md border border-outline bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-stack-gap border-b border-outline bg-surface-container px-stack-gap py-3">
          <span className="text-label-md text-on-surface-variant">
            {busy ? "Loading..." : `Showing ${rows.length === 0 ? 0 : 1} - ${rows.length} of ${rows.length}`}
          </span>
          <span className="text-label-md text-on-surface-variant">
            Units: <span className="font-mono text-on-surface">{totalUnits}</span> · Value:{" "}
            <span className="font-mono text-on-surface">₹{totalValue.toFixed(2)}</span>
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1120px] border-collapse text-left">
            <thead className="bg-surface-container text-label-md uppercase text-on-surface-variant">
              <tr>
                <th className="border-b border-outline px-3 py-3">Invoice</th>
                <th className="border-b border-outline px-3 py-3">Business Date</th>
                <th className="border-b border-outline px-3 py-3">Cashier</th>
                <th className="border-b border-outline px-3 py-3">Items</th>
                <th className="border-b border-outline px-3 py-3 text-right">Units</th>
                <th className="border-b border-outline px-3 py-3">Payments</th>
                <th className="border-b border-outline px-3 py-3 text-right">Total</th>
                <th className="border-b border-outline px-3 py-3">Status</th>
                <th className="border-b border-outline px-3 py-3">EOD</th>
                <th className="border-b border-outline px-3 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-3 py-gutter text-center text-on-surface-variant">
                    No invoices found.
                  </td>
                </tr>
              )}
              {rows.map((invoice) => {
                const units = invoice.lines.reduce((sum, line) => sum + line.quantity, 0);
                const itemLabel = invoice.lines
                  .slice(0, 2)
                  .map((line) => `${line.product_brand} ${line.product_size_label}`)
                  .join(", ");
                return (
                  <tr
                    key={invoice.id}
                    className={`border-b border-outline/60 ${
                      invoice.status === "pending_void"
                        ? "bg-surface-container text-on-surface-variant opacity-75"
                        : selected?.id === invoice.id
                          ? "bg-action-muted/60"
                          : "bg-surface"
                    }`}
                  >
                    <td className="px-3 py-3 align-top">
                      <button
                        type="button"
                        onClick={() => beginEdit(invoice)}
                        className="min-h-0 text-left text-label-md text-primary underline-offset-2 hover:underline"
                      >
                        #{invoice.invoice_number}
                      </button>
                      <div className="text-label-md text-on-surface-variant">ID {invoice.id}</div>
                    </td>
                    <td className="px-3 py-3 align-top font-mono text-label-md">{invoice.business_date}</td>
                    <td className="px-3 py-3 align-top text-label-md">User #{invoice.cashier_user_id}</td>
                    <td className="max-w-[280px] px-3 py-3 align-top text-label-md">
                      <span className="block truncate">{itemLabel || "-"}</span>
                      {invoice.lines.length > 2 && (
                        <span className="text-on-surface-variant">+{invoice.lines.length - 2} more</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right align-top font-mono text-label-md">{units}</td>
                    <td className="px-3 py-3 align-top text-label-md">
                      {invoice.payments.map((p) => `${p.mode.toUpperCase()} ₹${p.amount}`).join(", ")}
                    </td>
                    <td className="px-3 py-3 text-right align-top font-mono text-label-md">₹{invoice.total_amount}</td>
                    <td className="px-3 py-3 align-top">
                      <span className="rounded bg-surface-container-high px-2 py-1 text-label-md">
                        {invoice.status}
                      </span>
                    </td>
                    <td className="px-3 py-3 align-top text-label-md">
                      {invoice.eod_signed_off ? "Archived" : "Open"}
                    </td>
                    <td className="px-3 py-3 align-top">
                      <div className="grid min-w-[220px] grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => beginEdit(invoice)}
                          className="min-h-touchTarget-sm rounded-md bg-surface-container-high px-2 text-label-md"
                        >
                          {canEdit(invoice) ? "Edit" : "View"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void downloadInvoiceForRow(invoice)}
                          disabled={downloadingInvoiceId === invoice.id}
                          className="min-h-touchTarget-sm rounded-md bg-surface-container-high px-2 text-label-md disabled:opacity-50"
                        >
                          {downloadingInvoiceId === invoice.id ? "Downloading..." : "Download PDF"}
                        </button>
                        {invoice.status === "pending_void" ? (
                          <button
                            type="button"
                            disabled
                            className="col-span-2 min-h-touchTarget-sm rounded-md bg-surface-container-high px-2 text-label-md text-on-surface-variant opacity-80"
                          >
                            Approval sent
                          </button>
                        ) : canRequestVoid(invoice) ? (
                          <button
                            type="button"
                            onClick={() => openVoidDialog(invoice)}
                            className="col-span-2 min-h-touchTarget-sm rounded-md bg-error px-2 text-label-md text-on-error"
                          >
                            Void
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled
                            className="col-span-2 min-h-touchTarget-sm rounded-md bg-surface-container-high px-2 text-label-md text-on-surface-variant opacity-60"
                          >
                            Locked
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {selected && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-stack-gap"
          role="dialog"
          aria-modal="true"
          aria-labelledby="invoice-edit-title"
        >
          <section className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-md bg-surface shadow-xl">
            <header className="flex items-start justify-between gap-stack-gap border-b border-outline bg-surface-container px-gutter py-stack-gap">
              <div>
                <h2 id="invoice-edit-title" className="text-headline-md text-primary">
                  Invoice #{selected.invoice_number}
                </h2>
                <p className="text-label-md text-on-surface-variant">
                  {selected.business_date} · {selected.status} · ₹{selected.total_amount}
                </p>
              </div>
              <button
                type="button"
                onClick={closeEdit}
                className="h-12 w-12 rounded-md bg-surface-container-high text-headline-md text-on-surface"
                aria-label="Close invoice dialog"
              >
                ×
              </button>
            </header>

            <div className="flex flex-1 flex-col gap-stack-gap overflow-y-auto p-gutter">
              <div className="grid gap-stack-gap text-label-md md:grid-cols-3">
                <div className="rounded-md bg-surface-container p-stack-gap">
                  <div className="text-on-surface-variant">Cashier</div>
                  <div className="font-mono">User #{selected.cashier_user_id}</div>
                </div>
                <div className="rounded-md bg-surface-container p-stack-gap">
                  <div className="text-on-surface-variant">Status</div>
                  <div>{selected.eod_signed_off ? "Archived" : "Open"}</div>
                </div>
                <div className="rounded-md bg-surface-container p-stack-gap">
                  <div className="text-on-surface-variant">Edited total</div>
                  <div className="font-mono">₹{editTotal}</div>
                </div>
              </div>

              <div className="rounded-md border border-outline">
                <div className="grid grid-cols-[1fr_5rem_7rem_7rem] gap-stack-gap border-b border-outline bg-surface-container px-stack-gap py-2 text-label-md uppercase text-on-surface-variant">
                  <span>Item</span>
                  <span className="text-right">Qty</span>
                  <span className="text-right">Unit</span>
                  <span className="text-right">Amount</span>
                </div>
                {editLines.map((line, index) => (
                  <label
                    key={`${line.label}-${index}`}
                    className="grid grid-cols-[1fr_5rem_7rem_7rem] items-center gap-stack-gap border-b border-outline/50 px-stack-gap py-2 text-label-md last:border-b-0"
                  >
                    <span className="truncate">{line.label}</span>
                    <input
                      type="number"
                      min={1}
                      value={line.quantity}
                      disabled={!canEdit(selected)}
                      onChange={(e) => setEditLineQuantity(index, Number(e.target.value))}
                      className="min-h-touchTarget-sm rounded-md border border-outline bg-surface px-2 text-center font-mono disabled:bg-surface-container"
                    />
                    <span className="text-right font-mono">₹{line.unitPrice}</span>
                    <span className="text-right font-mono">
                      ₹{(Number.parseFloat(line.unitPrice) * line.quantity).toFixed(2)}
                    </span>
                  </label>
                ))}
              </div>

              <label className="flex flex-col gap-1 text-label-md">
                Note
                <input
                  value={editNote}
                  disabled={!canEdit(selected)}
                  onChange={(e) => setEditNote(e.target.value)}
                  className="min-h-touchTarget-sm rounded-md border border-outline bg-surface px-stack-gap disabled:bg-surface-container"
                />
              </label>

              <div className="grid gap-stack-gap md:grid-cols-2">
                {editPayments.map((payment, index) => (
                  <div key={index} className="grid grid-cols-[1fr_8rem] gap-stack-gap">
                    <select
                      disabled={!canEdit(selected)}
                      value={payment.mode}
                      onChange={(e) =>
                        setEditPayments((prev) =>
                          prev.map((row, i) =>
                            i === index ? { ...row, mode: e.target.value as PaymentMode } : row
                          )
                        )
                      }
                      className="min-h-touchTarget-sm rounded-md border border-outline bg-surface px-stack-gap disabled:bg-surface-container"
                    >
                      {PAYMENT_MODES.map((mode) => (
                        <option key={mode} value={mode}>
                          {mode.toUpperCase()}
                        </option>
                      ))}
                    </select>
                    <input
                      disabled={!canEdit(selected)}
                      value={payment.amount}
                      onChange={(e) =>
                        setEditPayments((prev) =>
                          prev.map((row, i) =>
                            i === index ? { ...row, amount: e.target.value } : row
                          )
                        )
                      }
                      className="min-h-touchTarget-sm rounded-md border border-outline bg-surface px-stack-gap text-right font-mono disabled:bg-surface-container"
                    />
                  </div>
                ))}
              </div>
            </div>

            <footer className="flex flex-wrap justify-end gap-stack-gap border-t border-outline bg-surface-container px-gutter py-stack-gap">
              {canRequestVoid(selected) && (
                <button
                  type="button"
                  onClick={() => openVoidDialog(selected)}
                  className="min-h-touchTarget-sm rounded-md bg-error px-gutter text-label-md text-on-error"
                >
                  Void
                </button>
              )}
              <button
                type="button"
                onClick={closeEdit}
                className="min-h-touchTarget-sm rounded-md bg-surface-container-high px-gutter text-label-md text-on-surface"
              >
                Cancel
              </button>
              {canEdit(selected) && (
                <button
                  type="button"
                  onClick={() => void saveEdit()}
                  disabled={busy}
                  className="min-h-touchTarget-sm rounded-md bg-action px-gutter text-label-md text-on-action disabled:opacity-50"
                >
                  {busy ? "Saving..." : "Save Changes"}
                </button>
              )}
            </footer>
          </section>
        </div>
      )}

      {summaryOpen && eodTotals && selectedShop && (
        <SettlementSummaryDialog
          shop={selectedShop}
          totals={eodTotals}
          paymentTotals={paymentTotals}
          onCancel={closeSettlementModals}
          onContinue={() => {
            setSummaryOpen(false);
            setConfirmOpen(true);
          }}
        />
      )}

      {confirmOpen && selectedShop && (
        <SettlementConfirmDialog
          shop={selectedShop}
          confirmationText={confirmationText}
          notes={closeNotes}
          busy={closeBusy}
          onConfirmationText={setConfirmationText}
          onNotes={setCloseNotes}
          onCancel={closeSettlementModals}
          onConfirm={() => void closeToday()}
        />
      )}

      {voidTarget && (
        <VoidConfirmDialog
          invoice={voidTarget}
          role={user?.role}
          reason={voidReason}
          confirmationText={voidConfirmationText}
          busy={busy}
          onReason={setVoidReason}
          onConfirmationText={setVoidConfirmationText}
          onCancel={() => setVoidTarget(null)}
          onConfirm={() => void requestVoidForInvoice(voidTarget, voidReason.trim() || undefined)}
        />
      )}
    </div>
  );
}

function SettlementSummaryDialog({
  shop,
  totals,
  paymentTotals,
  onCancel,
  onContinue,
}: {
  shop: ShopSummary;
  totals: EodTotalsResponse;
  paymentTotals: Array<{ mode: PaymentMode; amount: string }>;
  onCancel: () => void;
  onContinue: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-stack-gap"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settlement-summary-title"
    >
      <section className="flex w-full max-w-xl flex-col gap-stack-gap rounded-md bg-surface p-gutter shadow-xl">
        <header>
          <h2 id="settlement-summary-title" className="text-headline-md text-primary">
            {shop.name}
          </h2>
          <p className="text-label-md text-on-surface-variant">
            Reconcile settlement for {totals.business_date}
          </p>
        </header>
        <div className="grid gap-stack-gap md:grid-cols-2">
          <SummaryTile label="Total invoices today" value={String(totals.invoice_count)} />
          <SummaryTile label="Total received" value={`₹${totals.revenue}`} />
        </div>
        <section className="rounded-md border border-outline">
          <h3 className="border-b border-outline bg-surface-container px-stack-gap py-2 text-label-md uppercase text-on-surface-variant">
            Payment modes
          </h3>
          {paymentTotals.map((row) => (
            <div
              key={row.mode}
              className="flex justify-between border-b border-outline/50 px-stack-gap py-2 text-body-md last:border-b-0"
            >
              <span>{row.mode.toUpperCase()}</span>
              <span className="font-mono">₹{row.amount}</span>
            </div>
          ))}
        </section>
        <footer className="flex justify-end gap-stack-gap">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-touchTarget-sm rounded-md bg-surface-container-high px-gutter text-label-md"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onContinue}
            className="min-h-touchTarget-sm rounded-md bg-action px-gutter text-label-md text-on-action"
          >
            Mark Reviewed and Close
          </button>
        </footer>
      </section>
    </div>
  );
}

function VoidConfirmDialog({
  invoice,
  role,
  reason,
  confirmationText,
  busy,
  onReason,
  onConfirmationText,
  onCancel,
  onConfirm,
}: {
  invoice: InvoicePublic;
  role?: string;
  reason: string;
  confirmationText: string;
  busy: boolean;
  onReason: (value: string) => void;
  onConfirmationText: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const isCashier = role === "cashier_user";
  const canConfirm = isCashier || confirmationText === "VOID";
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-stack-gap"
      role="dialog"
      aria-modal="true"
      aria-labelledby="void-confirm-title"
    >
      <section className="flex w-full max-w-lg flex-col gap-stack-gap rounded-md bg-surface p-gutter shadow-xl">
        <header>
          <h2 id="void-confirm-title" className="text-headline-md text-primary">
            Invoice #{invoice.invoice_number}
          </h2>
          <p className="text-label-md text-on-surface-variant">
            {isCashier
              ? "Send this invoice to Approvals. It will still count until approved."
              : "This will fully void the invoice."}
          </p>
        </header>
        <label className="flex flex-col gap-1 text-label-md">
          Reason
          <textarea
            value={reason}
            onChange={(e) => onReason(e.target.value)}
            rows={3}
            maxLength={200}
            className="rounded-md border border-outline bg-surface px-stack-gap py-2"
          />
        </label>
        {!isCashier && (
          <label className="flex flex-col gap-1 text-label-md">
            Type VOID to confirm
            <input
              value={confirmationText}
              onChange={(e) => onConfirmationText(e.target.value)}
              className="min-h-touchTarget-sm rounded-md border border-outline bg-surface px-stack-gap"
              autoFocus
            />
          </label>
        )}
        <footer className="flex justify-end gap-stack-gap">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="min-h-touchTarget-sm rounded-md bg-surface-container-high px-gutter text-label-md"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canConfirm || busy}
            className="min-h-touchTarget-sm rounded-md bg-error px-gutter text-label-md text-on-error disabled:opacity-50"
          >
            {busy ? "Working..." : isCashier ? "Send Approval Request" : "Void Invoice"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function SettlementConfirmDialog({
  shop,
  confirmationText,
  notes,
  busy,
  onConfirmationText,
  onNotes,
  onCancel,
  onConfirm,
}: {
  shop: ShopSummary;
  confirmationText: string;
  notes: string;
  busy: boolean;
  onConfirmationText: (value: string) => void;
  onNotes: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-stack-gap"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settlement-confirm-title"
    >
      <section className="flex w-full max-w-xl flex-col gap-stack-gap rounded-md bg-surface p-gutter shadow-xl">
        <header>
          <h2 id="settlement-confirm-title" className="text-headline-md text-primary">
            Confirm close for {shop.name}
          </h2>
          <p className="text-label-md text-on-surface-variant">
            Type CLOSE TODAY to archive today&apos;s invoices into Past Invoices.
          </p>
        </header>
        <label className="flex flex-col gap-1 text-label-md">
          Confirmation text
          <input
            value={confirmationText}
            onChange={(e) => onConfirmationText(e.target.value)}
            className="min-h-touchTarget-sm rounded-md border border-outline bg-surface px-stack-gap"
            autoFocus
          />
        </label>
        <label className="flex flex-col gap-1 text-label-md">
          Notes
          <textarea
            value={notes}
            onChange={(e) => onNotes(e.target.value)}
            maxLength={500}
            rows={3}
            className="rounded-md border border-outline bg-surface px-stack-gap py-2"
          />
        </label>
        <footer className="flex justify-end gap-stack-gap">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-touchTarget-sm rounded-md bg-surface-container-high px-gutter text-label-md"
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={confirmationText !== "CLOSE TODAY" || busy}
            className="min-h-touchTarget-sm rounded-md bg-action px-gutter text-label-md text-on-action disabled:opacity-50"
          >
            {busy ? "Closing..." : "Close Today"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-surface-container p-stack-gap">
      <div className="text-label-md text-on-surface-variant">{label}</div>
      <div className="font-mono text-headline-md text-on-surface">{value}</div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-touchTarget-sm rounded-t-md px-stack-gap text-label-md ${
        active ? "bg-action text-on-action" : "text-on-surface-variant hover:bg-surface-container"
      }`}
    >
      {children}
    </button>
  );
}
