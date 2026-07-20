import { useEffect, useState, type FormEventHandler, type ReactNode } from "react";
import { FileText, KeyRound, Lock, Mail, Palette, Save, Settings, Shield } from "lucide-react";
import { ApiError } from "../api/client";
import { getMySettings, updateMySettings, type SettingsPublic } from "../api/settings";
import { changeMyPassword, getMyUser, updateMyUser, type UserPublic } from "../api/users";
import { useAuth } from "../auth/AuthProvider";
import { useShopScope } from "../auth/ShopScopeProvider";
import { AppTabButton } from "../components/AppTabs";
import { useSettingsTheme } from "../theme/settingsThemeContext";

type Tab = "general" | "email" | "invoice" | "security";

const DEFAULT_SIDEBAR_BRAND_NAME = "BarStock";

type ShopFormState = {
  appName: string;
  actionColor: string;
  activeTabColor: string;
  menuInactiveTextColor: string;
  menuActiveTextColor: string;
  emailEnabled: boolean;
  receivingVendorLinkEnabled: boolean;
  smtpHost: string;
  smtpPort: string;
  smtpUsername: string;
  smtpPassword: string;
  smtpFromEmail: string;
  smtpFromName: string;
  smtpUseTls: boolean;
  gstin: string;
  dutyRate: string;
  threshold: string;
};

type SecurityFormState = {
  username: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  pan: string;
  gstin: string;
};

type PasswordFormState = {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
};

const EMPTY_SHOP_FORM: ShopFormState = {
  appName: DEFAULT_SIDEBAR_BRAND_NAME,
  actionColor: "#22c55e",
  activeTabColor: "#5a5148",
  menuInactiveTextColor: "#535353cf",
  menuActiveTextColor: "#ffffff",
  emailEnabled: false,
  receivingVendorLinkEnabled: true,
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
};

const EMPTY_SECURITY_FORM: SecurityFormState = {
  username: "",
  email: "",
  phone: "",
  dateOfBirth: "",
  pan: "",
  gstin: "",
};

const EMPTY_PASSWORD_FORM: PasswordFormState = {
  currentPassword: "",
  newPassword: "",
  confirmPassword: "",
};

