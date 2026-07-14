import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Settings, Palette, Mail, FileText, Save } from "lucide-react";
import { ApiError } from "../api/client";
import { getMySettings, updateMySettings, type SettingsPublic } from "../api/settings";
import { useAuth } from "../auth/AuthProvider";
import { useShopScope } from "../auth/ShopScopeProvider";
import { useSettingsTheme } from "../theme/settingsThemeContext";

type Tab = "general" | "email" | "invoice";

const DEFAULT_SIDEBAR_BRAND_NAME = "BarStock";

export function SettingsPage() {
  const { user } = useAuth();
  const { actingShopId } = useShopScope();
  const { applySettings } = useSettingsTheme();
  const [tab, setTab] = useState<Tab>("general");
  const [settings, setSettings] = useState<SettingsPublic | null>(null);
  const [form, setForm] = useState({
    appName: DEFAULT_SIDEBAR_BRAND_NAME,
    actionColor: "#22c55e",
    activeTabColor: "#5a5148",
    menuInactiveTextColor: "#535353cf",
    menuActiveTextColor: "#ffffff",
    emailEnabled: false,
    smtpHost: "",
    smtpPort: "",
    smtpUsername: "",
    smtpPassword: "",
    smtpFromEmail: "",
    smtpFromName: "",
    smtpUseTls: true,
    gstin: "",
    dutyRate: "",
    threshold: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const blocked = user?.role === "superadmin" && actingShopId === null;

  useEffect(() => {
    if (blocked) {
      setSettings(null);
      return;
    }
    setError(null);
    setInfo(null);
    void getMySettings(actingShopId)
      .then((next) => {
        setSettings(next);
        setForm({
          appName: next.app_display_name?.trim() || DEFAULT_SIDEBAR_BRAND_NAME,
          actionColor: next.action_color,
          activeTabColor: next.active_tab_color,
          menuInactiveTextColor: next.sidebar_menu_inactive_text_color,
          menuActiveTextColor: next.sidebar_menu_active_text_color,
          emailEnabled: next.email_enabled,
          smtpHost: next.smtp_host ?? "",
          smtpPort: next.smtp_port === null ? "" : String(next.smtp_port),
          smtpUsername: next.smtp_username ?? "",
          smtpPassword: "",
          smtpFromEmail: next.smtp_from_email ?? "",
          smtpFromName: next.smtp_from_name ?? "",
          smtpUseTls: next.smtp_use_tls,
          gstin: next.gstin ?? "",
          dutyRate: next.excise_duty_rate ?? "",
          threshold:
            next.low_stock_threshold_default === null
              ? ""
              : String(next.low_stock_threshold_default),
        });
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Load failed."));
  }, [actingShopId, blocked]);

  const setField = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const save = async (patch: Parameters<typeof updateMySettings>[0], message: string) => {
    if (blocked) {
      setError("Pick a shop first (top of the sidebar).");
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const updated = await updateMySettings(patch, actingShopId);
      setSettings(updated);
      applySettings(updated);
      setForm((current) => ({ ...current, smtpPassword: "" }));
      setInfo(message);
    } catch (e) {
      if (e instanceof ApiError) setError(e.status === 0 ? "Network error - save failed." : e.detail);
      else setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-8 font-sans">
      <header className="flex flex-col gap-2 rounded-xl border border-slate-200/50 bg-white/60 p-6 shadow-[0_8px_30px_rgb(0,0,0,0.02)] backdrop-blur-xl">
        <h1 className="flex items-center gap-3 text-2xl font-light tracking-tight text-slate-900">
          <Settings className="h-6 w-6 text-action" /> Settings
        </h1>
        {settings && (
          <p className="text-sm font-medium text-slate-500">
            {settings.name} <span className="font-mono text-slate-400">({settings.code})</span>
          </p>
        )}
      </header>

      {blocked && (
        <div className="flex h-[20vh] items-center justify-center rounded-xl border border-slate-200/50 bg-white/60 p-8 shadow-[0_8px_30px_rgb(0,0,0,0.02)] backdrop-blur-xl">
          <div className="text-center text-sm font-medium text-slate-500">
            Pick a shop first (top of the sidebar).
          </div>
        </div>
      )}

      {!blocked && (
        <div className="flex flex-wrap gap-2 border-b border-slate-200/60 pb-4">
          <TabButton active={tab === "general"} onClick={() => setTab("general")}>
            <Palette className="h-4 w-4" /> General Settings
          </TabButton>
          <TabButton active={tab === "email"} onClick={() => setTab("email")}>
            <Mail className="h-4 w-4" /> Email Settings
          </TabButton>
          <TabButton active={tab === "invoice"} onClick={() => setTab("invoice")}>
            <FileText className="h-4 w-4" /> Invoice Settings
          </TabButton>
        </div>
      )}

      {tab === "general" && !blocked && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save(
              {
                app_display_name: form.appName.trim() || DEFAULT_SIDEBAR_BRAND_NAME,
                action_color: form.actionColor,
                active_tab_color: form.activeTabColor,
                sidebar_menu_inactive_text_color: form.menuInactiveTextColor,
                sidebar_menu_active_text_color: form.menuActiveTextColor,
              },
              "General settings saved."
            );
          }}
          className="grid grid-cols-1 gap-8 rounded-xl border border-slate-200/50 bg-white/60 p-8 shadow-[0_8px_30px_rgb(0,0,0,0.02)] backdrop-blur-xl md:grid-cols-2"
        >
          <Field
            label="Sidebar Brand Name"
            value={form.appName}
            onChange={(v) => setField("appName", v)}
            placeholder={DEFAULT_SIDEBAR_BRAND_NAME}
          />
          <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Active/Button Color
            <div className="flex h-11 items-center gap-3 overflow-hidden rounded-xl border border-slate-200 bg-white/50 pr-4 shadow-sm transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out focus-within:border-action focus-within:ring-1 focus-within:ring-action">
              <input
                aria-label="Active/Button Color"
                type="color"
                value={form.actionColor}
                onChange={(e) => setField("actionColor", e.target.value)}
                className="h-full w-14 cursor-pointer border-0 p-0"
              />
              <input
                value={form.actionColor}
                onChange={(e) => setField("actionColor", e.target.value)}
                className="flex-1 bg-transparent text-sm font-medium text-slate-700 outline-none"
              />
            </div>
          </label>
          <ColorField
            label="Highlighted Tab Color"
            value={form.activeTabColor}
            onChange={(v) => setField("activeTabColor", v)}
          />
          <ColorTextField
            label="Inactive Menu Text Color"
            value={form.menuInactiveTextColor}
            onChange={(v) => setField("menuInactiveTextColor", v)}
          />
          <ColorTextField
            label="Active Menu Text Color"
            value={form.menuActiveTextColor}
            onChange={(v) => setField("menuActiveTextColor", v)}
          />
          <div className="flex flex-wrap items-center gap-4 md:col-span-2">
            <div
              className="flex h-11 items-center rounded-xl px-5 text-sm font-bold tracking-wide shadow-sm"
              style={{
                backgroundColor: form.actionColor,
                color: previewTextColor(form.actionColor),
              }}
            >
              Action preview
            </div>
            <div
              className="flex h-11 items-center rounded-xl px-5 text-sm font-bold tracking-wide shadow-sm"
              style={{
                backgroundColor: form.activeTabColor,
                color: previewTextColor(form.activeTabColor),
              }}
            >
              Active tab preview
            </div>
            <div className="flex h-11 flex-wrap items-center gap-4 rounded-xl border border-slate-200 bg-white/50 px-5 text-sm font-medium">
              <span className="text-slate-500">Menu text preview</span>
              <span className="inline-flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="h-4 w-4 rounded-full border border-slate-200 shadow-sm"
                  style={{ backgroundColor: form.menuActiveTextColor }}
                />
                <span style={{ color: form.menuActiveTextColor }}>Active</span>
              </span>
              <span className="inline-flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="h-4 w-4 rounded-full border border-slate-200 shadow-sm"
                  style={{ backgroundColor: form.menuInactiveTextColor }}
                />
                <span style={{ color: form.menuInactiveTextColor }}>Inactive</span>
              </span>
            </div>
          </div>
          <div className="mt-4 flex md:col-span-2">
            <button
              type="submit"
              disabled={busy}
              className="flex h-11 items-center justify-center gap-2 rounded-xl bg-action px-8 text-sm font-bold tracking-wide text-white shadow-sm transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[var(--color-action)]/30 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50"
            >
              <Save className="h-4 w-4" /> {busy ? "Saving..." : "Save"}
            </button>
          </div>
        </form>
      )}

      {tab === "email" && !blocked && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save(
              {
                email_enabled: form.emailEnabled,
                smtp_host: form.smtpHost.trim() || null,
                smtp_port: form.smtpPort.trim() ? Number(form.smtpPort) : null,
                smtp_username: form.smtpUsername.trim() || null,
                smtp_password: form.smtpPassword,
                smtp_from_email: form.smtpFromEmail.trim() || null,
                smtp_from_name: form.smtpFromName.trim() || null,
                smtp_use_tls: form.smtpUseTls,
              },
              "Email settings saved."
            );
          }}
          className="grid grid-cols-1 gap-8 rounded-xl border border-slate-200/50 bg-white/60 p-8 shadow-[0_8px_30px_rgb(0,0,0,0.02)] backdrop-blur-xl md:grid-cols-2"
        >
          <label className="flex h-11 w-fit items-center gap-3 rounded-xl border border-slate-200 bg-white/50 px-4 text-sm font-semibold tracking-wide text-slate-700 shadow-sm md:col-span-2">
            <input
              type="checkbox"
              checked={form.emailEnabled}
              onChange={(e) => setField("emailEnabled", e.target.checked)}
              className="h-5 w-5 rounded border-slate-300 text-action focus:ring-action"
            />
            Enable email
          </label>
          <Field label="SMTP Host" value={form.smtpHost} onChange={(v) => setField("smtpHost", v)} />
          <Field
            label="SMTP Port"
            value={form.smtpPort}
            onChange={(v) => setField("smtpPort", v)}
            type="number"
            min="1"
            max="65535"
          />
          <Field
            label="SMTP Username"
            value={form.smtpUsername}
            onChange={(v) => setField("smtpUsername", v)}
          />
          <Field
            label="SMTP Password"
            value={form.smtpPassword}
            onChange={(v) => setField("smtpPassword", v)}
            type="password"
            placeholder="Leave blank to keep current password"
          />
          <Field
            label="From Email"
            value={form.smtpFromEmail}
            onChange={(v) => setField("smtpFromEmail", v)}
            type="email"
          />
          <Field
            label="From Name"
            value={form.smtpFromName}
            onChange={(v) => setField("smtpFromName", v)}
          />
          <label className="flex h-11 w-fit items-center gap-3 rounded-xl border border-slate-200 bg-white/50 px-4 text-sm font-semibold tracking-wide text-slate-700 shadow-sm">
            <input
              type="checkbox"
              checked={form.smtpUseTls}
              onChange={(e) => setField("smtpUseTls", e.target.checked)}
              className="h-5 w-5 rounded border-slate-300 text-action focus:ring-action"
            />
            Use TLS
          </label>
          <div className="mt-4 flex flex-wrap gap-4 md:col-span-2">
            <button
              type="submit"
              disabled={busy}
              className="flex h-11 items-center justify-center gap-2 rounded-xl bg-action px-8 text-sm font-bold tracking-wide text-white shadow-sm transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[var(--color-action)]/30 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50"
            >
              <Save className="h-4 w-4" /> {busy ? "Saving..." : "Save"}
            </button>
            <button
              type="button"
              disabled
              className="flex h-11 items-center justify-center rounded-xl bg-white px-6 text-sm font-semibold tracking-wide text-slate-500 shadow-sm ring-1 ring-slate-200 transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:bg-slate-50 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50"
            >
              Test SMTP
            </button>
            <button
              type="button"
              disabled
              className="flex h-11 items-center justify-center rounded-xl bg-white px-6 text-sm font-semibold tracking-wide text-slate-500 shadow-sm ring-1 ring-slate-200 transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:bg-slate-50 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50"
            >
              Send Test Mail
            </button>
          </div>
        </form>
      )}

      {tab === "invoice" && !blocked && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save(
              {
                gstin: form.gstin.trim() || null,
                excise_duty_rate: form.dutyRate.trim() || null,
                low_stock_threshold_default: form.threshold.trim()
                  ? Number(form.threshold.trim())
                  : null,
              },
              "Invoice settings saved."
            );
          }}
          className="grid grid-cols-1 gap-8 rounded-xl border border-slate-200/50 bg-white/60 p-8 shadow-[0_8px_30px_rgb(0,0,0,0.02)] backdrop-blur-xl md:grid-cols-2"
        >
          <Field
            label="GSTIN (15 uppercase alphanumerics)"
            value={form.gstin}
            onChange={(v) => setField("gstin", v)}
            maxLength={15}
            placeholder="e.g. 21ABCDE1234F1Z5"
          />
          <Field
            label="Excise duty rate (% placeholder, 0-100)"
            value={form.dutyRate}
            onChange={(v) => setField("dutyRate", v)}
            type="number"
            step="0.01"
            min="0"
            max="100"
          />
          <Field
            label="Default low-stock threshold"
            value={form.threshold}
            onChange={(v) => setField("threshold", v)}
            type="number"
            min="0"
          />
          <div className="mt-4 flex md:col-span-2">
            <button
              type="submit"
              disabled={busy}
              className="flex h-11 items-center justify-center gap-2 rounded-xl bg-action px-8 text-sm font-bold tracking-wide text-white shadow-sm transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[var(--color-action)]/30 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50"
            >
              <Save className="h-4 w-4" /> {busy ? "Saving..." : "Save"}
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
      className={`group relative flex h-11 items-center justify-center gap-2 rounded-full px-6 text-sm font-bold tracking-wide transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out ${
        active 
          ? "bg-action text-white shadow-[0_4px_20px_rgba(var(--color-action-rgb),0.3)] hover:-translate-y-0.5" 
          : "bg-white text-slate-500 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50 hover:text-slate-700"
      }`}
    >
      {children}
    </button>
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
        className="h-11 w-full rounded-xl border border-slate-200 bg-white/50 px-4 text-sm font-medium normal-case text-slate-700 shadow-sm outline-none transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:bg-white focus:border-action focus:ring-1 focus:ring-action"
      />
    </label>
  );
}

function ColorTextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
      {label}
      <div className="flex h-11 items-center gap-3 overflow-hidden rounded-xl border border-slate-200 bg-white/50 pr-4 shadow-sm transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out focus-within:border-action focus-within:ring-1 focus-within:ring-action">
        <span
          aria-hidden="true"
          className="h-full w-14"
          style={{ backgroundColor: isCssHexColor(value) ? value : "transparent" }}
        />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#535353cf"
          className="flex-1 bg-transparent font-mono text-sm text-slate-700 outline-none normal-case"
        />
      </div>
    </label>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
      {label}
      <div className="flex h-11 items-center gap-3 overflow-hidden rounded-xl border border-slate-200 bg-white/50 pr-4 shadow-sm transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out focus-within:border-action focus-within:ring-1 focus-within:ring-action">
        <input
          aria-label={label}
          type="color"
          value={isSixDigitHexColor(value) ? value : "#5a5148"}
          onChange={(e) => onChange(e.target.value)}
          className="h-full w-14 cursor-pointer border-0 p-0"
        />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#5a5148"
          className="flex-1 bg-transparent font-mono text-sm text-slate-700 outline-none normal-case"
        />
      </div>
    </label>
  );
}

function isCssHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(value);
}

function isSixDigitHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

function previewTextColor(hex: string): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return "#ffffff";
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.62 ? "#0f172a" : "#ffffff";
}
