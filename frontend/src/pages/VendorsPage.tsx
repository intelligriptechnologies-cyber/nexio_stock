import { useEffect, useMemo, useState } from "react";
import { ApiError, toUserMessage } from "../api/client";
import {
  createVendor,
  listVendors,
  updateVendor,
  type VendorPublic,
} from "../api/vendors";
import { useShopScope } from "../auth/ShopScopeProvider";

export function VendorsPage() {
  const { actingShopId } = useShopScope();
  const [vendors, setVendors] = useState<VendorPublic[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (actingShopId == null) {
      setVendors([]);
      return;
    }
    setError(null);
    void listVendors(actingShopId, includeInactive)
      .then((rows) => {
        setVendors(rows);
        setSelectedId((current) =>
          current != null && rows.some((vendor) => vendor.id === current) ? current : null
        );
      })
      .catch((e) => setError(toUserMessage(e, "Could not load vendors.")));
  }, [actingShopId, includeInactive]);

  const selected = useMemo(
    () => vendors.find((vendor) => vendor.id === selectedId) ?? null,
    [vendors, selectedId]
  );

  if (actingShopId == null) {
    return (
      <div className="rounded-md bg-surface-container p-gutter text-on-surface-variant">
        Pick a shop first (top of the sidebar).
      </div>
    );
  }

  const refresh = () => {
    void listVendors(actingShopId, includeInactive)
      .then((rows) => {
        setVendors(rows);
        setSelectedId((current) =>
          current != null && rows.some((vendor) => vendor.id === current) ? current : null
        );
      })
      .catch((e) => setError(toUserMessage(e, "Could not load vendors.")));
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

  return (
    <div className="flex flex-col gap-stack-gap">
      <header className="flex flex-wrap items-center justify-between gap-stack-gap">
        <div>
          <h1 className="text-headline-lg text-primary">Vendors</h1>
          <p className="text-label-md text-on-surface-variant">
            Shop-scoped supplier list for receiving.
          </p>
        </div>
        <label className="flex items-center gap-2 text-label-md">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => setIncludeInactive(e.target.checked)}
          />
          Include inactive
        </label>
      </header>

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

      <div className="grid gap-stack-gap lg:grid-cols-[360px_1fr]">
        <VendorForm
          key={selected?.id ?? "new"}
          vendor={selected}
          busy={busy}
          onCreate={submitCreate}
          onUpdate={submitUpdate}
          onNew={() => setSelectedId(null)}
        />

        <section className="rounded-lg bg-surface-container p-gutter">
          <div className="flex items-center justify-between">
            <h2 className="text-headline-md text-primary">Vendor list</h2>
            <button
              type="button"
              onClick={refresh}
              className="min-h-touchTarget-sm rounded-md bg-surface-container-high px-stack-gap text-label-md"
            >
              Refresh
            </button>
          </div>
          <div className="mt-stack-gap max-h-[calc(100vh-14rem)] overflow-y-auto rounded-md bg-surface">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-outline text-label-md text-on-surface-variant">
                  <th className="px-stack-gap py-2 text-left">Name</th>
                  <th className="px-stack-gap py-2 text-left">GSTIN</th>
                  <th className="px-stack-gap py-2 text-left">Phone</th>
                  <th className="px-stack-gap py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {vendors.map((vendor) => (
                  <tr
                    key={vendor.id}
                    className={`cursor-pointer border-b border-outline/40 ${
                      selectedId === vendor.id ? "bg-primary/10" : ""
                    }`}
                    onClick={() => setSelectedId(vendor.id)}
                  >
                    <td className="px-stack-gap py-2">{vendor.name}</td>
                    <td className="px-stack-gap py-2 font-mono">{vendor.gstin ?? "-"}</td>
                    <td className="px-stack-gap py-2 font-mono">{vendor.phone ?? "-"}</td>
                    <td className="px-stack-gap py-2">
                      {vendor.is_active ? "Active" : "Inactive"}
                    </td>
                  </tr>
                ))}
                {vendors.length === 0 && (
                  <tr>
                    <td className="px-stack-gap py-4 text-on-surface-variant" colSpan={4}>
                      No vendors yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
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
    <form onSubmit={submit} className="flex flex-col gap-stack-gap rounded-lg bg-surface-container p-gutter">
      <div>
        <h2 className="text-headline-md text-primary">
          {vendor ? `Edit vendor #${vendor.id}` : "New vendor"}
        </h2>
        <p className="text-label-md text-on-surface-variant">
          {vendor ? "Update details or deactivate the vendor." : "Create a new shop-scoped vendor."}
        </p>
      </div>
      {vendor && (
        <button
          type="button"
          onClick={onNew}
          className="min-h-touchTarget-sm w-fit rounded-md bg-surface-container-high px-stack-gap text-label-md"
        >
          New vendor
        </button>
      )}

      <Field label="Name" value={name} onChange={setName} required />
      <Field label="GSTIN" value={gstin} onChange={setGstin} maxLength={15} />
      <Field label="Address" value={address} onChange={setAddress} />
      <Field label="Email" value={email} onChange={setEmail} type="email" />
      <Field label="Phone" value={phone} onChange={setPhone} />
      <label className="flex items-center gap-2 text-label-md">
        <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
        Active
      </label>
      <button
        type="submit"
        disabled={busy}
        className="min-h-touchTarget-sm rounded-md bg-action px-stack-gap text-label-md text-on-action disabled:opacity-50"
      >
        {busy ? "Saving..." : vendor ? "Update vendor" : "Create vendor"}
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
    <label className="flex flex-col gap-1 text-label-md">
      {label}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        maxLength={maxLength}
        className="min-h-touchTarget-sm rounded-md border border-outline bg-surface px-stack-gap text-body-md"
      />
    </label>
  );
}