export function SettingsPage() {
  const { user } = useAuth();
  const { actingShopId } = useShopScope();
  const { applySettings } = useSettingsTheme();
  const [tab, setTab] = useState<Tab>("general");
  const [settings, setSettings] = useState<SettingsPublic | null>(null);
  const [shopForm, setShopForm] = useState<ShopFormState>(EMPTY_SHOP_FORM);
  const [, setProfile] = useState<UserPublic | null>(null);
  const [securityForm, setSecurityForm] = useState<SecurityFormState>(EMPTY_SECURITY_FORM);
  const [passwordForm, setPasswordForm] = useState<PasswordFormState>(EMPTY_PASSWORD_FORM);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busySection, setBusySection] = useState<"shop" | "profile" | "password" | null>(null);
  const [shopLoading, setShopLoading] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);

  const blocked = user?.role === "superadmin" && actingShopId === null;
  const canEditProfile = user?.role === "owner" || user?.role === "superadmin";

  useEffect(() => {
    if (blocked) {
      setSettings(null);
      setShopForm(EMPTY_SHOP_FORM);
      setShopLoading(false);
      return;
    }

    let cancelled = false;
    setShopLoading(true);
    setError(null);
    setInfo(null);
    void getMySettings(actingShopId)
      .then((next) => {
        if (cancelled) return;
        setSettings(next);
        setShopForm(shopFormFromSettings(next));
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Load failed.");
      })
      .finally(() => {
        if (!cancelled) setShopLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [actingShopId, blocked]);

  useEffect(() => {
    if (!canEditProfile) {
      setProfile(null);
      setSecurityForm(EMPTY_SECURITY_FORM);
      setPasswordForm(EMPTY_PASSWORD_FORM);
      setProfileLoading(false);
      return;
    }

    let cancelled = false;
    setProfileLoading(true);
    void getMyUser()
      .then((next) => {
        if (cancelled) return;
        setProfile(next);
        setSecurityForm(securityFormFromUser(next));
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Load failed.");
      })
      .finally(() => {
        if (!cancelled) setProfileLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [canEditProfile]);

  const setShopField = <K extends keyof ShopFormState>(key: K, value: ShopFormState[K]) => {
    setShopForm((current) => ({ ...current, [key]: value }));
  };

  const setSecurityField = <K extends keyof SecurityFormState>(key: K, value: SecurityFormState[K]) => {
    setSecurityForm((current) => ({ ...current, [key]: value }));
  };

  const setPasswordField = <K extends keyof PasswordFormState>(key: K, value: PasswordFormState[K]) => {
    setPasswordForm((current) => ({ ...current, [key]: value }));
  };

  const saveShopSettings = async (patch: Parameters<typeof updateMySettings>[0], message: string) => {
    if (blocked) {
      setError("Pick a shop first (top of the sidebar).");
      return;
    }
    setBusySection("shop");
    setError(null);
    setInfo(null);
    try {
      const updated = await updateMySettings(patch, actingShopId);
      setSettings(updated);
      setShopForm(shopFormFromSettings(updated));
      applySettings(updated);
      setInfo(message);
    } catch (e) {
      setError(apiErrorMessage(e, "Save failed."));
    } finally {
      setBusySection(null);
    }
  };

  const saveProfile = async () => {
    if (!canEditProfile) return;
    setBusySection("profile");
    setError(null);
    setInfo(null);
    try {
      const updated = await updateMyUser({
        email: blankToNull(securityForm.email),
        phone: blankToNull(securityForm.phone),
        date_of_birth: blankToNull(securityForm.dateOfBirth),
        pan: blankToNull(securityForm.pan),
        gstin: blankToNull(securityForm.gstin),
      });
      setProfile(updated);
      setSecurityForm(securityFormFromUser(updated));
      setInfo("Security profile saved.");
    } catch (e) {
      setError(apiErrorMessage(e, "Save failed."));
    } finally {
      setBusySection(null);
    }
  };

  const savePassword = async () => {
    if (!canEditProfile) return;
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setError("New password and confirm password must match.");
      return;
    }
    setBusySection("password");
    setError(null);
    setInfo(null);
    try {
      const updated = await changeMyPassword({
        current_password: passwordForm.currentPassword,
        new_password: passwordForm.newPassword,
        confirm_password: passwordForm.confirmPassword,
      });
      setProfile(updated);
      setPasswordForm(EMPTY_PASSWORD_FORM);
      setInfo("Password/PIN changed.");
    } catch (e) {
      setError(apiErrorMessage(e, "Save failed."));
    } finally {
      setBusySection(null);
    }
  };

  return (
    <div className="flex flex-col gap-8 font-sans">
      <header className="flex flex-col gap-2 rounded-xl border border-slate-200/50 bg-white/60 p-6 shadow-[0_8px_30px_rgb(0,0,0,0.02)] backdrop-blur-xl">
        <h1 className="flex items-center gap-3 text-2xl font-bold tracking-tight text-slate-900">
          <Settings className="h-6 w-6 text-action" /> Settings
        </h1>
        {settings && (
          <p className="text-sm font-medium text-slate-500">
            {settings.name} <span className="font-mono text-slate-400">({settings.code})</span>
          </p>
        )}
      </header>

      {blocked ? (
        <div className="flex flex-col gap-6 rounded-xl border border-slate-200/50 bg-white/60 p-8 shadow-[0_8px_30px_rgb(0,0,0,0.02)] backdrop-blur-xl">
          <div className="text-center text-sm font-medium text-slate-500">
            Pick a shop first (top of the sidebar).
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-col">
            <div className="app-tab-strip">
              <AppTabButton active={tab === "general"} onClick={() => setTab("general")}>
                <Palette className="h-4 w-4" /> General Settings
              </AppTabButton>
              <AppTabButton active={tab === "email"} onClick={() => setTab("email")}>
                <Mail className="h-4 w-4" /> Email Settings
              </AppTabButton>
              <AppTabButton active={tab === "invoice"} onClick={() => setTab("invoice")}>
                <FileText className="h-4 w-4" /> Invoice Settings
              </AppTabButton>
              <AppTabButton active={tab === "security"} onClick={() => setTab("security")}>
                <Shield className="h-4 w-4" /> Security
              </AppTabButton>
            </div>

            <div className="app-tab-panel">
              {tab === "general" &&
                (shopLoading ? (
                  <LoadingCard title="Loading general settings" />
                ) : (
                  <ShopSettingsCard
                    title="General Settings"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void saveShopSettings(
                        {
                          app_display_name: shopForm.appName.trim() || DEFAULT_SIDEBAR_BRAND_NAME,
                          action_color: shopForm.actionColor,
                          active_tab_color: shopForm.activeTabColor,
                          sidebar_menu_inactive_text_color: shopForm.menuInactiveTextColor,
                          sidebar_menu_active_text_color: shopForm.menuActiveTextColor,
                          receiving_vendor_link_enabled: shopForm.receivingVendorLinkEnabled,
                        },
                        "General settings saved."
                      );
                    }}
                  >
                    <Field
                      label="Sidebar Brand Name"
                      value={shopForm.appName}
                      onChange={(v) => setShopField("appName", v)}
                      placeholder={DEFAULT_SIDEBAR_BRAND_NAME}
                    />

                    <div className="md:col-span-2 py-1">
                      <div className="h-px w-full bg-slate-200/80" aria-hidden="true" />
                    </div>

                    <ColorField
                      label="Active/Button Color"
                      value={shopForm.actionColor}
                      onChange={(v) => setShopField("actionColor", v)}
                      onReset={() => settings && setShopField("actionColor", settings.action_color)}
                      resetLabel="Restore saved color"
                    />

                    <ColorField
                      label="Highlighted Tab Color"
                      value={shopForm.activeTabColor}
                      onChange={(v) => setShopField("activeTabColor", v)}
                      onReset={() => settings && setShopField("activeTabColor", settings.active_tab_color)}
                      resetLabel="Restore saved color"
                    />

                    <ColorTextField
                      label="Inactive Menu Text Color"
                      value={shopForm.menuInactiveTextColor}
                      onChange={(v) => setShopField("menuInactiveTextColor", v)}
                      onReset={() =>
                        settings &&
                        setShopField("menuInactiveTextColor", settings.sidebar_menu_inactive_text_color)
                      }
                      resetLabel="Restore saved color"
                    />

                    <ColorTextField
                      label="Active Menu Text Color"
                      value={shopForm.menuActiveTextColor}
                      onChange={(v) => setShopField("menuActiveTextColor", v)}
                      onReset={() =>
                        settings && setShopField("menuActiveTextColor", settings.sidebar_menu_active_text_color)
                      }
                      resetLabel="Restore saved color"
                    />

                    <div className="md:col-span-2 grid gap-4 md:grid-cols-1">
                      <ToggleField
                        label="Vendor link for receiving"
                        description="Require vendor and invoice details during receiving."
                        checked={shopForm.receivingVendorLinkEnabled}
                        onChange={(v) => setShopField("receivingVendorLinkEnabled", v)}
                      />
                    </div>

                    <PreviewRow
                      actionColor={shopForm.actionColor}
                      activeTabColor={shopForm.activeTabColor}
                      menuActiveColor={shopForm.menuActiveTextColor}
                      menuInactiveColor={shopForm.menuInactiveTextColor}
                    />

                    <div className="mt-4 flex md:col-span-2">
                      <button
                        type="submit"
                        disabled={busySection === "shop"}
                        className="flex h-11 items-center justify-center gap-2 rounded-xl bg-action px-8 text-sm font-bold tracking-wide text-white shadow-sm transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[var(--color-action)]/30 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50"
                      >
                        <Save className="h-4 w-4" /> {busySection === "shop" ? "Saving..." : "Save"}
                      </button>
                    </div>
                  </ShopSettingsCard>
                ))}

              {tab === "email" &&
                (shopLoading ? (
                  <LoadingCard title="Loading email settings" />
                ) : (
                  <ShopSettingsCard
                    title="Email Settings"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void saveShopSettings(
                        {
                          email_enabled: shopForm.emailEnabled,
                          smtp_host: shopForm.smtpHost.trim() || null,
                          smtp_port: shopForm.smtpPort.trim() ? Number(shopForm.smtpPort) : null,
                          smtp_username: shopForm.smtpUsername.trim() || null,
                          smtp_password: shopForm.smtpPassword,
                          smtp_from_email: shopForm.smtpFromEmail.trim() || null,
                          smtp_from_name: shopForm.smtpFromName.trim() || null,
                          smtp_use_tls: shopForm.smtpUseTls,
                          receiving_vendor_link_enabled: shopForm.receivingVendorLinkEnabled,
                        },
                        "Email settings saved."
                      );
                    }}
                  >
                    <label className="flex h-11 w-fit items-center gap-3 rounded-xl border border-slate-200 bg-white/50 px-4 text-sm font-semibold tracking-wide text-slate-700 shadow-sm md:col-span-2">
                      <input
                        type="checkbox"
                        checked={shopForm.emailEnabled}
                        onChange={(e) => setShopField("emailEnabled", e.target.checked)}
                        className="h-5 w-5 rounded border-slate-300 text-action focus:ring-action"
                      />
                      Enable email
                    </label>
                    <Field
                      label="SMTP Host"
                      value={shopForm.smtpHost}
                      onChange={(v) => setShopField("smtpHost", v)}
                    />
                    <Field
                      label="SMTP Port"
                      value={shopForm.smtpPort}
                      onChange={(v) => setShopField("smtpPort", v)}
                      type="number"
                      min="1"
                      max="65535"
                    />
                    <Field
                      label="SMTP Username"
                      value={shopForm.smtpUsername}
                      onChange={(v) => setShopField("smtpUsername", v)}
                    />
                    <Field
                      label="SMTP Password"
                      value={shopForm.smtpPassword}
                      onChange={(v) => setShopField("smtpPassword", v)}
                      type="password"
                      placeholder="Leave blank to keep current password"
                    />
                    <Field
                      label="From Email"
                      value={shopForm.smtpFromEmail}
                      onChange={(v) => setShopField("smtpFromEmail", v)}
                      type="email"
                    />
                    <Field
                      label="From Name"
                      value={shopForm.smtpFromName}
                      onChange={(v) => setShopField("smtpFromName", v)}
                    />
                    <label className="flex h-11 w-fit items-center gap-3 rounded-xl border border-slate-200 bg-white/50 px-4 text-sm font-semibold tracking-wide text-slate-700 shadow-sm">
                      <input
                        type="checkbox"
                        checked={shopForm.smtpUseTls}
                        onChange={(e) => setShopField("smtpUseTls", e.target.checked)}
                        className="h-5 w-5 rounded border-slate-300 text-action focus:ring-action"
                      />
                      Use TLS
                    </label>
                    <div className="mt-4 flex flex-wrap gap-4 md:col-span-2">
                      <button
                        type="submit"
                        disabled={busySection === "shop"}
                        className="flex h-11 items-center justify-center gap-2 rounded-xl bg-action px-8 text-sm font-bold tracking-wide text-white shadow-sm transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[var(--color-action)]/30 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50"
                      >
                        <Save className="h-4 w-4" /> {busySection === "shop" ? "Saving..." : "Save"}
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
                  </ShopSettingsCard>
                ))}

              {tab === "invoice" &&
                (shopLoading ? (
                  <LoadingCard title="Loading invoice settings" />
                ) : (
                  <ShopSettingsCard
                    title="Invoice Settings"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void saveShopSettings(
                        {
                          gstin: shopForm.gstin.trim() || null,
                          excise_duty_rate: shopForm.dutyRate.trim() || null,
                          low_stock_threshold_default: shopForm.threshold.trim()
                            ? Number(shopForm.threshold.trim())
                            : null,
                          receiving_vendor_link_enabled: shopForm.receivingVendorLinkEnabled,
                        },
                        "Invoice settings saved."
                      );
                    }}
                  >
                    <Field
                      label="GSTIN (15 uppercase alphanumerics)"
                      value={shopForm.gstin}
                      onChange={(v) => setShopField("gstin", v)}
                      maxLength={15}
                      placeholder="e.g. 21ABCDE1234F1Z5"
                    />
                    <Field
                      label="Excise duty rate (% placeholder, 0-100)"
                      value={shopForm.dutyRate}
                      onChange={(v) => setShopField("dutyRate", v)}
                      type="number"
                      step="0.01"
                      min="0"
                      max="100"
                    />
                    <Field
                      label="Default low-stock threshold"
                      value={shopForm.threshold}
                      onChange={(v) => setShopField("threshold", v)}
                      type="number"
                      min="0"
                    />
                    <div className="md:col-span-2 grid gap-4 md:grid-cols-1">
                      <ToggleField
                        label="Vendor link for receiving"
                        description="Require vendor and invoice details during receiving."
                        checked={shopForm.receivingVendorLinkEnabled}
                        onChange={(v) => setShopField("receivingVendorLinkEnabled", v)}
                      />
                    </div>
                    <div className="mt-4 flex md:col-span-2">
                      <button
                        type="submit"
                        disabled={busySection === "shop"}
                        className="flex h-11 items-center justify-center gap-2 rounded-xl bg-action px-8 text-sm font-bold tracking-wide text-white shadow-sm transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[var(--color-action)]/30 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50"
                      >
                        <Save className="h-4 w-4" /> {busySection === "shop" ? "Saving..." : "Save"}
                      </button>
                    </div>
                  </ShopSettingsCard>
                ))}

              {tab === "security" && canEditProfile && (
                <section className="rounded-xl border border-slate-200/50 bg-white/60 p-8 shadow-[0_8px_30px_rgb(0,0,0,0.02)] backdrop-blur-xl">
                  <div className="mb-6 flex items-center gap-3">
                    <Shield className="h-5 w-5 text-action" />
                    <h2 className="text-xl font-bold tracking-tight text-slate-900">Security</h2>
                  </div>

                  {profileLoading ? (
                    <LoadingCard title="Loading security profile" />
                  ) : (
                    <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
                      <div className="grid gap-4 md:col-span-2">
                        <Field
                          label="Username"
                          value={securityForm.username}
                          onChange={() => undefined}
                          readOnly
                          leadingIcon={<Lock className="h-4 w-4" />}
                          helperText="Locked login identifier."
                        />
                      </div>

                      <Field
                        label="Email"
                        value={securityForm.email}
                        onChange={(v) => setSecurityField("email", v)}
                        type="email"
                        autoComplete="email"
                      />
                      <Field
                        label="Phone"
                        value={securityForm.phone}
                        onChange={(v) => setSecurityField("phone", v)}
                        autoComplete="tel"
                      />
                      <Field
                        label="Date of Birth"
                        value={securityForm.dateOfBirth}
                        onChange={(v) => setSecurityField("dateOfBirth", v)}
                        type="date"
                      />
                      <Field
                        label="PAN"
                        value={securityForm.pan}
                        onChange={(v) => setSecurityField("pan", v)}
                        placeholder="ABCDE1234F"
                      />
                      <Field
                        label="GSTIN"
                        value={securityForm.gstin}
                        onChange={(v) => setSecurityField("gstin", v)}
                        placeholder="21ABCDE1234F1Z5"
                      />

                      <div className="md:col-span-2 flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          disabled={busySection === "profile"}
                          onClick={() => void saveProfile()}
                          className="flex h-11 items-center justify-center gap-2 rounded-xl bg-action px-8 text-sm font-bold tracking-wide text-white shadow-sm transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[var(--color-action)]/30 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50"
                        >
                          <Save className="h-4 w-4" /> {busySection === "profile" ? "Saving..." : "Save profile"}
                        </button>
                      </div>

                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          void savePassword();
                        }}
                        className="md:col-span-2 rounded-xl border border-slate-200 bg-slate-50/80 p-5"
                      >
                        <div className="mb-4 flex items-center gap-3">
                          <KeyRound className="h-5 w-5 text-action" />
                          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-600">
                            Password / PIN
                          </h3>
                        </div>

                        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                          <Field
                            label="Current password"
                            value={passwordForm.currentPassword}
                            onChange={(v) => setPasswordField("currentPassword", v)}
                            type="password"
                            autoComplete="current-password"
                            required={true}
                            minLength={4}
                          />
                          <Field
                            label="New password"
                            value={passwordForm.newPassword}
                            onChange={(v) => setPasswordField("newPassword", v)}
                            type="password"
                            autoComplete="new-password"
                            required={true}
                            minLength={4}
                          />
                          <Field
                            label="Confirm password"
                            value={passwordForm.confirmPassword}
                            onChange={(v) => setPasswordField("confirmPassword", v)}
                            type="password"
                            autoComplete="new-password"
                            required={true}
                            minLength={4}
                          />
                        </div>

                        <div className="mt-4 flex flex-wrap items-center gap-3">
                          <button
                            type="submit"
                            disabled={busySection === "password"}
                            className="flex h-11 items-center justify-center gap-2 rounded-xl bg-action px-8 text-sm font-bold tracking-wide text-white shadow-sm transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[var(--color-action)]/30 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50"
                          >
                            <Save className="h-4 w-4" /> {busySection === "password" ? "Saving..." : "Change password"}
                          </button>
                        </div>
                      </form>
                    </div>
                  )}
                </section>
              )}
            </div>
          </div>
        </>
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

