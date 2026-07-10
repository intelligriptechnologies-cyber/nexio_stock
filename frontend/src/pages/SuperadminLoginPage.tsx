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
    <div className="flex min-h-full items-center justify-center bg-surface p-stack-gap">
      <form
        onSubmit={submit}
        className="w-full max-w-sm overflow-hidden rounded-lg border border-primary/30 bg-primary text-on-primary shadow-2xl shadow-primary/30 ring-1 ring-white/20"
      >
        <div className="border-b border-white/10 px-gutter py-5">
          <p className="text-label-md text-white/70">Restricted access</p>
          <h1 className="mt-1 text-headline-md text-white">Superadmin Login</h1>
        </div>

        <div className="flex flex-col gap-stack-gap bg-surface px-gutter py-gutter text-on-surface">
          <label className="flex flex-col gap-1 text-label-md">
            Username
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="min-h-touchTarget-sm rounded-md border border-outline bg-white px-stack-gap text-body-md text-on-surface shadow-inner focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              autoFocus
              required
            />
          </label>
          <label className="flex flex-col gap-1 text-label-md">
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="min-h-touchTarget-sm rounded-md border border-outline bg-white px-stack-gap text-body-md text-on-surface shadow-inner focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
              required
            />
          </label>

          {error && (
            <div
              role="alert"
              className="rounded-md border border-red-200 bg-error px-stack-gap py-3 text-on-error"
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="min-h-touchTarget rounded-md bg-action text-on-action shadow-sm transition hover:bg-action-hover disabled:cursor-not-allowed disabled:opacity-70"
          >
            {loading ? "Signing in..." : "LOGIN"}
          </button>

          <button
            type="button"
            onClick={() => navigate("/login")}
            className="min-h-touchTarget-sm rounded-md border border-outline bg-surface-container px-stack-gap text-label-md text-on-surface-variant transition hover:bg-surface-container-high"
          >
            Back to shop login
          </button>
        </div>
      </form>
    </div>
  );
}
