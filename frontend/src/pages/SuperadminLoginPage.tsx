import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Api, ApiError } from "../api/client";
import { type AuthUser, type Role, useAuth } from "../auth/AuthProvider";

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
    <div className="relative flex min-h-full items-center justify-center overflow-hidden bg-[#030712] p-6 font-sans">
      {/* Dark Mode Purple Accents */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-purple-600/10 blur-[120px]" />
      
      <form
        onSubmit={submit}
        className="relative w-full max-w-[420px] overflow-hidden rounded-2xl border border-white/10 bg-[#0f172a]/80 shadow-[0_8px_40px_rgb(0,0,0,0.4)] backdrop-blur-xl transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:border-purple-500/30 hover:shadow-[0_8px_60px_rgba(139,92,246,0.15)]"
      >
        <div className="border-b border-white/5 px-8 py-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-purple-500/10 text-purple-400 ring-1 ring-purple-500/20">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
          </div>
          <h1 className="text-2xl font-light tracking-tight text-white">Superadmin</h1>
          <p className="mt-2 text-sm text-slate-400">Restricted system access</p>
        </div>

        <div className="flex flex-col gap-6 px-8 py-8">
          <div className="flex flex-col gap-5">
            <label className="flex flex-col gap-2 text-sm font-medium text-slate-300">
              Username
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="h-11 w-full rounded-xl border border-white/10 bg-[#1e293b]/50 px-4 text-sm text-white shadow-inner transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:border-purple-500/30 focus:border-purple-500 focus:bg-[#1e293b] focus:outline-none focus:ring-4 focus:ring-purple-500/20"
                autoFocus
                required
              />
            </label>
            <label className="flex flex-col gap-2 text-sm font-medium text-slate-300">
              Password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-11 w-full rounded-xl border border-white/10 bg-[#1e293b]/50 px-4 text-sm text-white shadow-inner transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:border-purple-500/30 focus:border-purple-500 focus:bg-[#1e293b] focus:outline-none focus:ring-4 focus:ring-purple-500/20"
                required
              />
            </label>
          </div>

          {error && (
            <div
              role="alert"
              className="animate-in fade-in slide-in-from-top-1 rounded-xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-400 backdrop-blur-md"
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="group relative mt-2 flex h-11 items-center justify-center overflow-hidden rounded-xl bg-purple-600 text-sm font-semibold tracking-wide text-white shadow-lg shadow-purple-600/20 transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:bg-purple-500 hover:shadow-xl hover:shadow-purple-600/40 active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 disabled:hover:shadow-lg"
          >
            <span className="relative z-10">{loading ? "Authenticating..." : "Sign In"}</span>
          </button>

          <button
            type="button"
            onClick={() => navigate("/login")}
            className="mt-2 text-center text-xs font-medium text-slate-500 transition-colors duration-300 hover:text-slate-300"
          >
            &larr; Back to Shop Login
          </button>
        </div>
      </form>
    </div>
  );
}
