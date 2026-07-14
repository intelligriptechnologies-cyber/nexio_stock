import { useCallback, useEffect, useState } from "react";
import { Users, RefreshCw, KeyRound, UserPlus, Power, CheckCircle2 } from "lucide-react";
import { ApiError } from "../api/client";
import {
  createStaff,
  listStaff,
  resetStaffPassword,
  setStaffActive,
  type StaffCreatePayload,
  type StaffMember,
  type StaffRole,
} from "../api/staff";
import { useAuth } from "../auth/AuthProvider";
import { SHOP_SCOPE_MESSAGE, useShopScope } from "../auth/ShopScopeProvider";

export function StaffPage() {
  const { user } = useAuth();
  const { actingShopId } = useShopScope();
  const [items, setItems] = useState<StaffMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const scopedShopId = user?.role === "superadmin" ? actingShopId : null;

  const reload = useCallback(async () => {
    setItems(null);
    setError(null);
    if (user?.role === "superadmin" && actingShopId === null) {
      setItems([]);
      setError(SHOP_SCOPE_MESSAGE);
      return;
    }
    try {
      const rows = await listStaff(scopedShopId);
      setItems(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed.");
    }
  }, [actingShopId, scopedShopId, user?.role]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const onCreate = async (payload: StaffCreatePayload) => {
    if (user?.role === "superadmin" && actingShopId === null) {
      setError(SHOP_SCOPE_MESSAGE);
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const created = await createStaff(payload, scopedShopId);
      setInfo(`Created ${created.role} ${created.username}.`);
      await reload();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setError("That username or phone is already used.");
      } else if (e instanceof ApiError) {
        setError(e.detail);
      } else {
        setError(e instanceof Error ? e.message : "Create failed.");
      }
    } finally {
      setBusy(false);
    }
  };

  const onResetPassword = async (staffMember: StaffMember) => {
    const password = window.prompt(
      `New PIN/password for ${staffMember.username} (4+ characters):`
    );
    if (password === null) return; // cancelled
    if (password.length < 4) {
      setError("New PIN/password must be at least 4 characters.");
      return;
    }
    setError(null);
    setInfo(null);
    try {
      await resetStaffPassword(staffMember.id, password, scopedShopId);
      setInfo(`Reset PIN for ${staffMember.username}.`);
    } catch (e) {
      setError(e instanceof ApiError ? e.detail : e instanceof Error ? e.message : "Reset failed.");
    }
  };

  const onToggleActive = async (staffMember: StaffMember) => {
    setError(null);
    setInfo(null);
    try {
      const updated = await setStaffActive(staffMember.id, !staffMember.is_active, scopedShopId);
      setInfo(`${updated.is_active ? "Activated" : "Deactivated"} ${updated.username}.`);
      await reload();
    } catch (e) {
      setError(e instanceof ApiError ? e.detail : e instanceof Error ? e.message : "Update failed.");
    }
  };

  return (
    <div className="flex flex-col gap-8 font-sans">
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200/50 bg-white/60 p-6 shadow-[0_8px_30px_rgb(0,0,0,0.02)] backdrop-blur-xl">
        <h1 className="flex items-center gap-3 text-2xl font-light tracking-tight text-slate-900">
          <Users className="h-6 w-6 text-action" /> Staff
        </h1>
        <button
          type="button"
          onClick={() => void reload()}
          className="group flex h-10 items-center justify-center rounded-xl bg-white px-5 text-sm font-semibold tracking-wide text-slate-700 shadow-sm ring-1 ring-slate-200 transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:scale-[1.02] hover:bg-slate-50 hover:shadow-md active:scale-[0.97]"
        >
          <RefreshCw className="h-4 w-4 text-slate-400 transition-transform duration-300 group-hover:rotate-180" />
          <span className="ml-2">Refresh</span>
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

      <div className="grid gap-8 lg:grid-cols-[400px_1fr]">
        <CreateCard onSubmit={onCreate} busy={busy} />

        <section className="flex flex-col gap-6 rounded-xl border border-slate-200/50 bg-white/60 p-6 shadow-[0_8px_30px_rgb(0,0,0,0.02)] backdrop-blur-xl">
          <h2 className="text-lg font-light tracking-tight text-slate-900">Current staff</h2>
          {items === null ? (
            <div className="flex h-32 items-center justify-center rounded-2xl border border-slate-200 bg-white/50">
              <div className="text-sm font-medium text-slate-500">Loading…</div>
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white/50 py-12 text-center text-sm font-medium text-slate-500">
              No staff accounts yet.
            </div>
          ) : (
            <div className="max-h-[calc(100vh-18rem)] overflow-y-auto rounded-2xl border border-slate-200 bg-white custom-scrollbar">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 z-10 bg-slate-50/90 text-[11px] uppercase tracking-widest text-slate-500 backdrop-blur-sm">
                  <tr>
                    <th className="px-6 py-4 font-semibold">Role</th>
                    <th className="px-6 py-4 font-semibold">Username</th>
                    <th className="px-6 py-4 font-semibold">Full name</th>
                    <th className="px-6 py-4 font-semibold">Phone</th>
                    <th className="px-6 py-4 font-semibold">Status</th>
                    <th className="px-6 py-4 font-semibold text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((s) => (
                    <tr key={s.id} className="transition-colors hover:bg-slate-50/50">
                      <td className="px-6 py-4 font-medium text-slate-900">{s.role === "cashier_user" ? "Cashier" : "Receiver"}</td>
                      <td className="px-6 py-4 font-mono text-slate-500">{s.username}</td>
                      <td className="px-6 py-4 text-slate-700">{s.full_name}</td>
                      <td className="px-6 py-4 font-mono text-slate-500">{s.phone}</td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                          s.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"
                        }`}>
                          {s.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-2">
                          <ResetPinButton onClick={() => void onResetPassword(s)} />
                          <button
                            type="button"
                            onClick={() => void onToggleActive(s)}
                            className={`group flex h-9 items-center justify-center gap-1.5 rounded-xl px-4 text-xs font-bold tracking-wide shadow-sm transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:-translate-y-0.5 active:scale-[0.97] ${
                              s.is_active
                                ? "bg-red-50 text-red-600 ring-1 ring-red-200 hover:bg-red-100"
                                : "bg-action text-white hover:shadow-[var(--color-action)]/30"
                            }`}
                          >
                            <Power className="h-3.5 w-3.5" />
                            {s.is_active ? "Deactivate" : "Activate"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function CreateCard({
  onSubmit,
  busy,
}: {
  onSubmit: (p: StaffCreatePayload) => void;
  busy: boolean;
}) {
  const [role, setRole] = useState<StaffRole>("cashier_user");
  const [username, setUsername] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");

  // Issue #39 — live phone validation, mirrors the backend's
  // ``_PHONE_RE`` (``app/schemas/auth.py``): 7-15 digits, optional
  // leading ``+``. The error is shown/cleared as the user types —
  // not only on submit attempt — and submit stays blocked until the
  // field is valid (preserved existing behaviour).
  const trimmedPhone = phone.trim();
  const phoneError =
    trimmedPhone.length === 0
      ? undefined
      : trimmedPhone.length < 7
        ? "Phone must be at least 7 digits."
        : !/^\+?[0-9]{7,15}$/.test(trimmedPhone)
          ? "Phone must be 7-15 digits, optional leading +."
          : undefined;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (
      (username.trim().length > 0 && username.trim().length < 3) ||
      fullName.trim().length === 0 ||
      phoneError !== undefined ||
      password.length < 4
    ) {
      return;
    }
    onSubmit({
      role,
      username: username.trim() || undefined,
      full_name: fullName.trim(),
      phone: trimmedPhone,
      password,
    });
    setUsername("");
    setFullName("");
    setPhone("");
    setPassword("");
  };

  return (
    <form
      onSubmit={submit}
      className="flex flex-col gap-6 rounded-xl border border-slate-200/50 bg-white/60 p-6 shadow-[0_8px_30px_rgb(0,0,0,0.02)] backdrop-blur-xl h-fit"
    >
      <h2 className="flex items-center gap-2 text-xl font-light tracking-tight text-slate-900">
        <UserPlus className="h-5 w-5 text-action" /> New staff account
      </h2>
      <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
        Role
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as StaffRole)}
          className="h-11 w-full rounded-xl border border-slate-200 bg-white/50 px-4 text-sm font-medium text-slate-700 shadow-sm outline-none transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:bg-white focus:border-action focus:ring-1 focus:ring-action"
        >
          <option value="cashier_user">Cashier</option>
          <option value="receiver_user">Receiver</option>
        </select>
      </label>
      <Field
        label="Username"
        value={username}
        onChange={setUsername}
        placeholder="Leave blank to auto-generate"
      />
      <Field label="Full name" value={fullName} onChange={setFullName} required />
      <Field
        label="Phone"
        value={phone}
        onChange={setPhone}
        required
        type="tel"
        error={phoneError}
      />
      <Field label="PIN / password (4+ chars)" value={password} onChange={setPassword} required type="password" />
      <button
        type="submit"
        disabled={busy}
        className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-action px-6 text-sm font-bold tracking-wide text-white shadow-sm transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[var(--color-action)]/30 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50"
      >
        <CheckCircle2 className="h-4 w-4" /> {busy ? "Creating…" : "Create staff account"}
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
  minLength,
  error,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  minLength?: number;
  // Issue #39 — inline validation message rendered under the input.
  // Empty string / undefined means "no error to show".
  error?: string;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
      {label}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        minLength={minLength}
        placeholder={placeholder}
        // Issue #39 — wire aria-invalid + aria-describedby so the live
        // error is announced to screen readers when the field is invalid.
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${label}-error` : undefined}
        className={`h-11 w-full rounded-xl border bg-white/50 px-4 text-sm font-medium normal-case text-slate-700 shadow-sm outline-none transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:bg-white focus:ring-1 ${
          error
            ? "border-red-300 focus:border-red-500 focus:ring-red-500"
            : "border-slate-200 focus:border-action focus:ring-action"
        }`}
      />
      {error && (
        <span
          id={`${label}-error`}
          role="alert"
          className="text-[11px] font-semibold tracking-wide text-red-500"
        >
          {error}
        </span>
      )}
    </label>
  );
}

function ResetPinButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      title="Reset this staff member's PIN/password"
      onClick={onClick}
      className="group flex h-9 items-center justify-center gap-1.5 rounded-xl bg-white px-4 text-xs font-semibold tracking-wide text-slate-600 shadow-sm ring-1 ring-slate-200 transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:bg-slate-50 hover:shadow-md active:scale-[0.97]"
    >
      <KeyRound className="h-3.5 w-3.5 text-slate-400 group-hover:text-action transition-colors" /> Reset
    </button>
  );
}
