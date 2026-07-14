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
import { ReceiptText, RefreshCw, Download, XOctagon, Edit3, Eye, Calendar, MapPin, Filter } from "lucide-react";

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
    <div className="flex flex-col gap-8 font-sans">
      <header>
        <h1 className="flex items-center gap-3 text-3xl font-light tracking-tight text-slate-900">
          <ReceiptText className="h-8 w-8 text-action" /> Invoices
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          {source === "current"
            ? "Open business-day invoices that are not EOD archived."
            : "Archived invoices after EOD sign-off."}
        </p>
      </header>

      <div className="flex flex-wrap gap-2 border-b border-slate-200/60 pb-4">
        <TabButton active={source === "current"} onClick={() => setSource("current")}>
          Today
        </TabButton>
        <TabButton active={source === "past"} onClick={() => setSource("past")}>
          Past Invoices
        </TabButton>
      </div>

      <section className="grid gap-6 rounded-[24px] border border-slate-200/50 bg-white/60 p-6 shadow-[0_8px_30px_rgb(0,0,0,0.02)] backdrop-blur-xl md:grid-cols-4">
        {user?.role === "superadmin" && (
          <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
            <span className="flex items-center gap-1.5"><MapPin className="h-4 w-4" /> Shop</span>
            <select
              value={actingShopId ?? ""}
              onChange={(e) => setActingShopId(e.target.value ? Number(e.target.value) : null)}
              className="h-11 rounded-xl border border-slate-200 bg-white/50 px-4 text-sm font-medium text-slate-700 shadow-sm outline-none transition-all hover:bg-white focus:border-action focus:ring-1 focus:ring-action"
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
            <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
              <span className="flex items-center gap-1.5"><Calendar className="h-4 w-4" /> Date from</span>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="h-11 rounded-xl border border-slate-200 bg-white/50 px-4 text-sm font-medium text-slate-700 shadow-sm outline-none transition-all hover:bg-white focus:border-action focus:ring-1 focus:ring-action"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
              <span className="flex items-center gap-1.5"><Calendar className="h-4 w-4" /> Date to</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="h-11 rounded-xl border border-slate-200 bg-white/50 px-4 text-sm font-medium text-slate-700 shadow-sm outline-none transition-all hover:bg-white focus:border-action focus:ring-1 focus:ring-action"
              />
            </label>
          </>
        )}
        <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
          <span className="flex items-center gap-1.5"><Filter className="h-4 w-4" /> Payment mode</span>
          <select
            value={paymentMode}
            onChange={(e) => setPaymentMode(e.target.value as PaymentMode | "")}
            className="h-11 rounded-xl border border-slate-200 bg-white/50 px-4 text-sm font-medium text-slate-700 shadow-sm outline-none transition-all hover:bg-white focus:border-action focus:ring-1 focus:ring-action"
          >
            <option value="">All payments</option>
            {PAYMENT_MODES.map((mode) => <option key={mode} value={mode}>{mode.toUpperCase()}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
          <span className="flex items-center gap-1.5"><Filter className="h-4 w-4" /> Status</span>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as InvoicePublic["status"] | "")}
            className="h-11 rounded-xl border border-slate-200 bg-white/50 px-4 text-sm font-medium text-slate-700 shadow-sm outline-none transition-all hover:bg-white focus:border-action focus:ring-1 focus:ring-action"
          >
            <option value="">All statuses</option>
            {STATUS_FILTERS.map((status) => <option key={status} value={status}>{status}</option>)}
          </select>
        </label>
        <div className="flex flex-col justify-end gap-1.5">
          <button
            type="button"
            onClick={() => void reload()}
            className="group flex h-11 items-center justify-center gap-2 rounded-xl bg-slate-100 px-4 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-200"
          >
            <RefreshCw className="h-4 w-4 transition-transform duration-300 group-hover:rotate-180" /> Refresh
          </button>
        </div>
        {canShowCloseToday && (
          <div className="flex flex-col justify-end gap-1.5 md:col-span-2">
            <button
              type="button"
              onClick={() => void openSettlementSummary()}
              disabled={busy}
              className="flex h-11 w-full items-center justify-center rounded-xl bg-action px-6 text-sm font-bold tracking-wide text-on-action shadow-lg transition-all hover:-translate-y-0.5 hover:shadow-[var(--color-action)]/30 active:scale-95 disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none"
            >
              Reconcile-Settle-Close Today
            </button>
          </div>
        )}
        {user?.role === "superadmin" && source === "current" && actingShopId === null && (
          <div className="flex items-end text-sm text-slate-500 md:col-span-2">
            Select a shop to view and close today&apos;s invoices.
          </div>
        )}
        {user?.role === "superadmin" && source === "current" && eodTotals?.signed_off && (
          <div className="flex items-end text-sm text-emerald-600 md:col-span-2">
            Today is already closed for {selectedShop?.name ?? "this shop"}.
          </div>
        )}
      </section>

      {error && <div role="alert" className="rounded-xl bg-red-50 px-6 py-4 text-sm font-medium text-red-600 shadow-sm ring-1 ring-red-200">{error}</div>}
      {info && <div role="status" className="rounded-xl bg-emerald-50 px-6 py-4 text-sm font-medium text-emerald-600 shadow-sm ring-1 ring-emerald-200">{info}</div>}

      <section className="overflow-hidden rounded-[24px] border border-slate-200/50 bg-white/60 shadow-[0_8px_30px_rgb(0,0,0,0.02)] backdrop-blur-xl">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200/50 bg-slate-50/50 px-6 py-4">
          <span className="text-sm font-medium text-slate-500">
            {busy ? "Loading..." : `Showing ${rows.length === 0 ? 0 : 1} - ${rows.length} of ${rows.length}`}
          </span>
          <span className="text-sm font-medium text-slate-500">
            Units: <span className="font-mono text-slate-900">{totalUnits}</span> · Value:{" "}
            <span className="font-mono text-slate-900">₹{totalValue.toFixed(2)}</span>
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1120px] text-left text-sm">
            <thead className="bg-slate-50/80 text-[11px] uppercase tracking-widest text-slate-500">
              <tr>
                <th className="px-6 py-4 font-semibold">Invoice</th>
                <th className="px-6 py-4 font-semibold">Business Date</th>
                <th className="px-6 py-4 font-semibold">Cashier</th>
                <th className="px-6 py-4 font-semibold">Items</th>
                <th className="px-6 py-4 text-right font-semibold">Units</th>
                <th className="px-6 py-4 font-semibold">Payments</th>
                <th className="px-6 py-4 text-right font-semibold">Total</th>
                <th className="px-6 py-4 font-semibold">Status</th>
                <th className="px-6 py-4 font-semibold">EOD</th>
                <th className="px-6 py-4 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-6 py-12 text-center text-slate-500">
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
                    className={`group bg-white transition-colors duration-200 hover:bg-slate-50/50 ${
                      invoice.status === "pending_void"
                        ? "text-slate-400 opacity-75"
                        : selected?.id === invoice.id
                          ? "bg-slate-50"
                          : ""
                    }`}
                  >
                    <td className="px-6 py-4 align-top">
                      <button
                        type="button"
                        onClick={() => beginEdit(invoice)}
                        className="font-medium text-action underline-offset-4 hover:underline"
                      >
                        #{invoice.invoice_number}
                      </button>
                      <div className="mt-1 text-xs text-slate-400">ID {invoice.id}</div>
                    </td>
                    <td className="px-6 py-4 align-top font-mono text-xs text-slate-500">{invoice.business_date}</td>
                    <td className="px-6 py-4 align-top text-slate-700">User #{invoice.cashier_user_id}</td>
                    <td className="max-w-[280px] px-6 py-4 align-top">
                      <span className="block truncate font-medium text-slate-900">{itemLabel || "-"}</span>
                      {invoice.lines.length > 2 && (
                        <span className="mt-1 block text-xs text-slate-500">+{invoice.lines.length - 2} more</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right align-top font-mono font-medium text-slate-900">{units}</td>
                    <td className="px-6 py-4 align-top text-slate-700">
                      {invoice.payments.map((p) => `${p.mode.toUpperCase()} ₹${p.amount}`).join(", ")}
                    </td>
                    <td className="px-6 py-4 text-right align-top font-mono font-semibold text-slate-900">₹{invoice.total_amount}</td>
                    <td className="px-6 py-4 align-top">
                      <span className={`inline-flex items-center rounded-md px-2 py-1 text-xs font-semibold ${
                        invoice.status === "finalized" ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/20" :
                        invoice.status === "voided" ? "bg-red-50 text-red-700 ring-1 ring-red-600/20" :
                        "bg-amber-50 text-amber-700 ring-1 ring-amber-600/20"
                      }`}>
                        {invoice.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 align-top text-xs font-medium text-slate-500">
                      {invoice.eod_signed_off ? "Archived" : "Open"}
                    </td>
                    <td className="px-6 py-4 align-top">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => beginEdit(invoice)}
                          title={canEdit(invoice) ? "Edit" : "View"}
                          className="flex h-8 w-8 items-center justify-center rounded-md bg-white text-slate-600 shadow-sm ring-1 ring-slate-200 transition-colors hover:bg-slate-50 hover:text-slate-900"
                        >
                          {canEdit(invoice) ? <Edit3 className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                        </button>
                        <button
                          type="button"
                          onClick={() => void downloadInvoiceForRow(invoice)}
                          disabled={downloadingInvoiceId === invoice.id}
                          title="Download PDF"
                          className="flex h-8 w-8 items-center justify-center rounded-md bg-white text-slate-600 shadow-sm ring-1 ring-slate-200 transition-colors hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50"
                        >
                          <Download className="h-4 w-4" />
                        </button>
                        {invoice.status === "pending_void" ? (
                          <span title="Approval sent" className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-50 text-slate-400">
                            <XOctagon className="h-4 w-4" />
                          </span>
                        ) : canRequestVoid(invoice) ? (
                          <button
                            type="button"
                            onClick={() => openVoidDialog(invoice)}
                            title="Void"
                            className="flex h-8 w-8 items-center justify-center rounded-md bg-red-50 text-red-600 transition-colors hover:bg-red-100"
                          >
                            <XOctagon className="h-4 w-4" />
                          </button>
                        ) : (
                          <span title="Locked" className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-50 text-slate-400">
                            <XOctagon className="h-4 w-4 opacity-50" />
                          </span>
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm transition-opacity"
          role="dialog"
          aria-modal="true"
          aria-labelledby="invoice-edit-title"
        >
          <section className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-[24px] bg-white shadow-[0_20px_60px_rgba(0,0,0,0.1)] ring-1 ring-slate-200/50">
            <header className="flex items-start justify-between gap-4 border-b border-slate-200/50 bg-slate-50/80 px-6 py-5">
              <div>
                <h2 id="invoice-edit-title" className="text-xl font-light tracking-tight text-slate-900">
                  Invoice #{selected.invoice_number}
                </h2>
                <p className="mt-1 flex items-center gap-2 text-xs font-medium text-slate-500">
                  <span>{selected.business_date}</span>
                  <span>&middot;</span>
                  <span className="uppercase tracking-wider">{selected.status}</span>
                  <span>&middot;</span>
                  <span className="font-mono text-slate-900">₹{selected.total_amount}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={closeEdit}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-200/50 text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-900"
                aria-label="Close invoice dialog"
              >
                <XOctagon className="h-4 w-4" />
              </button>
            </header>

            <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-6">
              <div className="grid gap-4 text-sm font-semibold text-slate-700 md:grid-cols-3">
                <div className="rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
                  <div className="text-slate-500">Cashier</div>
                  <div className="font-mono text-slate-900">User #{selected.cashier_user_id}</div>
                </div>
                <div className="rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
                  <div className="text-slate-500">Status</div>
                  <div className="text-slate-900">{selected.eod_signed_off ? "Archived" : "Open"}</div>
                </div>
                <div className="rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
                  <div className="text-slate-500">Edited total</div>
                  <div className="font-mono text-slate-900">₹{editTotal}</div>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200">
                <div className="grid grid-cols-[1fr_5rem_7rem_7rem] gap-4 border-b border-slate-200 bg-slate-50/50 px-4 py-3 text-xs font-bold uppercase tracking-wider text-slate-500">
                  <span>Item</span>
                  <span className="text-right">Qty</span>
                  <span className="text-right">Unit</span>
                  <span className="text-right">Amount</span>
                </div>
                {editLines.map((line, index) => (
                  <label
                    key={`${line.label}-${index}`}
                    className="grid grid-cols-[1fr_5rem_7rem_7rem] items-center gap-4 border-b border-slate-200/50 px-4 py-3 text-sm font-semibold text-slate-700 last:border-b-0"
                  >
                    <span className="truncate">{line.label}</span>
                    <input
                      type="number"
                      min={1}
                      value={line.quantity}
                      disabled={!canEdit(selected)}
                      onChange={(e) => setEditLineQuantity(index, Number(e.target.value))}
                      className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-center font-mono text-sm shadow-sm outline-none transition-all focus:border-action focus:ring-1 focus:ring-action disabled:bg-slate-50 disabled:opacity-50"
                    />
                    <span className="text-right font-mono text-slate-900">₹{line.unitPrice}</span>
                    <span className="text-right font-mono text-slate-900">
                      ₹{(Number.parseFloat(line.unitPrice) * line.quantity).toFixed(2)}
                    </span>
                  </label>
                ))}
              </div>

              <label className="flex flex-col gap-2 text-sm font-semibold text-slate-700">
                Note
                <input
                  value={editNote}
                  disabled={!canEdit(selected)}
                  onChange={(e) => setEditNote(e.target.value)}
                  className="h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm shadow-sm outline-none transition-all focus:border-action focus:ring-1 focus:ring-action disabled:bg-slate-50 disabled:opacity-50"
                />
              </label>

              <div className="grid gap-4 md:grid-cols-2">
                {editPayments.map((payment, index) => (
                  <div key={index} className="grid grid-cols-[1fr_8rem] gap-4">
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
                      className="h-11 rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm font-semibold text-slate-900 shadow-sm outline-none transition-all focus:border-action focus:ring-1 focus:ring-action disabled:opacity-50"
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
                      className="h-11 rounded-xl border border-slate-200 bg-white px-4 text-right font-mono text-sm shadow-sm outline-none transition-all focus:border-action focus:ring-1 focus:ring-action disabled:bg-slate-50 disabled:opacity-50"
                    />
                  </div>
                ))}
              </div>
            </div>

            <footer className="flex flex-wrap justify-end gap-3 border-t border-slate-200/50 bg-slate-50/80 px-6 py-4">
              {canRequestVoid(selected) && (
                <button
                  type="button"
                  onClick={() => openVoidDialog(selected)}
                  className="flex h-11 items-center justify-center rounded-xl bg-red-50 px-6 text-sm font-bold tracking-wide text-red-500 shadow-sm transition-all hover:bg-red-100 hover:text-red-700 active:scale-95"
                >
                  Void
                </button>
              )}
              <button
                type="button"
                onClick={closeEdit}
                className="flex h-11 items-center justify-center rounded-xl bg-slate-100 px-6 text-sm font-semibold tracking-wide text-slate-600 shadow-sm transition-all duration-200 hover:bg-slate-200 hover:text-slate-900 active:scale-95"
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
      className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm transition-opacity"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settlement-summary-title"
    >
      <section className="flex w-full max-w-xl flex-col gap-6 overflow-hidden rounded-[24px] bg-white shadow-[0_20px_60px_rgba(0,0,0,0.1)] ring-1 ring-slate-200/50 p-6">
        <header>
          <h2 id="settlement-summary-title" className="text-xl font-light tracking-tight text-slate-900">
            {shop.name}
          </h2>
          <p className="mt-1 text-sm font-medium text-slate-500">
            Reconcile settlement for <span className="font-mono text-slate-700">{totals.business_date}</span>
          </p>
        </header>
        <div className="grid gap-6 md:grid-cols-2">
          <SummaryTile label="Total invoices today" value={String(totals.invoice_count)} />
          <SummaryTile label="Total received" value={`₹${totals.revenue}`} />
        </div>
        <section className="rounded-2xl border border-slate-200 bg-white/50 overflow-hidden">
          <h3 className="border-b border-slate-200 bg-slate-50/80 px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-500 backdrop-blur-sm">
            Payment modes
          </h3>
          <div className="divide-y divide-slate-100">
            {paymentTotals.map((row) => (
              <div
                key={row.mode}
                className="flex justify-between px-4 py-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50/50"
              >
                <span>{row.mode.toUpperCase()}</span>
                <span className="font-mono text-slate-900">₹{row.amount}</span>
              </div>
            ))}
          </div>
        </section>
        <footer className="flex flex-wrap justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex h-11 items-center justify-center rounded-xl bg-white px-6 text-sm font-semibold tracking-wide text-slate-600 shadow-sm ring-1 ring-slate-200 transition-all duration-200 hover:bg-slate-50 hover:text-slate-900 active:scale-95"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onContinue}
            className="flex h-11 items-center justify-center rounded-xl bg-action px-6 text-sm font-bold tracking-wide text-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--color-action)]/30 active:scale-95"
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm transition-opacity"
      role="dialog"
      aria-modal="true"
      aria-labelledby="void-confirm-title"
    >
      <section className="flex w-full max-w-lg flex-col gap-6 overflow-hidden rounded-[24px] bg-white shadow-[0_20px_60px_rgba(0,0,0,0.1)] ring-1 ring-slate-200/50 p-6">
        <header>
          <h2 id="void-confirm-title" className="text-xl font-light tracking-tight text-slate-900">
            Invoice #{invoice.invoice_number}
          </h2>
          <p className="mt-1 text-sm font-medium text-slate-500">
            {isCashier
              ? "Send this invoice to Approvals. It will still count until approved."
              : "This will fully void the invoice."}
          </p>
        </header>
        <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
          Reason
          <textarea
            value={reason}
            onChange={(e) => onReason(e.target.value)}
            rows={3}
            maxLength={200}
            className="w-full rounded-xl border border-slate-200 bg-white/50 p-4 text-sm font-medium normal-case text-slate-700 shadow-sm outline-none transition-all hover:bg-white focus:border-action focus:ring-1 focus:ring-action"
          />
        </label>
        {!isCashier && (
          <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Type VOID to confirm
            <input
              value={confirmationText}
              onChange={(e) => onConfirmationText(e.target.value)}
              className="h-11 w-full rounded-xl border border-slate-200 bg-white/50 px-4 text-sm font-medium normal-case text-slate-700 shadow-sm outline-none transition-all hover:bg-white focus:border-action focus:ring-1 focus:ring-action"
              autoFocus
            />
          </label>
        )}
        <footer className="flex flex-wrap justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="flex h-11 items-center justify-center rounded-xl bg-white px-6 text-sm font-semibold tracking-wide text-slate-600 shadow-sm ring-1 ring-slate-200 transition-all duration-200 hover:bg-slate-50 hover:text-slate-900 active:scale-95 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canConfirm || busy}
            className="flex h-11 items-center justify-center rounded-xl bg-red-600 px-6 text-sm font-bold tracking-wide text-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-red-600/30 active:scale-95 disabled:pointer-events-none disabled:opacity-50"
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm transition-opacity"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settlement-confirm-title"
    >
      <section className="flex w-full max-w-xl flex-col gap-6 overflow-hidden rounded-[24px] bg-white shadow-[0_20px_60px_rgba(0,0,0,0.1)] ring-1 ring-slate-200/50 p-6">
        <header>
          <h2 id="settlement-confirm-title" className="text-xl font-light tracking-tight text-slate-900">
            Confirm close for {shop.name}
          </h2>
          <p className="mt-1 text-sm font-medium text-slate-500">
            Type CLOSE TODAY to archive today&apos;s invoices into Past Invoices.
          </p>
        </header>
        <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
          Confirmation text
          <input
            value={confirmationText}
            onChange={(e) => onConfirmationText(e.target.value)}
            className="h-11 w-full rounded-xl border border-slate-200 bg-white/50 px-4 text-sm font-medium normal-case text-slate-700 shadow-sm outline-none transition-all hover:bg-white focus:border-action focus:ring-1 focus:ring-action"
            autoFocus
          />
        </label>
        <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
          Notes
          <textarea
            value={notes}
            onChange={(e) => onNotes(e.target.value)}
            maxLength={500}
            rows={3}
            className="w-full rounded-xl border border-slate-200 bg-white/50 p-4 text-sm font-medium normal-case text-slate-700 shadow-sm outline-none transition-all hover:bg-white focus:border-action focus:ring-1 focus:ring-action"
          />
        </label>
        <footer className="flex flex-wrap justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex h-11 items-center justify-center rounded-xl bg-white px-6 text-sm font-semibold tracking-wide text-slate-600 shadow-sm ring-1 ring-slate-200 transition-all duration-200 hover:bg-slate-50 hover:text-slate-900 active:scale-95 disabled:opacity-50"
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={confirmationText !== "CLOSE TODAY" || busy}
            className="flex h-11 items-center justify-center rounded-xl bg-action px-6 text-sm font-bold tracking-wide text-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--color-action)]/30 active:scale-95 disabled:pointer-events-none disabled:opacity-50"
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
    <div className="flex flex-col gap-1 rounded-[16px] border border-slate-200 bg-slate-50/50 p-5">
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      <div className="text-3xl font-light tracking-tight text-slate-900">{value}</div>
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
      className={`group relative flex h-11 items-center justify-center gap-2 rounded-full px-6 text-sm font-bold tracking-wide transition-all duration-300 ${
        active 
          ? "bg-action text-white shadow-[0_4px_20px_rgba(var(--color-action-rgb),0.3)] hover:-translate-y-0.5" 
          : "bg-white text-slate-500 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50 hover:text-slate-700"
      }`}
    >
      {children}
    </button>
  );
}
