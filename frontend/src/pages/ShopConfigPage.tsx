import { useEffect, useState } from "react";
import { Store, Save } from "lucide-react";
import { ApiError } from "../api/client";
import { getMyShop, updateMyShop, type ShopPublic } from "../api/shops";
import { useAuth } from "../auth/AuthProvider";
import { useShopScope } from "../auth/ShopScopeProvider";

export function ShopConfigPage() {
  const { user } = useAuth();
  const { actingShopId } = useShopScope();
  const [shop, setShop] = useState<ShopPublic | null>(null);
  const [gstin, setGstin] = useState("");
  const [dutyRate, setDutyRate] = useState("");
  const [threshold, setThreshold] = useState("");
  const [allowedLoginCidrs, setAllowedLoginCidrs] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    if (user?.role === "superadmin" && actingShopId === null) {
      setShop(null);
      return;
    }
    setError(null);
    setInfo(null);
    try {
      const s = await getMyShop(actingShopId);
      setShop(s);
      setGstin(s.gstin ?? "");
      setDutyRate(s.excise_duty_rate ?? "");
      setThreshold(
        s.low_stock_threshold_default === null ? "" : String(s.low_stock_threshold_default)
      );
      setAllowedLoginCidrs(s.allowed_login_cidrs?.join("\n") ?? "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed.");
    }
  };

  useEffect(() => {
    void reload();
  }, [actingShopId]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (user?.role === "superadmin" && actingShopId === null) {
      setError("Pick a shop first (top of the sidebar).");
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const payload: {
        gstin: string | null;
        excise_duty_rate: string | null;
        low_stock_threshold_default: number | null;
        allowed_login_cidrs: string[];
      } = {
        gstin: gstin.trim() ? gstin.trim() : null,
        excise_duty_rate: dutyRate.trim() ? dutyRate.trim() : null,
        low_stock_threshold_default: threshold.trim() ? Number(threshold.trim()) : null,
        allowed_login_cidrs: allowedLoginCidrs
          .split(/\r?\n|,/)
          .map((value) => value.trim())
          .filter((value) => value.length > 0),
      };
      const updated = await updateMyShop(payload, actingShopId);
      setShop(updated);
      setInfo("Shop config saved.");
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 400) setError(`Validation error: ${e.detail}`);
        else if (e.status === 0) setError("Network error — save failed.");
        else setError(e.detail);
      } else {
        setError(e instanceof Error ? e.message : "Save failed.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-8 font-sans">
      <header className="flex flex-col gap-2 rounded-[24px] border border-slate-200/50 bg-white/60 p-6 shadow-[0_8px_30px_rgb(0,0,0,0.02)] backdrop-blur-xl">
        <h1 className="flex items-center gap-3 text-2xl font-light tracking-tight text-slate-900">
          <Store className="h-6 w-6 text-action" /> Shop Config
        </h1>
        {shop && (
          <p className="text-sm font-medium text-slate-500">
            {shop.name} <span className="font-mono text-slate-400">({shop.code})</span>
          </p>
        )}
      </header>

      {user?.role === "superadmin" && actingShopId === null && (
        <div className="flex h-[20vh] items-center justify-center rounded-[24px] border border-slate-200/50 bg-white/60 p-8 shadow-[0_8px_30px_rgb(0,0,0,0.02)] backdrop-blur-xl">
          <div className="text-center text-sm font-medium text-slate-500">
            Pick a shop first (top of the sidebar).
          </div>
        </div>
      )}

      {shop && (
        <form
          onSubmit={save}
          className="grid grid-cols-1 gap-8 rounded-[24px] border border-slate-200/50 bg-white/60 p-8 shadow-[0_8px_30px_rgb(0,0,0,0.02)] backdrop-blur-xl md:grid-cols-2"
        >
        <Field
          label="GSTIN (15 uppercase alphanumerics)"
          value={gstin}
          onChange={setGstin}
          maxLength={15}
          placeholder="e.g. 21ABCDE1234F1Z5"
        />
        <Field
          label="Excise duty rate (% placeholder, 0–100)"
          value={dutyRate}
          onChange={setDutyRate}
          type="number"
          step="0.01"
          min="0"
          max="100"
          placeholder="e.g. 0.00 — confirm against Odisha State Excise before relying on it"
        />
        <Field
          label="Default low-stock threshold"
          value={threshold}
          onChange={setThreshold}
          type="number"
          min="0"
          placeholder="Per-product overrides win"
        />
        <TextAreaField
          label="Allowed login IPs/CIDRs"
          value={allowedLoginCidrs}
          onChange={setAllowedLoginCidrs}
          placeholder={'One per line, e.g. 203.0.113.10 or 203.0.113.0/24\nLeave blank to allow shop login from anywhere'}
        />
        <div className="mt-4 flex md:col-span-2">
          <button
            type="submit"
            disabled={busy}
            className="flex h-11 items-center justify-center gap-2 rounded-xl bg-action px-8 text-sm font-bold tracking-wide text-white shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[var(--color-action)]/30 active:scale-95 disabled:pointer-events-none disabled:opacity-50"
          >
            <Save className="h-4 w-4" /> {busy ? "Saving…" : "Save shop config"}
          </button>
        </div>
      </form>
      )}

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
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  step,
  min,
  max,
  maxLength,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  step?: string;
  min?: string;
  max?: string;
  maxLength?: number;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
      {label}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        step={step}
        min={min}
        max={max}
        maxLength={maxLength}
        placeholder={placeholder}
        className="h-11 w-full rounded-xl border border-slate-200 bg-white/50 px-4 text-sm font-medium normal-case text-slate-700 shadow-sm outline-none transition-all hover:bg-white focus:border-action focus:ring-1 focus:ring-action"
      />
    </label>
  );
}

function TextAreaField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500 md:col-span-2">
      {label}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={4}
        className="min-h-[7rem] w-full rounded-xl border border-slate-200 bg-white/50 p-4 text-sm font-medium normal-case text-slate-700 shadow-sm outline-none transition-all hover:bg-white focus:border-action focus:ring-1 focus:ring-action"
      />
    </label>
  );
}
