import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Api, ApiError, getOrCreateDeviceKey } from "../api/client";
import { homePathFor, type AuthUser, type Role, useAuth } from "../auth/AuthProvider";
import { AuthShell } from "../components/AuthShell";

type ShopLoginRole = Exclude<Role, "superadmin">;

const ROLE_OPTIONS: Array<{ value: ShopLoginRole; label: string }> = [
  { value: "cashier_user", label: "Cashier" },
  { value: "receiver_user", label: "Stock Keeper" },
  { value: "owner", label: "Shop Owner" },
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
      badge="SHOP OPERATIONS"
      title="Terminal Access"
      subcopy="Initialize secure bridge connection for live inventory movement."
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <fieldset>
          <legend className="auth-terminal-label">Access Role</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {ROLE_OPTIONS.map((option) => {
              const checked = role === option.value;
              return (
                <label key={option.value} className="block">
                  <input
                    type="radio"
                    name="role"
                    value={option.value}
                    checked={checked}
                    onChange={() => setRole(option.value)}
                    className="peer sr-only"
                    aria-label={option.label}
                  />
                  <span className="flex min-h-[48px] cursor-pointer items-center justify-center rounded-2xl border border-[#2a3139] bg-[#0b1015] px-3 py-3 text-center text-sm font-medium text-[#b8c5d2] transition-[border-color,background-color,color,box-shadow] duration-200 peer-hover:border-[#42505e] peer-focus-visible:border-[#8ae6ff] peer-focus-visible:ring-4 peer-focus-visible:ring-cyan-300/10 peer-checked:border-[#8fe8ff] peer-checked:bg-[#10202a] peer-checked:text-white">
                    {option.label}
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <label className="block">
          <span className="auth-terminal-label">Terminal ID / Username</span>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Enter terminal username"
            className="auth-terminal-field"
            autoComplete="username"
            autoFocus
            required
            aria-label="Terminal ID / Username"
          />
        </label>

        <label className="block">
          <span className="auth-terminal-label">Security PIN</span>
          <input
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (error) setError(null);
            }}
            className="auth-terminal-field"
            autoComplete="current-password"
            required
            aria-label="Security PIN"
          />
        </label>

        {error ? (
          <div
            role="alert"
            className="animate-fade-in rounded-2xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100"
          >
            {error}
          </div>
        ) : null}

        <button type="submit" disabled={!canSubmit} className="auth-terminal-submit mt-1">
          {submitting ? "Signing in..." : "Open Terminal"}
        </button>

        <div className="border-t border-white/8 pt-4 text-center">
          <Link to="/login/superadmin" className="auth-terminal-link">
            Need superadmin access?
          </Link>
        </div>
      </form>
    </AuthShell>
  );
}
