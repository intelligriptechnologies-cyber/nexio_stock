import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Api, ApiError, getOrCreateDeviceKey } from "../api/client";
import { homePathFor, type AuthUser, type Role, useAuth } from "../auth/AuthProvider";
import { AuthShell } from "../components/AuthShell";

type ShopLoginRole = Exclude<Role, "superadmin">;

const FIELD_CLASS =
  "h-12 w-full rounded-2xl border border-white/10 bg-[#1c1714] px-4 text-sm text-white shadow-sm transition-[background-color,box-shadow,border-color] duration-200 ease-out hover:border-amber-300/45 hover:bg-[#241d1a] focus:border-amber-300 focus:bg-[#241d1a] focus:outline-none focus:ring-4 focus:ring-amber-300/10";

const ROLE_OPTIONS: Array<{ value: ShopLoginRole; label: string }> = [
  { value: "cashier_user", label: "Cashier" },
  { value: "receiver_user", label: "Stock Keeper" },
  { value: "owner", label: "Owner" },
];

export function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [role, setRole] = useState<ShopLoginRole>("cashier_user");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deviceKey] = useState<string>(() => getOrCreateDeviceKey());

  const canSubmit = username.trim().length > 0 && password.length >= 4 && !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 4) {
      setError("Enter your password/PIN (4+ characters).");
      return;
    }
    setSubmitting(true);
    try {
      const json = await Api.loginShop({
        role,
        username: username.trim(),
        password,
        device_key: deviceKey,
      });
      const raw = json.user as Record<string, unknown>;
      const user: AuthUser = {
        id: Number(raw.id),
        shopId: raw.shop_id == null ? null : Number(raw.shop_id),
        role: raw.role as Role,
        username: String(raw.username ?? ""),
        fullName: String(raw.full_name ?? ""),
        phone: String(raw.phone ?? ""),
      };
      login(json.access_token, user);
      navigate(homePathFor(user.role), { replace: true });
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 401) setError("Invalid username, role, or PIN.");
        else if (e.status === 403) setError(e.detail);
        else if (e.status === 0) setError("Network error - is the backend reachable?");
        else setError(e.detail);
      } else {
        setError("Unexpected error.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      variant="shop"
      title="Shop sign in"
      subcopy="Use your assigned role, username, and PIN to open the live stock workflow."
      footerActionLabel="Superadmin login"
      footerActionTo="/login/superadmin"
      footerActionText="Need cross-shop access?"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4 text-white">
        <div className="grid gap-4">
          <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-200">
            Role
            <div className="relative">
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as ShopLoginRole)}
                className={`${FIELD_CLASS} appearance-none pr-11`}
              >
                {ROLE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value} className="bg-slate-950 text-white">
                    {option.label}
                  </option>
                ))}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-4 text-amber-200/80">
                <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-4 w-4">
                  <path
                    fillRule="evenodd"
                    d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.168l3.71-3.938a.75.75 0 1 1 1.08 1.04l-4.25 4.51a.75.75 0 0 1-1.08 0l-4.25-4.51a.75.75 0 0 1 .02-1.06Z"
                    clipRule="evenodd"
                  />
                </svg>
              </div>
            </div>
          </label>

          <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-200">
            Username
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Username"
              className={FIELD_CLASS}
              autoComplete="username"
              autoFocus
              required
            />
          </label>

          <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-200">
            Password / PIN
            <input
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (error) setError(null);
              }}
              className={FIELD_CLASS}
              autoComplete="current-password"
              required
            />
          </label>
        </div>

        {error && (
          <div
            role="alert"
            className="animate-fade-in rounded-2xl border border-rose-400/20 bg-rose-400/10 p-4 text-sm text-rose-100 backdrop-blur-sm"
          >
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={!canSubmit}
          className="group mt-1 flex h-12 items-center justify-center rounded-2xl bg-amber-400 px-4 text-sm font-semibold tracking-wide text-slate-950 shadow-[0_18px_45px_rgba(251,191,36,0.2)] transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:bg-amber-300 hover:shadow-[0_24px_60px_rgba(251,191,36,0.24)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:shadow-[0_18px_45px_rgba(251,191,36,0.2)]"
        >
          <span className="relative z-10">{submitting ? "Signing in..." : "Sign in"}</span>
        </button>
      </form>
    </AuthShell>
  );
}
