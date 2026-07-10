import { useEffect, useState } from "react";
import type { ReactNode } from "react";
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
    <div className="flex flex-col gap-stack-gap">
      <div>
        <h1 className="text-headline-lg text-primary">Settings</h1>
        {settings && (
          <p className="text-label-md text-on-surface-variant">
            {settings.name} <span className="font-mono">({settings.code})</span>
          </p>
        )}
      </div>

      {blocked && (
        <div className="rounded-md bg-surface-container p-stack-gap text-on-surface-variant">
          Pick a shop first (top of the sidebar).
        </div>
      )}

      <div className="flex flex-wrap gap-2 border-b border-outline">
        <TabButton active={tab === "general"} onClick={() => setTab("general")}>
          General Settings
        </TabButton>
        <TabButton active={tab === "email"} onClick={() => setTab("email")}>
          Email Settings
        </TabButton>
        <TabButton active={tab === "invoice"} onClick={() => setTab("invoice")}>
          Invoice Settings
        </TabButton>
      </div>

      {tab === "general" && (
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
          className="grid grid-cols-1 gap-stack-gap rounded-md bg-surface-container p-gutter md:grid-cols-2"
        >
          <Field
            label="Sidebar Brand Name"
            value={form.appName}
            onChange={(v) => setField("appName", v)}
            placeholder={DEFAULT_SIDEBAR_BRAND_NAME}
          />
          <label className="flex flex-col gap-1 text-label-md">
            Active/Button Color
            <div className="flex min-h-touchTarget-sm items-center gap-stack-gap rounded-md border border-outline bg-surface px-stack-gap">
              <input
                aria-label="Active/Button Color"
                type="color"
                value={form.actionColor}
                onChange={(e) => setField("actionColor", e.target.value)}
                className="h-10 w-14 cursor-pointer bg-transparent"
              />
              <input
                value={form.actionColor}
                onChange={(e) => setField("actionColor", e.target.value)}
                className="min-h-touchTarget-sm flex-1 bg-transparent text-body-md"
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
          <div className="md:col-span-2 flex flex-wrap items-center gap-stack-gap">
            <div
              className="flex min-h-touchTarget-sm items-center rounded-md px-gutter text-label-md"
              style={{
                backgroundColor: form.actionColor,
                color: previewTextColor(form.actionColor),
              }}
            >
              Action preview
            </div>
            <div
              className="flex min-h-touchTarget-sm items-center rounded-t-md px-gutter text-label-md"
              style={{
                backgroundColor: form.activeTabColor,
                color: previewTextColor(form.activeTabColor),
              }}
            >
              Active tab preview
            </div>
            <div className="flex min-h-touchTarget-sm flex-wrap items-center gap-4 rounded-md border border-outline bg-surface px-stack-gap text-label-md">
              <span className="text-on-surface-variant">Menu text preview</span>
              <span className="inline-flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="h-4 w-4 rounded-sm border border-outline"
                  style={{ backgroundColor: form.menuActiveTextColor }}
                />
                <span style={{ color: form.menuActiveTextColor }}>Active</span>
              </span>
              <span className="inline-flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className="h-4 w-4 rounded-sm border border-outline"
                  style={{ backgroundColor: form.menuInactiveTextColor }}
                />
                <span style={{ color: form.menuInactiveTextColor }}>Inactive</span>
              </span>
            </div>
          </div>
          <div className="mt-[50px] flex md:col-span-2">
            <button
              type="submit"
              disabled={busy}
              className="min-h-touchTarget rounded-lg bg-action px-gutter text-label-xl text-on-action shadow-sm transition hover:brightness-95 disabled:opacity-50"
            >
              {busy ? "Saving..." : "Save"}
            </button>
          </div>
        </form>
      )}

      {tab === "email" && (
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
          className="grid grid-cols-1 gap-stack-gap rounded-md bg-surface-container p-gutter md:grid-cols-2"
        >
          <label className="md:col-span-2 flex min-h-touchTarget-sm items-center gap-stack-gap text-label-md">
            <input
              type="checkbox"
              checked={form.emailEnabled}
              onChange={(e) => setField("emailEnabled", e.target.checked)}
              className="h-6 w-6"
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
          <label className="flex min-h-touchTarget-sm items-center gap-stack-gap text-label-md">
            <input
              type="checkbox"
              checked={form.smtpUseTls}
              onChange={(e) => setField("smtpUseTls", e.target.checked)}
              className="h-6 w-6"
            />
            Use TLS
          </label>
          <div className="flex flex-wrap gap-stack-gap md:col-span-2">
            <button
              type="submit"
              disabled={busy}
              className="min-h-touchTarget rounded-md bg-action px-gutter text-label-xl text-on-action disabled:opacity-50"
            >
              {busy ? "Saving..." : "Save"}
            </button>
            <button
              type="button"
              disabled
              className="min-h-touchTarget rounded-md bg-surface-container-high px-gutter text-label-md text-on-surface-variant opacity-60"
            >
              Test SMTP
            </button>
            <button
              type="button"
              disabled
              className="min-h-touchTarget rounded-md bg-surface-container-high px-gutter text-label-md text-on-surface-variant opacity-60"
            >
              Send Test Mail
            </button>
          </div>
        </form>
      )}

      {tab === "invoice" && (
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
          className="grid grid-cols-1 gap-stack-gap rounded-md bg-surface-container p-gutter md:grid-cols-2"
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
          <button
            type="submit"
            disabled={busy}
            className="min-h-touchTarget rounded-md bg-action text-label-xl text-on-action disabled:opacity-50 md:col-span-2"
          >
            {busy ? "Saving..." : "Save"}
          </button>
        </form>
      )}

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
        active ? "bg-active-tab text-on-active-tab" : "text-on-surface-variant hover:bg-surface-container"
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
    <label className="flex flex-col gap-1 text-label-md">
      {label}
      <div className="flex min-h-touchTarget-sm items-center gap-stack-gap rounded-md border border-outline bg-surface px-stack-gap">
        <span
          aria-hidden="true"
          className="h-10 w-14 rounded-sm border border-outline"
          style={{ backgroundColor: isCssHexColor(value) ? value : "transparent" }}
        />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#535353cf"
          className="min-h-touchTarget-sm flex-1 bg-transparent font-mono text-body-md"
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
    <label className="flex flex-col gap-1 text-label-md">
      {label}
      <div className="flex min-h-touchTarget-sm items-center gap-stack-gap rounded-md border border-outline bg-surface px-stack-gap">
        <input
          aria-label={label}
          type="color"
          value={isSixDigitHexColor(value) ? value : "#5a5148"}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-14 cursor-pointer bg-transparent"
        />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#5a5148"
          className="min-h-touchTarget-sm flex-1 bg-transparent font-mono text-body-md"
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
