import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Api, ApiError } from "../api/client";
import { type AuthUser, type Role, useAuth } from "../auth/AuthProvider";
import { AuthShell } from "../components/AuthShell";

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
      badge="RESTRICTED ACCESS"
      title="Superadmin Panel"
      subcopy="Initialize secure bridge connection for cross-shop administration."
      shellWidthClassName="max-w-[42rem]"
      contentWidthClassName="max-w-[23.5rem]"
      headerLinks={[
        { label: "Help", to: "/help/login" },
        { label: "Terms and Conditions", to: "/terms" },
      ]}
    >
      <form onSubmit={submit} className="auth-terminal-form">
        <label className="block">
          <span className="auth-terminal-label">Admin Username</span>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="auth-terminal-field"
            autoFocus
            required
            aria-label="Admin Username"
          />
        </label>

        <label className="block">
          <span className="auth-terminal-label">Secure Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="auth-terminal-field"
            required
            aria-label="Secure Password"
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

        <button type="submit" disabled={loading} className="auth-terminal-submit">
          {loading ? "Signing in..." : "Enter Control Panel"}
        </button>

        <div className="border-t border-white/8 pt-4 text-center [@media(max-height:840px)]:pt-3">
          <Link to="/login" className="auth-terminal-link">
            Back to shop login
          </Link>
        </div>
      </form>
    </AuthShell>
  );
}
