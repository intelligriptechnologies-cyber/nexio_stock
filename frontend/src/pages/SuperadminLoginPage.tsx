import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Api, ApiError } from "../api/client";
import { useAuth, type AuthUser, type Role } from "../auth/AuthProvider";

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
        else if (e.status === 0) setError("Network error — is the backend reachable?");
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
        className="flex w-full max-w-sm flex-col gap-stack-gap rounded-lg bg-surface-container p-gutter shadow"
      >
        <h1 className="text-headline-md text-primary">Superadmin Login</h1>
        <label className="flex flex-col gap-1 text-label-md">
          Username
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="min-h-touchTarget-sm rounded-md border border-outline bg-surface-container-high px-stack-gap text-body-md"
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
            className="min-h-touchTarget-sm rounded-md border border-outline bg-surface-container-high px-stack-gap text-body-md"
            required
          />
        </label>
        <button
          type="submit"
          disabled={loading}
          className="min-h-touchTarget rounded-md bg-accent text-on-accent"
        >
          {loading ? "Signing in…" : "LOGIN"}
        </button>
        {error && (
          <div role="alert" className="rounded-md bg-error px-stack-gap py-3 text-on-error">
            {error}
          </div>
        )}
        <a href="/login" className="text-center text-label-md underline text-on-surface-variant">
          Back to shop login
        </a>
      </form>
    </div>
  );
}