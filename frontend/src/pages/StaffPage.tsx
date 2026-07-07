import { useEffect, useState } from "react";
import { ApiError } from "../api/client";
import {
  createStaff,
  listStaff,
  type StaffCreatePayload,
  type StaffMember,
  type StaffRole,
} from "../api/staff";

export function StaffPage() {
  const [items, setItems] = useState<StaffMember[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = async () => {
    setItems(null);
    setError(null);
    try {
      const rows = await listStaff();
      setItems(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed.");
    }
  };

  useEffect(() => {
    void reload();
  }, []);

  const onCreate = async (payload: StaffCreatePayload) => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const created = await createStaff(payload);
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
                <th className="py-2 text-right">Reset PIN</th>
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
                    <ResetPinButton />
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

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (
      username.trim().length < 3 ||
      fullName.trim().length === 0 ||
      phone.trim().length < 7 ||
      password.length < 4
    ) {
      return;
    }
    onSubmit({
      role,
      username: username.trim(),
      full_name: fullName.trim(),
      phone: phone.trim(),
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
      <Field label="Phone" value={phone} onChange={setPhone} required type="tel" />
      <Field label="PIN / password (4+ chars)" value={password} onChange={setPassword} required type="password" />
      <button
        type="submit"
        disabled={busy}
        className="md:col-span-2 min-h-touchTarget rounded-md bg-accent text-label-xl text-on-accent disabled:opacity-50"
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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  minLength?: number;
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
        className="min-h-touchTarget-sm rounded-md border border-outline bg-surface px-stack-gap text-body-md"
      />
    </label>
  );
}

function ResetPinButton() {
  return (
    <button
      type="button"
      title="Password reset endpoint not yet shipped in v1 of the backend"
      onClick={() => alert("Reset PIN is not yet implemented in the backend — see issue #17.")}
      className="rounded-md bg-surface-container-high px-stack-gap py-1 text-label-md text-on-surface-variant"
    >
      Reset
    </button>
  );
}