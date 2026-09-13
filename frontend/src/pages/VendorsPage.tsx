import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Truck, RefreshCw, Plus, Save, Download } from "lucide-react";
import { ApiError, toUserMessage } from "../api/client";
import {
  createVendor,
  downloadVendorsExport,
  listVendorsPage,
  updateVendor,
  type VendorPublic,
} from "../api/vendors";
import { useShopScope } from "../auth/ShopScopeProvider";
import { triggerDownload } from "../utils/csv";
import { Pagination } from "../components/Pagination";
import { pageOffset, pageSizeParam, positiveInt, STANDARD_PAGE_SIZES } from "../utils/pagination";

export function VendorsPage() {
  const { actingShopId } = useShopScope();
  const [vendors, setVendors] = useState<VendorPublic[]>([]);
  const [total, setTotal] = useState(0);
  const [searchParams, setSearchParams] = useSearchParams();
  const page = positiveInt(searchParams.get("page"), 1);
  const pageSize = pageSizeParam(searchParams.get("pageSize"), STANDARD_PAGE_SIZES, 25);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const includeInactive = searchParams.get("inactive") === "true";
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (actingShopId == null) {
      setVendors([]);
      return;
    }
    setError(null);
    setBusy(true);
    void listVendorsPage({ shopId: actingShopId, includeInactive, limit: pageSize, offset: pageOffset(page, pageSize) })
      .then((result) => {
        setVendors(result.data);
        setTotal(result.total);
        setSelectedId((current) =>
          current != null && result.data.some((vendor) => vendor.id === current) ? current : null
        );
      })
      .catch((e) => setError(toUserMessage(e, "Could not load vendors.")))
      .finally(() => setBusy(false));
  }, [actingShopId, includeInactive, page, pageSize]);

  const selected = useMemo(
    () => vendors.find((vendor) => vendor.id === selectedId) ?? null,
    [vendors, selectedId]
  );

  if (actingShopId == null) {
    return (
      <div className="flex h-[50vh] items-center justify-center rounded-xl border border-slate-200/50 bg-white/60 p-8 shadow-[0_8px_30px_rgb(0,0,0,0.02)] backdrop-blur-xl">
        <div className="text-center text-sm font-medium text-slate-500">
          Pick a shop first (top of the sidebar).
        </div>
      </div>
    );
  }

  const refresh = () => {
    setBusy(true);
    void listVendorsPage({ shopId: actingShopId, includeInactive, limit: pageSize, offset: pageOffset(page, pageSize) })
      .then((result) => {
        setVendors(result.data);
        setTotal(result.total);
        setSelectedId((current) =>
          current != null && result.data.some((vendor) => vendor.id === current) ? current : null
        );
      })
      .catch((e) => setError(toUserMessage(e, "Could not load vendors.")))
      .finally(() => setBusy(false));
  };

  const setPage = (nextPage: number, nextSize = pageSize, replace = false) => {
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.set("page", String(nextPage)); next.set("pageSize", String(nextSize));
      return next;
    }, { replace });
  };

  const clearMessage = () => {
    setError(null);
    setInfo(null);
  };

  const submitCreate = async (payload: VendorFormValues) => {
    clearMessage();
    setBusy(true);
    try {
      const { is_active: _ignored, ...createPayload } = payload;
      await createVendor(createPayload, actingShopId);
      setInfo("Vendor created.");
      refresh();
    } catch (e) {
      setError(toUserMessage(e, "Create vendor failed."));
    } finally {
      setBusy(false);
    }
  };

  const submitUpdate = async (vendorId: number, payload: VendorFormValues) => {
    clearMessage();
    setBusy(true);
    try {
      await updateVendor(vendorId, payload, actingShopId);
      setInfo("Vendor updated.");
      refresh();
    } catch (e) {
      if (e instanceof ApiError) setError(e.detail);
      else setError(toUserMessage(e, "Update vendor failed."));
    } finally {
      setBusy(false);
    }
  };

  const exportRows = async () => {
    try {
      const result = await downloadVendorsExport(actingShopId, includeInactive);
      triggerDownload(result.blob, result.filename ?? "vendors.csv");
    } catch (e) { setError(toUserMessage(e, "Export failed.")); }
  };

  return (
    <div className="flex flex-col gap-8 font-sans">
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200/50 bg-white/60 p-6 shadow-[0_8px_30px_rgb(0,0,0,0.02)] backdrop-blur-xl">
        <div>
          <h1 className="flex items-center gap-3 text-2xl font-bold tracking-tight text-slate-900">
            <Truck className="h-6 w-6 text-action" /> Vendors
          </h1>
          <p className="mt-1 text-sm font-medium text-slate-500">
            Shop-scoped supplier list for receiving.
          </p>
        </div>
        <label className="flex items-center gap-2 text-sm font-medium text-slate-600">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => setSearchParams((current) => {
              const next = new URLSearchParams(current);
              if (e.target.checked) next.set("inactive", "true"); else next.delete("inactive");
              next.set("page", "1"); return next;
            })}
            className="h-4 w-4 rounded border-slate-300 text-action focus:ring-action"
          />
          Include inactive
        </label>
        <button
          type="button"
          onClick={() => void exportRows()}
          disabled={busy || vendors.length === 0}
          className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-slate-600 shadow-sm ring-1 ring-slate-200 transition-colors hover:bg-slate-50 hover:text-slate-900 disabled:pointer-events-none disabled:opacity-50"
          aria-label="Download vendors CSV"
          title="Download CSV"
        >
          <Download className="h-4 w-4" />
        </button>
      </header>

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

      <div className="grid gap-8 lg:grid-cols-[380px_1fr]">
        <VendorForm
          key={selected?.id ?? "new"}
          vendor={selected}
          busy={busy}
          onCreate={submitCreate}
          onUpdate={submitUpdate}
          onNew={() => setSelectedId(null)}
        />

        <section className="flex flex-col gap-6 rounded-xl border border-slate-200/50 bg-white/60 p-6 shadow-[0_8px_30px_rgb(0,0,0,0.02)] backdrop-blur-xl">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold tracking-tight text-slate-900">Vendor list</h2>
            <button
              type="button"
              onClick={refresh}
              className="group flex h-10 items-center justify-center rounded-xl bg-white px-5 text-sm font-semibold tracking-wide text-slate-700 shadow-sm ring-1 ring-slate-200 transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:scale-[1.02] hover:bg-slate-50 hover:shadow-md active:scale-[0.97]"
            >
              <RefreshCw className="h-4 w-4 text-slate-400 transition-transform duration-300 group-hover:rotate-180" />
              <span className="ml-2">Refresh</span>
            </button>
          </div>
          <div className="max-h-[calc(100vh-18rem)] overflow-y-auto rounded-2xl border border-slate-200 bg-white custom-scrollbar">
            <table className="app-list-table">
              <thead className="sticky top-0 z-10 bg-slate-50/90 text-[11px] uppercase tracking-widest text-slate-500 backdrop-blur-sm">
                <tr>
                  <th className="px-6 py-4 font-semibold">Name</th>
                  <th className="px-6 py-4 font-semibold">GSTIN</th>
                  <th className="px-6 py-4 font-semibold">Phone</th>
                  <th className="px-6 py-4 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {vendors.map((vendor) => (
                  <tr
                    key={vendor.id}
                    className={`cursor-pointer transition-colors ${
                      selectedId === vendor.id ? "bg-action/5" : "hover:bg-slate-50/50"
                    }`}
                    onClick={() => setSelectedId(vendor.id)}
                  >
                    <td className="px-6 py-4 font-medium text-slate-900">{vendor.name}</td>
                    <td className="px-6 py-4 font-mono text-slate-500">{vendor.gstin ?? "-"}</td>
                    <td className="px-6 py-4 font-mono text-slate-500">{vendor.phone ?? "-"}</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        vendor.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"
                      }`}>
                        {vendor.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                  </tr>
                ))}
                {vendors.length === 0 && (
                  <tr>
                    <td className="px-6 py-8 text-center text-slate-500" colSpan={4}>
                      No vendors yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={pageSize} total={total} disabled={busy}
            label="vendors" pageSizes={STANDARD_PAGE_SIZES}
            onPageChange={setPage} onPageSizeChange={(size) => setPage(1, size, true)} />
        </section>
      </div>
    </div>
  );
}

interface VendorFormValues {
  name: string;
  gstin?: string | null;
  address?: string | null;
  email?: string | null;
  phone?: string | null;
  is_active?: boolean;
}

function VendorForm({
  vendor,
  busy,
  onCreate,
  onUpdate,
  onNew,
}: {
  vendor: VendorPublic | null;
  busy: boolean;
  onCreate: (payload: VendorFormValues) => Promise<void>;
  onUpdate: (vendorId: number, payload: VendorFormValues) => Promise<void>;
  onNew: () => void;
}) {
  const [name, setName] = useState(vendor?.name ?? "");
  const [gstin, setGstin] = useState(vendor?.gstin ?? "");
  const [address, setAddress] = useState(vendor?.address ?? "");
  const [email, setEmail] = useState(vendor?.email ?? "");
  const [phone, setPhone] = useState(vendor?.phone ?? "");
  const [isActive, setIsActive] = useState(vendor?.is_active ?? true);

  useEffect(() => {
    setName(vendor?.name ?? "");
    setGstin(vendor?.gstin ?? "");
    setAddress(vendor?.address ?? "");
    setEmail(vendor?.email ?? "");
    setPhone(vendor?.phone ?? "");
    setIsActive(vendor?.is_active ?? true);
  }, [vendor]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload: VendorFormValues = {
      name: name.trim(),
      gstin: gstin.trim() || null,
      address: address.trim() || null,
      email: email.trim() || null,
      phone: phone.trim() || null,
      is_active: isActive,
    };
    if (vendor) await onUpdate(vendor.id, payload);
    else await onCreate(payload);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-6 rounded-xl border border-slate-200/50 bg-white/60 p-6 shadow-[0_8px_30px_rgb(0,0,0,0.02)] backdrop-blur-xl h-fit">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-slate-900">
          {vendor ? `Edit vendor #${vendor.id}` : "New vendor"}
        </h2>
        <p className="text-sm font-medium text-slate-500 mt-1">
          {vendor ? "Update details or deactivate the vendor." : "Create a new shop-scoped vendor."}
        </p>
      </div>
      {vendor && (
        <button
          type="button"
          onClick={onNew}
          className="flex h-10 w-fit items-center justify-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold tracking-wide text-slate-700 shadow-sm ring-1 ring-slate-200 transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:bg-slate-50 active:scale-[0.97]"
        >
          <Plus className="h-4 w-4" /> New vendor
        </button>
      )}

      <div className="flex flex-col gap-4">
        <Field label="Name" value={name} onChange={setName} required />
        <Field label="GSTIN" value={gstin} onChange={setGstin} maxLength={15} />
        <Field label="Address" value={address} onChange={setAddress} />
        <Field label="Email" value={email} onChange={setEmail} type="email" />
        <Field label="Phone" value={phone} onChange={setPhone} />
        <label className="flex items-center gap-2 text-sm font-medium text-slate-600">
          <input 
            type="checkbox" 
            checked={isActive} 
            onChange={(e) => setIsActive(e.target.checked)} 
            className="h-4 w-4 rounded border-slate-300 text-action focus:ring-action"
          />
          Active
        </label>
      </div>
      <button
        type="submit"
        disabled={busy}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-action px-6 text-sm font-bold tracking-wide text-white shadow-sm transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[var(--color-action)]/30 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50"
      >
        <Save className="h-4 w-4" /> {busy ? "Saving..." : vendor ? "Update vendor" : "Create vendor"}
      </button>
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  required = false,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  required?: boolean;
  maxLength?: number;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
      {label}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        maxLength={maxLength}
        className="h-11 w-full rounded-xl border border-slate-200 bg-white/50 px-4 text-sm font-medium normal-case text-slate-700 shadow-sm outline-none transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:bg-white focus:border-action focus:ring-1 focus:ring-action"
      />
    </label>
  );
}
