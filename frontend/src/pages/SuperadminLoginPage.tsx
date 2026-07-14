import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Api, ApiError } from "../api/client";
import { type AuthUser, type Role, useAuth } from "../auth/AuthProvider";
import { AuthShell } from "../components/AuthShell";

const FIELD_CLASS =
  "h-12 w-full rounded-2xl border border-white/10 bg-[#1c1714] px-4 text-sm text-white shadow-sm transition-[background-color,box-shadow,border-color] duration-200 ease-out hover:border-amber-300/45 hover:bg-[#241d1a] focus:border-amber-300 focus:bg-[#241d1a] focus:outline-none focus:ring-4 focus:ring-amber-300/10";

export function SuperadminLoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await Api.loginSuperadmin(username, password);
      const raw = res.user as Record<string, unknown>;
      const user: AuthUser = {
        id: Number(raw.id),
        shopId: raw.shop_id == null ? null : Number(raw.shop_id),
        role: raw.role as Role,
        username: String(raw.username ?? ""),
        fullName: String(raw.full_name ?? ""),
        phone: String(raw.phone ?? ""),
      };
      login(res.access_token, user);
      navigate("/admin", { replace: true });
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 401) setError("Invalid username or password.");
        else if (e.status === 0) setError("Network error - is the backend reachable?");
        else setError(e.detail);
      } else {
        setError("Unexpected error.");
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell
      variant="superadmin"
      title="Superadmin sign in"
      subcopy="Use your admin username and password to manage shops, access, and inventory control."
      footerActionLabel="Back to shop login"
      footerActionTo="/login"
      footerActionText="Need the shop counter?"
    >
      <form onSubmit={submit} className="flex flex-col gap-4 text-white">
        <div className="grid gap-4">
          <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-200">
            Username
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className={FIELD_CLASS}
              autoFocus
              required
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-200">
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={FIELD_CLASS}
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
          disabled={loading}
          className="group mt-1 flex h-12 items-center justify-center rounded-2xl bg-amber-400 px-4 text-sm font-semibold tracking-wide text-slate-950 shadow-[0_18px_45px_rgba(251,191,36,0.2)] transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:bg-amber-300 hover:shadow-[0_24px_60px_rgba(251,191,36,0.24)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:shadow-[0_18px_45px_rgba(251,191,36,0.2)]"
        >
          <span className="relative z-10">{loading ? "Signing in..." : "Sign in"}</span>
        </button>
      </form>
    </AuthShell>
  );
}
