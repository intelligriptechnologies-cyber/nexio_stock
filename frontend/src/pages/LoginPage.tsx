import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Api, ApiError, getOrCreateDeviceKey } from "../api/client";
import { homePathFor, type AuthUser, type Role, useAuth } from "../auth/AuthProvider";

type ShopLoginRole = Exclude<Role, "superadmin">;

const ROLE_OPTIONS: Array<{ value: ShopLoginRole; label: string }> = [
  { value: "cashier_user", label: "Cashier" },
  { value: "receiver_user", label: "Receiver" },
  { value: "owner", label: "Owner" },
];

function defaultUsername(role: ShopLoginRole): string {
  if (role === "owner") return "SHOPCODE-OWNER-01";
  if (role === "receiver_user") return "SHOPCODE-RECEIVER-01";
  return "SHOPCODE-CASHIER-01";
}

export function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [role, setRole] = useState<ShopLoginRole>("cashier_user");
  const [username, setUsername] = useState(defaultUsername("cashier_user"));
  const [password, setPassword] = useState("");
  const [deviceKey] = useState<string>(() => getOrCreateDeviceKey());
  const [deviceStatus, setDeviceStatus] = useState<{
    device_key: string;
    is_registered: boolean;
    can_login: boolean;
    shop_id: number | null;
    shop_name: string | null;
    shop_code: string | null;
    counter_name: string | null;
    message: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checkingDevice, setCheckingDevice] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setCheckingDevice(true);
    Api.getDeviceContext(deviceKey)
      .then((context) => {
        if (cancelled) return;
        setDeviceStatus(context);
        setError(context.can_login ? null : context.message);
      })
      .catch((e) => {
        if (cancelled) return;
        setDeviceStatus(null);
        if (e instanceof ApiError) {
          setError(e.status === 0 ? "Network error - is the backend reachable?" : e.detail);
        } else {
          setError("Could not verify this device.");
        }
      })
      .finally(() => {
        if (!cancelled) setCheckingDevice(false);
      });
    return () => {
      cancelled = true;
    };
  }, [deviceKey]);

  useEffect(() => {
    setUsername((current) => {
      const trimmed = current.trim();
      return trimmed.length === 0 || trimmed.startsWith("SHOPCODE-") ? defaultUsername(role) : current;
    });
  }, [role]);

  const canSubmit = useMemo(() => {
    return (
      Boolean(deviceStatus?.can_login) &&
      !checkingDevice &&
      !submitting &&
      username.trim().length > 0 &&
      password.length >= 4
    );
  }, [checkingDevice, deviceStatus?.can_login, password.length, submitting, username]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!deviceStatus?.can_login) {
      setError(deviceStatus?.message ?? "This device is not registered.");
      return;
    }
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

  const statusText = deviceStatus?.can_login
    ? deviceStatus.message
    : deviceStatus?.message ?? "This device must be registered before shop login is allowed.";

  return (
    <div className="relative flex min-h-full items-center justify-center overflow-hidden bg-slate-50 p-6 font-sans">
      {/* Background Orbs for Premium Mesh Gradient Effect */}
      <div className="pointer-events-none absolute left-0 top-0 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-400/20 mix-blend-multiply blur-[100px]" />
      <div className="pointer-events-none absolute bottom-0 right-0 h-[600px] w-[600px] translate-x-1/3 translate-y-1/3 rounded-full bg-blue-500/10 mix-blend-multiply blur-[120px]" />
      
      <section className="relative w-full max-w-[460px] overflow-hidden rounded-3xl border border-white/60 bg-white/70 shadow-[0_8px_30px_rgb(0,0,0,0.04)] backdrop-blur-xl ring-1 ring-slate-900/5 transition-all duration-500 hover:shadow-[0_8px_40px_rgb(0,0,0,0.08)]">
        <div className="border-b border-slate-200/50 px-8 py-8 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">Barstock</p>
          <h1 className="mt-3 text-3xl font-light tracking-tight text-slate-900">Shop Login</h1>
          <p className="mt-2 text-sm text-slate-500">
            Sign in with your role, username, and PIN.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-6 px-8 py-8 text-slate-900">
          <div className="flex flex-col gap-5">
            <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">
              Role
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as ShopLoginRole)}
                className="h-11 w-full rounded-xl border border-slate-200/80 bg-white/80 px-4 text-sm text-slate-800 shadow-sm transition-all duration-300 hover:border-cyan-400/50 focus:border-cyan-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-cyan-500/10"
              >
                {ROLE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">
              Username
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={defaultUsername(role)}
                className="h-11 w-full rounded-xl border border-slate-200/80 bg-white/80 px-4 text-sm text-slate-800 shadow-sm transition-all duration-300 hover:border-cyan-400/50 focus:border-cyan-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-cyan-500/10"
                autoComplete="username"
                autoFocus
                required
              />
              <span className="mt-1 text-xs text-slate-400">
                Default: {defaultUsername(role)}.
              </span>
            </label>

            <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">
              PIN / Password
              <input
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (error) setError(null);
                }}
                className="h-11 w-full rounded-xl border border-slate-200/80 bg-white/80 px-4 text-sm text-slate-800 shadow-sm transition-all duration-300 hover:border-cyan-400/50 focus:border-cyan-500 focus:bg-white focus:outline-none focus:ring-4 focus:ring-cyan-500/10"
                autoComplete="current-password"
                required
              />
            </label>
          </div>

          <div className="group relative overflow-hidden rounded-2xl border border-slate-200/60 bg-gradient-to-br from-slate-50 to-slate-100/50 p-5 transition-all duration-300 hover:border-slate-300">
            <div className="absolute -right-6 -top-6 h-16 w-16 rounded-full bg-slate-200/50 blur-2xl transition-all duration-500 group-hover:bg-cyan-200/50" />
            <div className="relative z-10">
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Device</div>
              <div className="mt-1 font-mono text-sm tracking-tight text-slate-800 break-all">{deviceKey}</div>
              <div className="mt-2 text-xs text-slate-500">{statusText}</div>
              {deviceStatus?.shop_name && (
                <div className="mt-3 flex flex-wrap gap-2 text-xs font-medium">
                  <span className="rounded-full bg-slate-900 px-2.5 py-1 text-white shadow-sm">
                    {deviceStatus.shop_name}
                  </span>
                  {deviceStatus.counter_name && (
                    <span className="rounded-full bg-white px-2.5 py-1 text-slate-700 shadow-sm ring-1 ring-slate-200">
                      Counter: {deviceStatus.counter_name}
                    </span>
                  )}
                </div>
              )}
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="animate-in fade-in slide-in-from-top-1 rounded-xl border border-red-200/60 bg-red-50/50 p-4 text-sm text-red-700 backdrop-blur-sm"
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            className="group relative mt-2 flex h-12 items-center justify-center overflow-hidden rounded-xl bg-slate-900 text-sm font-semibold tracking-wide text-white shadow-md transition-all duration-300 hover:-translate-y-0.5 hover:bg-slate-800 hover:shadow-xl hover:shadow-cyan-500/20 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:shadow-md"
          >
            <span className="relative z-10">{checkingDevice ? "Checking device..." : submitting ? "Signing in..." : "Continue"}</span>
            <div className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/10 to-transparent transition-transform duration-1000 group-hover:translate-x-full" />
          </button>
        </form>

        <div className="border-t border-slate-100 bg-slate-50/50 p-4 text-center">
          <button
            type="button"
            onClick={() => navigate("/login/superadmin")}
            className="text-xs font-medium text-slate-400 transition-colors duration-300 hover:text-slate-700"
          >
            Access Superadmin Panel &rarr;
          </button>
        </div>
      </section>
    </div>
  );
}