function ShopSettingsCard({
  title,
  onSubmit,
  children,
}: {
  title: string;
  onSubmit: FormEventHandler<HTMLFormElement>;
  children: ReactNode;
}) {
  return (
    <form
      onSubmit={onSubmit}
      className="grid grid-cols-1 gap-8 rounded-xl border border-slate-200/50 bg-white/60 p-8 shadow-[0_8px_30px_rgb(0,0,0,0.02)] backdrop-blur-xl md:grid-cols-2"
    >
      <div className="md:col-span-2 flex items-center gap-3">
        <Palette className="h-5 w-5 text-action" />
        <h2 className="text-xl font-bold tracking-tight text-slate-900">{title}</h2>
      </div>
      {children}
    </form>
  );
}

function LoadingCard({ title }: { title: string }) {
  return (
    <div className="rounded-xl border border-slate-200/50 bg-white/60 p-8 text-sm font-medium text-slate-500 shadow-[0_8px_30px_rgb(0,0,0,0.02)] backdrop-blur-xl">
      {title}...
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
  readOnly = false,
  required = false,
  minLength,
  helperText,
  leadingIcon,
  autoComplete,
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
  readOnly?: boolean;
  required?: boolean;
  minLength?: number;
  helperText?: string;
  leadingIcon?: ReactNode;
  autoComplete?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
      {label}
      <div className="flex h-11 items-center gap-3 overflow-hidden rounded-xl border border-slate-200 bg-white/50 px-4 shadow-sm transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out focus-within:border-action focus-within:ring-1 focus-within:ring-action">
        {leadingIcon && <span aria-hidden="true" className="text-slate-400">{leadingIcon}</span>}
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          step={step}
          min={min}
          max={max}
          maxLength={maxLength}
          placeholder={placeholder}
          readOnly={readOnly}
          required={required}
          minLength={minLength}
          autoComplete={autoComplete}
          className={`h-full w-full bg-transparent text-sm font-medium normal-case text-slate-700 outline-none ${
            readOnly ? "cursor-not-allowed text-slate-500" : ""
          }`}
        />
      </div>
      {helperText && <span className="text-[11px] font-medium normal-case tracking-normal text-slate-400">{helperText}</span>}
    </label>
  );
}

