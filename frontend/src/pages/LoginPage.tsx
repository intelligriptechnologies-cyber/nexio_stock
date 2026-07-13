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
    <div className="relative flex min-h-full items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.18),_transparent_46%),linear-gradient(160deg,#0f172a_0%,#1f2937_44%,#111827_100%)] p-stack-gap">
      <div className="absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(255,255,255,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.06)_1px,transparent_1px)] [background-size:28px_28px]" />
      <section className="relative w-full max-w-[460px] overflow-hidden rounded-2xl border border-white/15 bg-white/95 shadow-2xl shadow-black/30 ring-1 ring-white/25">
        <div className="border-b border-slate-200 px-gutter py-6">
          <p className="text-label-md uppercase tracking-[0.24em] text-slate-500">Barstock</p>
          <h1 className="mt-2 text-headline-lg text-slate-900">Shop login</h1>
          <p className="mt-2 text-body-md text-slate-600">
            Sign in with your role, username, and PIN/password.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-stack-gap px-gutter py-gutter text-slate-900">
          <div className="grid gap-stack-gap">
            <label className="flex flex-col gap-1 text-label-md">
              Role
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as ShopLoginRole)}
                className="min-h-touchTarget-sm rounded-md border border-slate-300 bg-white px-stack-gap text-body-md shadow-inner focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
              >
                {ROLE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1 text-label-md">
              Username
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={defaultUsername(role)}
                className="min-h-touchTarget-sm rounded-md border border-slate-300 bg-white px-stack-gap text-body-md shadow-inner focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                autoComplete="username"
                autoFocus
                required
              />
              <span className="text-label-sm text-slate-500">
                Use the account username assigned for this shop, for example {defaultUsername(role)}.
              </span>
            </label>

            <label className="flex flex-col gap-1 text-label-md">
              PIN / password
              <input
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (error) setError(null);
                }}
                className="min-h-touchTarget-sm rounded-md border border-slate-300 bg-white px-stack-gap text-body-md shadow-inner focus:border-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900/10"
                autoComplete="current-password"
                required
              />
            </label>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 px-stack-gap py-4">
            <div className="text-label-md text-slate-500">Device</div>
            <div className="mt-1 font-mono text-label-md text-slate-900 break-all">{deviceKey}</div>
            <div className="mt-2 text-body-sm text-slate-600">{statusText}</div>
            {deviceStatus?.shop_name && (
              <div className="mt-2 flex flex-wrap gap-2 text-label-md text-slate-700">
                <span className="rounded-full bg-slate-900 px-2 py-1 text-white">
                  {deviceStatus.shop_name}
                </span>
                {deviceStatus.counter_name && (
                  <span className="rounded-full bg-slate-200 px-2 py-1">
                    Counter: {deviceStatus.counter_name}
                  </span>
                )}
              </div>
            )}
          </div>

          {error && (
            <div
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 px-stack-gap py-3 text-red-800"
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={!canSubmit}
            className="min-h-touchTarget rounded-md bg-slate-900 text-label-xl text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {checkingDevice ? "Checking device..." : submitting ? "Signing in..." : "LOGIN"}
          </button>
        </form>

        <button
          type="button"
          onClick={() => navigate("/login/superadmin")}
          className="absolute bottom-4 right-4 rounded-md border border-slate-300 bg-white/90 px-3 py-1 text-label-md text-slate-600 shadow-sm transition hover:bg-white hover:text-slate-900"
        >
          Superadmin login
        </button>
      </section>
    </div>
  );
}
