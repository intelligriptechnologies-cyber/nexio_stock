import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { useShopScope } from "../auth/ShopScopeProvider";
import { AppTabButton } from "../components/AppTabs";
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
import {
  PAYMENT_MODES,
  formatPaymentLabel,
  requiresPaymentNote,
} from "../payment-modes";
import { getMyShop, listShops, type ShopPublic, type ShopSummary } from "../api/shops";
import { requestVoid } from "../api/voids";
import { notifyVoidApprovalsChanged } from "../api/void-approvals-events";
import { ModalDialog } from "../components/ModalDialog";
import { ReceiptText, RefreshCw, Download, XOctagon, Calendar, MapPin, Filter } from "lucide-react";

type Source = "current" | "past";

const STATUS_FILTERS: Array<InvoicePublic["status"]> = [
  "finalized",
  "voided",
  "pending_void",
  "reversal",
];

function cashierLabel(invoice: InvoicePublic) {
  return invoice.cashier_name?.trim() || `User #${invoice.cashier_user_id}`;
}

export function InvoiceLookupPage() {
  const { user } = useAuth();
  const { actingShopId, setActingShopId } = useShopScope();
  const [source, setSource] = useState<Source>("current");
  const [rows, setRows] = useState<InvoicePublic[]>([]);
  const [shops, setShops] = useState<ShopSummary[]>([]);
  const [activeShop, setActiveShop] = useState<ShopPublic | null>(null);
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
    () => activeShop ?? shops.find((shop) => shop.id === actingShopId) ?? null,
    [actingShopId, activeShop, shops]
  );
  const settlementBusinessDate = today;
  const canShowArchiveOpenInvoices =
    (user?.role === "owner" || user?.role === "superadmin") &&
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
    if (user?.role === "superadmin" && actingShopId === null) {
      setActiveShop(null);
      return;
    }
    let cancelled = false;
    getMyShop(user?.role === "superadmin" ? actingShopId : undefined)
      .then((shop) => {
        if (!cancelled) setActiveShop(shop);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load shop.");
      });
    return () => {
      cancelled = true;
    };
  }, [actingShopId, user?.role]);

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
          setEodTotals(await getEodTotals(settlementBusinessDate, actingShopId));
      } else {
        setEodTotals(null);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.detail : "Could not load invoices.");
    } finally {
      setBusy(false);
    }
  }, [actingShopId, dateFrom, dateTo, paymentMode, source, statusFilter, settlementBusinessDate, user?.role]);

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
  const editNoteRequired = requiresPaymentNote(editPayments, editNote);

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
    if (requiresPaymentNote(editPayments, editNote)) {
      setError("Add a note when any payment split uses Other.");
      return;
    }
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
      const totals = await getEodTotals(settlementBusinessDate, actingShopId);
      setEodTotals(totals);
      setSummaryOpen(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.detail : "Could not load open-invoices summary.");
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

  const archiveOpenInvoices = async () => {
    if (actingShopId === null || confirmationText !== "ARCHIVE OPEN INVOICES") return;
    setCloseBusy(true);
    setError(null);
    try {
      const result = await signOffEod(settlementBusinessDate, actingShopId, closeNotes.trim() || undefined);
      closeSettlementModals();
      setDateFrom(result.business_date);
      setDateTo(result.business_date);
      setSource("past");
      setInfo(
        `Closed ${selectedShop?.name ?? "selected shop"} for ${result.business_date}. ` +
          `${result.invoices_signed_off} invoice(s) moved to Past Invoices.`
      );
    } catch (e) {
      const detail = e instanceof ApiError ? e.detail : "Could not archive open invoices.";
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
        <h1 className="flex items-center gap-3 text-3xl font-bold tracking-tight text-slate-900">
          <ReceiptText className="h-8 w-8 text-action" /> Invoices
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          {source === "current"
          ? "Open invoices that are not yet archived."
            : "Archived invoices after EOD sign-off."}
        </p>
      </header>

      <div className="flex flex-col">
        <div className="app-tab-strip">
          <AppTabButton active={source === "current"} onClick={() => setSource("current")}>
            Open Invoices
          </AppTabButton>
          <AppTabButton active={source === "past"} onClick={() => setSource("past")}>
            Past Invoices
          </AppTabButton>
        </div>

        <div className="app-tab-panel flex flex-col gap-6">
          <section className="grid gap-6 rounded-xl border border-slate-200/50 bg-white/60 p-6 shadow-[0_8px_30px_rgb(0,0,0,0.02)] backdrop-blur-xl md:grid-cols-4">
            {user?.role === "superadmin" && (
              <label className="app-form-label">
                <span className="app-form-label-inline"><MapPin className="h-4 w-4" /> Shop</span>
                <select
                  value={actingShopId ?? ""}
                  onChange={(e) => setActingShopId(e.target.value ? Number(e.target.value) : null)}
                  className="app-control"
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
                <label className="app-form-label">
                  <span className="app-form-label-inline"><Calendar className="h-4 w-4" /> Date from</span>
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="app-control"
                  />
                </label>
                <label className="app-form-label">
                  <span className="app-form-label-inline"><Calendar className="h-4 w-4" /> Date to</span>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="app-control"
                  />
                </label>
              </>
            )}
            <label className="app-form-label">
              <span className="app-form-label-inline"><Filter className="h-4 w-4" /> Payment mode</span>
              <select
                value={paymentMode}
                onChange={(e) => setPaymentMode(e.target.value as PaymentMode | "")}
                className="app-control"
              >
                <option value="">All payments</option>
                {PAYMENT_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {formatPaymentLabel(mode)}
                  </option>
                ))}
              </select>
            </label>
            <label className="app-form-label">
              <span className="app-form-label-inline"><Filter className="h-4 w-4" /> Status</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as InvoicePublic["status"] | "")}
                className="app-control"
              >
                <option value="">All statuses</option>
                {STATUS_FILTERS.map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
            </label>
            <div className="flex flex-col justify-end gap-1.5">
              <button
                type="button"
                onClick={() => void reload()}
                className="group flex h-11 items-center justify-center gap-2 rounded-xl bg-slate-100 px-4 text-[0.95rem] font-bold text-slate-700 transition-colors hover:bg-slate-200"
              >
                <RefreshCw className="h-4 w-4 transition-transform duration-300 group-hover:rotate-180" /> Refresh
              </button>
            </div>
            {canShowArchiveOpenInvoices && (
              <div className="flex flex-col justify-end gap-1.5 md:col-span-2">
                <button
                  type="button"
                  onClick={() => void openSettlementSummary()}
                  disabled={busy}
                  className="flex h-11 w-full items-center justify-center rounded-xl bg-action px-6 text-[0.95rem] font-bold tracking-[0.02em] text-slate-900 shadow-lg transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[var(--color-action)]/30 active:scale-[0.97] disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-none"
                >
                  Reconcile Open Invoices
                </button>
              </div>
            )}
            {user?.role === "superadmin" && source === "current" && actingShopId === null && (
              <div className="flex items-end text-sm text-slate-500 md:col-span-2">
                Select a shop to view and archive open invoices.
              </div>
            )}
            {user?.role === "superadmin" && source === "current" && eodTotals?.signed_off && (
              <div className="flex items-end text-sm text-emerald-600 md:col-span-2">
                Open invoices are already archived for {selectedShop?.name ?? "this shop"}.
              </div>
            )}
          </section>

          {error && <div role="alert" className="rounded-xl bg-red-50 px-6 py-4 text-sm font-medium text-red-600 shadow-sm ring-1 ring-red-200">{error}</div>}
          {info && <div role="status" className="rounded-xl bg-emerald-50 px-6 py-4 text-sm font-medium text-emerald-600 shadow-sm ring-1 ring-emerald-200">{info}</div>}

          <section className="overflow-hidden rounded-xl border border-slate-200/50 bg-white/60 shadow-[0_8px_30px_rgb(0,0,0,0.02)] backdrop-blur-xl">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200/50 bg-slate-50/50 px-6 py-4">
          <span className="app-kicker">
            {busy ? "Loading..." : `Showing ${rows.length === 0 ? 0 : 1} - ${rows.length} of ${rows.length}`}
          </span>
          <span className="app-kicker">
            Units: <span className="font-mono text-slate-900">{totalUnits}</span> · Value:{" "}
            <span className="font-mono text-slate-900">₹{totalValue.toFixed(2)}</span>
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="app-list-table min-w-[1040px]">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Business Date</th>
                <th>Cashier</th>
                <th>Items</th>
                <th className="text-right">Units</th>
                <th>Payments</th>
                <th className="text-right">Total</th>
                <th className="text-center">Status / EOD</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-6 py-12 text-center text-slate-500">
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
                    <td>
                      <button
                        type="button"
                        onClick={() => beginEdit(invoice)}
                        className="app-inline-action text-action"
                      >
                        #{invoice.invoice_number}
                      </button>
                    </td>
                    <td className="font-mono text-[0.82rem] text-slate-500">{invoice.business_date}</td>
                    <td className="font-medium text-slate-800">{cashierLabel(invoice)}</td>
                    <td className="max-w-[280px]">
                      <span className="block truncate font-semibold text-slate-900">{itemLabel || "-"}</span>
                      {invoice.lines.length > 2 && (
                        <span className="mt-1 block text-[0.82rem] font-medium text-slate-500">+{invoice.lines.length - 2} more</span>
                      )}
                    </td>
                    <td className="text-right font-mono font-semibold text-slate-900">{units}</td>
                    <td className="font-medium text-slate-700">
                      {invoice.payments.map((p) => `${formatPaymentLabel(p.mode)} ₹${p.amount}`).join(", ")}
                    </td>
                    <td className="text-right font-mono font-semibold text-slate-900">₹{invoice.total_amount}</td>
                    <td className="text-center">
                      <div className="flex flex-col items-center gap-1.5">
                        <span
                          className={`inline-flex w-fit items-center rounded-md px-2.5 py-1 text-[0.78rem] font-bold ${
                            invoice.status === "finalized"
                              ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-600/20"
                              : invoice.status === "voided"
                                ? "bg-red-50 text-red-700 ring-1 ring-red-600/20"
                                : "bg-amber-50 text-amber-700 ring-1 ring-amber-600/20"
                          }`}
                        >
                          {invoice.status}
                        </span>
                        <span className="text-[0.82rem] font-semibold text-slate-500">
                          {invoice.eod_signed_off ? "Archived" : "Open"}
                        </span>
                      </div>
                    </td>
                    <td>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() => beginEdit(invoice)}
                          title={canEdit(invoice) ? "Edit" : "View"}
                          className="app-inline-action text-action disabled:pointer-events-none disabled:text-slate-400 disabled:no-underline"
                        >
                          {canEdit(invoice) ? "Edit" : "View"}
                        </button>
                        {invoice.status === "pending_void" ? (
                          <span title="Approval sent" className="app-inline-action-muted">
                            Void
                          </span>
                        ) : canRequestVoid(invoice) ? (
                          <button
                            type="button"
                            onClick={() => openVoidDialog(invoice)}
                            title="Void"
                            className="app-inline-action text-red-600"
                          >
                            Void
                          </button>
                        ) : (
                          <span title="Locked" className="app-inline-action-muted">
                            Void
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => void downloadInvoiceForRow(invoice)}
                          disabled={downloadingInvoiceId === invoice.id}
                          title="Download PDF"
                          aria-label={downloadingInvoiceId === invoice.id ? "Downloading PDF" : "Download PDF"}
                          aria-busy={downloadingInvoiceId === invoice.id}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-action transition-colors hover:bg-action/10 disabled:pointer-events-none disabled:text-slate-400"
                        >
                          <Download className={`h-3.5 w-3.5 ${downloadingInvoiceId === invoice.id ? "animate-pulse" : ""}`} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
          </section>
        </div>
      </div>

      {selected && (
        <ModalDialog labelledBy="invoice-edit-title" onDismiss={closeEdit} className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm transition-opacity">
          <section className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-[0_20px_60px_rgba(0,0,0,0.1)] ring-1 ring-slate-200/50">
            <header className="flex items-start justify-between gap-4 border-b border-slate-200/50 bg-slate-50/80 px-6 py-5">
              <div>
                <h2 id="invoice-edit-title" className="text-xl font-bold tracking-tight text-slate-900">
                  Invoice #{selected.invoice_number}
                </h2>
                <p className="mt-1 flex items-center gap-2 text-[0.82rem] font-semibold text-slate-500">
                  <span>{selected.business_date}</span>
                  <span>&middot;</span>
                  <span className="uppercase tracking-[0.12em]">{selected.status}</span>
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
                  <div className="app-section-title">Cashier</div>
                  <div className="mt-1 text-[0.95rem] font-semibold text-slate-900">{cashierLabel(selected)}</div>
                </div>
                <div className="rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
                  <div className="app-section-title">Status</div>
                  <div className="mt-1 text-[0.95rem] font-semibold text-slate-900">{selected.eod_signed_off ? "Archived" : "Open"}</div>
                </div>
                <div className="rounded-xl bg-slate-50 p-4 ring-1 ring-slate-200">
                  <div className="app-section-title">Edited total</div>
                  <div className="mt-1 font-mono text-[0.98rem] font-semibold text-slate-900">₹{editTotal}</div>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200">
                <div className="grid grid-cols-[1fr_5rem_7rem_7rem] gap-4 border-b border-slate-200 bg-slate-50/50 px-4 py-3 text-[0.72rem] font-bold uppercase tracking-[0.14em] text-slate-500">
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
                      className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-center font-mono text-sm shadow-sm outline-none transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out focus:border-action focus:ring-1 focus:ring-action disabled:bg-slate-50 disabled:opacity-50"
                    />
                    <span className="text-right font-mono text-slate-900">₹{line.unitPrice}</span>
                    <span className="text-right font-mono text-slate-900">
                      ₹{(Number.parseFloat(line.unitPrice) * line.quantity).toFixed(2)}
                    </span>
                  </label>
                ))}
              </div>

              <label className="flex flex-col gap-2 text-[0.95rem] font-semibold text-slate-700">
                Note {editNoteRequired ? "(required for Other)" : ""}
                <input
                  value={editNote}
                  disabled={!canEdit(selected)}
                  onChange={(e) => setEditNote(e.target.value)}
                  aria-invalid={editNoteRequired && !editNote.trim()}
                  className="h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm shadow-sm outline-none transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out focus:border-action focus:ring-1 focus:ring-action disabled:bg-slate-50 disabled:opacity-50"
                />
                {editNoteRequired && !editNote.trim() && (
                  <span className="text-xs font-medium text-red-600">
                    Add a note before saving this invoice.
                  </span>
                )}
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
                      className="h-11 rounded-xl border border-slate-200 bg-slate-50 px-4 text-[0.95rem] font-semibold text-slate-900 shadow-sm outline-none transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out focus:border-action focus:ring-1 focus:ring-action disabled:opacity-50"
                    >
                      {PAYMENT_MODES.map((mode) => (
                        <option key={mode} value={mode}>
                          {formatPaymentLabel(mode)}
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
                      className="h-11 rounded-xl border border-slate-200 bg-white px-4 text-right font-mono text-sm shadow-sm outline-none transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out focus:border-action focus:ring-1 focus:ring-action disabled:bg-slate-50 disabled:opacity-50"
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
                  className="flex h-11 items-center justify-center rounded-xl bg-red-50 px-6 text-sm font-bold tracking-wide text-red-500 shadow-sm transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:bg-red-100 hover:text-red-700 active:scale-[0.97]"
                >
                  Void
                </button>
              )}
              <button
                type="button"
                onClick={closeEdit}
                className="flex h-11 items-center justify-center rounded-xl bg-slate-100 px-6 text-sm font-semibold tracking-wide text-slate-600 shadow-sm transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:bg-slate-200 hover:text-slate-900 active:scale-[0.97]"
              >
                Cancel
              </button>
              {canEdit(selected) && (
                <button
                  type="button"
                  onClick={() => void saveEdit()}
                  disabled={busy || editNoteRequired}
                  className="min-h-touchTarget-sm rounded-md bg-action px-gutter text-label-md text-on-action disabled:opacity-50"
                >
                  {busy ? "Saving..." : "Save Changes"}
                </button>
              )}
            </footer>
          </section>
        </ModalDialog>
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
          onConfirm={() => void archiveOpenInvoices()}
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
    <ModalDialog labelledBy="settlement-summary-title" onDismiss={onCancel} className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm transition-opacity">
      <section className="flex w-full max-w-xl flex-col gap-6 overflow-hidden rounded-xl bg-white shadow-[0_20px_60px_rgba(0,0,0,0.1)] ring-1 ring-slate-200/50 p-6">
        <header>
          <h2 id="settlement-summary-title" className="text-xl font-bold tracking-tight text-slate-900">
            {shop.name}
          </h2>
          <p className="mt-1 text-sm font-medium text-slate-500">
            Reconcile settlement for <span className="font-mono text-slate-700">{totals.business_date}</span>
          </p>
        </header>
        <div className="grid gap-6 md:grid-cols-2">
          <SummaryTile label="Total open invoices" value={String(totals.invoice_count)} />
          <SummaryTile label="Total received" value={`₹${totals.revenue}`} />
        </div>
        <section className="rounded-2xl border border-slate-200 bg-white/50 overflow-hidden">
          <h3 className="border-b border-slate-200 bg-slate-50/80 px-4 py-3 text-[0.72rem] font-bold uppercase tracking-[0.14em] text-slate-500 backdrop-blur-sm">
            Payment modes
          </h3>
          <div className="divide-y divide-slate-100">
            {paymentTotals.map((row) => (
              <div
                key={row.mode}
                className="flex justify-between px-4 py-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50/50"
              >
                <span>{formatPaymentLabel(row.mode as PaymentMode)}</span>
                <span className="font-mono text-slate-900">₹{row.amount}</span>
              </div>
            ))}
          </div>
        </section>
        <footer className="flex flex-wrap justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="flex h-11 items-center justify-center rounded-xl bg-white px-6 text-sm font-semibold tracking-wide text-slate-600 shadow-sm ring-1 ring-slate-200 transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:bg-slate-50 hover:text-slate-900 active:scale-[0.97]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onContinue}
            className="flex h-11 items-center justify-center rounded-xl bg-action px-6 text-sm font-bold tracking-wide text-white shadow-sm transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[var(--color-action)]/30 active:scale-[0.97]"
          >
            Mark Reviewed and Close
          </button>
        </footer>
      </section>
    </ModalDialog>
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
    <ModalDialog labelledBy="void-confirm-title" onDismiss={onCancel} className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm transition-opacity">
      <section className="flex w-full max-w-lg flex-col gap-6 overflow-hidden rounded-xl bg-white shadow-[0_20px_60px_rgba(0,0,0,0.1)] ring-1 ring-slate-200/50 p-6">
        <header>
          <h2 id="void-confirm-title" className="text-xl font-bold tracking-tight text-slate-900">
            Invoice #{invoice.invoice_number}
          </h2>
          <p className="mt-1 text-sm font-medium text-slate-500">
            {isCashier
              ? "Send this invoice to Approvals. It will still count until approved."
              : "This will fully void the invoice."}
          </p>
        </header>
        <label className="app-form-label">
          Reason
          <textarea
            value={reason}
            onChange={(e) => onReason(e.target.value)}
            rows={3}
            maxLength={200}
            className="app-control-textarea"
          />
        </label>
        {!isCashier && (
          <label className="app-form-label">
            Type VOID to confirm
            <input
              value={confirmationText}
              onChange={(e) => onConfirmationText(e.target.value)}
              className="app-control w-full normal-case"
              autoFocus
            />
          </label>
        )}
        <footer className="flex flex-wrap justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="flex h-11 items-center justify-center rounded-xl bg-white px-6 text-sm font-semibold tracking-wide text-slate-600 shadow-sm ring-1 ring-slate-200 transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:bg-slate-50 hover:text-slate-900 active:scale-[0.97] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canConfirm || busy}
            className="flex h-11 items-center justify-center rounded-xl bg-red-600 px-6 text-sm font-bold tracking-wide text-white shadow-sm transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-red-600/30 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50"
          >
            {busy ? "Working..." : isCashier ? "Send Approval Request" : "Void Invoice"}
          </button>
        </footer>
      </section>
    </ModalDialog>
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
    <ModalDialog labelledBy="settlement-confirm-title" onDismiss={onCancel} className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-sm transition-opacity">
      <section className="flex w-full max-w-xl flex-col gap-6 overflow-hidden rounded-xl bg-white shadow-[0_20px_60px_rgba(0,0,0,0.1)] ring-1 ring-slate-200/50 p-6">
        <header>
          <h2 id="settlement-confirm-title" className="text-xl font-bold tracking-tight text-slate-900">
            Confirm close for {shop.name}
          </h2>
          <p className="mt-1 text-sm font-medium text-slate-500">
            Type ARCHIVE OPEN INVOICES to archive the open invoices into Past Invoices.
          </p>
        </header>
        <label className="app-form-label">
          Confirmation text
          <input
            value={confirmationText}
            onChange={(e) => onConfirmationText(e.target.value)}
            className="app-control w-full normal-case"
            autoFocus
          />
        </label>
        <label className="app-form-label">
          Notes
          <textarea
            value={notes}
            onChange={(e) => onNotes(e.target.value)}
            maxLength={500}
            rows={3}
            className="app-control-textarea"
          />
        </label>
        <footer className="flex flex-wrap justify-end gap-3 pt-2">
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
            onClick={onConfirm}
            disabled={confirmationText !== "ARCHIVE OPEN INVOICES" || busy}
            className="flex h-11 items-center justify-center rounded-xl bg-action px-6 text-sm font-bold tracking-wide text-white shadow-sm transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[var(--color-action)]/30 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50"
          >
            {busy ? "Archiving..." : "Archive Open Invoices"}
          </button>
        </footer>
      </section>
    </ModalDialog>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-[16px] border border-slate-200 bg-slate-50/50 p-5">
      <div className="app-section-title">{label}</div>
      <div className="text-3xl font-bold tracking-tight text-slate-900">{value}</div>
    </div>
  );
}