function ColorField({
  label,
  value,
  onChange,
  onReset,
  resetLabel,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onReset: () => void;
  resetLabel: string;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
      {label}
      <div className="flex h-11 items-center gap-3 overflow-hidden rounded-xl border border-slate-200 bg-white/50 pr-2 shadow-sm transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out focus-within:border-action focus-within:ring-1 focus-within:ring-action">
        <input
          aria-label={label}
          type="color"
          value={isSixDigitHexColor(value) ? value : "#5a5148"}
          onChange={(e) => onChange(e.target.value)}
          className="h-full w-14 cursor-pointer border-0 p-0"
        />
        <input
          aria-label={`${label} value`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#5a5148"
          className="flex-1 bg-transparent font-mono text-sm text-slate-700 outline-none normal-case"
        />
        <button
          type="button"
          onClick={onReset}
          className="rounded-lg bg-slate-100 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-600 transition-colors hover:bg-slate-200"
          title={resetLabel}
        >
          Reset
        </button>
      </div>
      <span className="text-[11px] font-medium normal-case tracking-normal text-slate-400">{resetLabel}</span>
    </label>
  );
}

function ColorTextField({
  label,
  value,
  onChange,
  onReset,
  resetLabel,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onReset: () => void;
  resetLabel: string;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
      {label}
      <div className="flex h-11 items-center gap-3 overflow-hidden rounded-xl border border-slate-200 bg-white/50 pr-2 shadow-sm transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out focus-within:border-action focus-within:ring-1 focus-within:ring-action">
        <span
          aria-hidden="true"
          className="h-full w-14"
          style={{ backgroundColor: isCssHexColor(value) ? value : "transparent" }}
        />
        <input
          aria-label={`${label} value`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#535353cf"
          className="flex-1 bg-transparent font-mono text-sm text-slate-700 outline-none normal-case"
        />
        <button
          type="button"
          onClick={onReset}
          className="rounded-lg bg-slate-100 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-600 transition-colors hover:bg-slate-200"
          title={resetLabel}
        >
          Reset
        </button>
      </div>
      <span className="text-[11px] font-medium normal-case tracking-normal text-slate-400">{resetLabel}</span>
    </label>
  );
}

function ToggleField({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-white/50 p-4 shadow-sm">
      <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</span>
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-1 h-4 w-4 rounded border-slate-300 text-action focus:ring-action"
        />
        <span className="text-sm text-slate-600">{description}</span>
      </div>
    </label>
  );
}

function PreviewRow({
  actionColor,
  activeTabColor,
  menuActiveColor,
  menuInactiveColor,
}: {
  actionColor: string;
  activeTabColor: string;
  menuActiveColor: string;
  menuInactiveColor: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-4 md:col-span-2">
      <div
        className="flex h-11 items-center rounded-xl px-5 text-sm font-bold tracking-wide shadow-sm"
        style={{
          backgroundColor: actionColor,
          color: previewTextColor(actionColor),
        }}
      >
        Action preview
      </div>
      <div
        className="flex h-11 items-center rounded-xl px-5 text-sm font-bold tracking-wide shadow-sm"
        style={{
          backgroundColor: activeTabColor,
          color: previewTextColor(activeTabColor),
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
            style={{ backgroundColor: menuActiveColor }}
          />
          <span style={{ color: menuActiveColor }}>Active</span>
        </span>
        <span className="inline-flex items-center gap-2">
          <span
            aria-hidden="true"
            className="h-4 w-4 rounded-full border border-slate-200 shadow-sm"
            style={{ backgroundColor: menuInactiveColor }}
          />
          <span style={{ color: menuInactiveColor }}>Inactive</span>
        </span>
      </div>
    </div>
  );
}

function shopFormFromSettings(next: SettingsPublic): ShopFormState {
  return {
    appName: next.app_display_name?.trim() || DEFAULT_SIDEBAR_BRAND_NAME,
    actionColor: next.action_color,
    activeTabColor: next.active_tab_color,
    menuInactiveTextColor: next.sidebar_menu_inactive_text_color,
    menuActiveTextColor: next.sidebar_menu_active_text_color,
    emailEnabled: next.email_enabled,
    receivingVendorLinkEnabled: next.receiving_vendor_link_enabled,
    smtpHost: next.smtp_host ?? "",
    smtpPort: next.smtp_port === null ? "" : String(next.smtp_port),
    smtpUsername: next.smtp_username ?? "",
    smtpPassword: "",
    smtpFromEmail: next.smtp_from_email ?? "",
    smtpFromName: next.smtp_from_name ?? "",
    smtpUseTls: next.smtp_use_tls,
    gstin: next.gstin ?? "",
    dutyRate: next.excise_duty_rate ?? "",
    threshold: next.low_stock_threshold_default === null ? "" : String(next.low_stock_threshold_default),
  };
}

function securityFormFromUser(next: UserPublic): SecurityFormState {
  return {
    username: next.username,
    email: next.email ?? "",
    phone: next.phone ?? "",
    dateOfBirth: next.date_of_birth ?? "",
    pan: next.pan ?? "",
    gstin: next.gstin ?? "",
  };
}

function apiErrorMessage(e: unknown, fallback: string): string {
  if (e instanceof ApiError) {
    if (e.status === 0) return "Network error - save failed.";
    return e.detail;
  }
  if (e instanceof Error) return e.message;
  return fallback;
}

function blankToNull(value: string): string | null {
  const next = value.trim();
  return next ? next : null;
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
