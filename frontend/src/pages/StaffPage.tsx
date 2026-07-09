import { useCallback, useEffect, useState } from "react";
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
        setError("That username or phone is already used in this shop.");
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
    <div className="flex flex-col gap-stack-gap">
      <header className="flex items-center justify-between">
        <h1 className="text-headline-lg text-primary">Staff</h1>
        <button
          type="button"
          onClick={() => void reload()}
          className="min-h-touchTarget-sm rounded-md bg-surface-container-high px-stack-gap text-label-md"
        >
          Refresh
        </button>
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

      <CreateCard onSubmit={onCreate} busy={busy} />

      <section className="rounded-lg bg-surface-container p-gutter">
        <h2 className="mb-stack-gap text-headline-md text-primary">Current staff</h2>
        {items === null ? (
          <div className="text-on-surface-variant">Loading…</div>
        ) : items.length === 0 ? (
          <div className="text-on-surface-variant">No staff accounts yet.</div>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-outline text-label-md text-on-surface-variant">
                <th className="py-2 text-left">Role</th>
                <th className="py-2 text-left">Username</th>
                <th className="py-2 text-left">Full name</th>
                <th className="py-2 text-left">Phone</th>
                <th className="py-2 text-left">Active</th>
                <th className="py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((s) => (
                <tr key={s.id} className="border-b border-outline/40">
                  <td className="py-2">{s.role === "cashier_user" ? "Cashier" : "Receiver"}</td>
                  <td className="py-2 font-mono text-label-md">{s.username}</td>
                  <td className="py-2">{s.full_name}</td>
                  <td className="py-2 font-mono text-label-md">{s.phone}</td>
                  <td className="py-2">{s.is_active ? "yes" : "no"}</td>
                  <td className="py-2 text-right">
                    <div className="flex justify-end gap-2">
                      <ResetPinButton onClick={() => void onResetPassword(s)} />
                      <button
                        type="button"
                        onClick={() => void onToggleActive(s)}
                        className="rounded-md bg-primary px-stack-gap py-1 text-label-md text-on-primary"
                      >
                        {s.is_active ? "Deactivate" : "Activate"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
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
      username.trim().length < 3 ||
      fullName.trim().length === 0 ||
      phoneError !== undefined ||
      password.length < 4
    ) {
      return;
    }
    onSubmit({
      role,
      username: username.trim(),
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
      className="grid grid-cols-1 gap-stack-gap rounded-lg bg-surface-container p-gutter md:grid-cols-2"
    >
      <h2 className="md:col-span-2 text-headline-md text-primary">New staff account</h2>
      <label className="flex flex-col gap-1 text-label-md">
        Role
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as StaffRole)}
          className="min-h-touchTarget-sm rounded-md border border-outline bg-surface px-stack-gap text-body-md"
        >
          <option value="cashier_user">Cashier</option>
          <option value="receiver_user">Receiver</option>
        </select>
      </label>
      <Field label="Username" value={username} onChange={setUsername} required minLength={3} />
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
        className="md:col-span-2 min-h-touchTarget rounded-md bg-action text-label-xl text-on-action disabled:opacity-50"
      >
        {busy ? "Creating…" : "Create staff account"}
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
}) {
  return (
    <label className="flex flex-col gap-1 text-label-md">
      {label}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        minLength={minLength}
        // Issue #39 — wire aria-invalid + aria-describedby so the live
        // error is announced to screen readers when the field is invalid.
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${label}-error` : undefined}
        className="min-h-touchTarget-sm rounded-md border border-outline bg-surface px-stack-gap text-body-md"
      />
      {error && (
        <span
          id={`${label}-error`}
          role="alert"
          className="text-label-sm text-error"
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
      className="rounded-md bg-surface-container-high px-stack-gap py-1 text-label-md text-on-surface-variant"
    >
      Reset
    </button>
  );
}
