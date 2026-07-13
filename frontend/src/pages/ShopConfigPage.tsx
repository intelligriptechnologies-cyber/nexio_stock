import { useEffect, useState } from "react";
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
    <div className="flex flex-col gap-stack-gap">
      <h1 className="text-headline-lg text-primary">Shop Config</h1>

      {user?.role === "superadmin" && actingShopId === null && (
        <div className="rounded-md bg-surface-container p-stack-gap text-on-surface-variant">
          Pick a shop first (top of the sidebar).
        </div>
      )}

      {shop && (
        <div className="rounded-md bg-surface-container p-stack-gap text-label-md">
          <div>
            <span className="text-on-surface-variant">Shop name: </span>
            <strong>{shop.name}</strong>
          </div>
          <div>
            <span className="text-on-surface-variant">Shop code: </span>
            <span className="font-mono">{shop.code}</span>
          </div>
        </div>
      )}

      <form
        onSubmit={save}
        className="grid grid-cols-1 gap-stack-gap rounded-lg bg-surface-container p-gutter md:grid-cols-2"
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
        <button
          type="submit"
          disabled={busy}
          className="md:col-span-2 min-h-touchTarget rounded-md bg-action text-label-xl text-on-action disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save shop config"}
        </button>
      </form>

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
    <label className="flex flex-col gap-1 text-label-md">
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
        className="min-h-touchTarget-sm rounded-md border border-outline bg-surface px-stack-gap text-body-md"
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
    <label className="flex flex-col gap-1 text-label-md md:col-span-2">
      {label}
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={4}
        className="min-h-[7rem] rounded-md border border-outline bg-surface px-stack-gap py-2 text-body-md"
      />
    </label>
  );
}
