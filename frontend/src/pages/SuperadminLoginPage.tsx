import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Api,
  ApiError,
  type LoginSuccessResponse,
  type TwoFactorChallengeResponse,
} from "../api/client";
import { type AuthUser, type Role, useAuth } from "../auth/AuthProvider";
import { AuthShell } from "../components/AuthShell";

export function SuperadminLoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [challenge, setChallenge] = useState<TwoFactorChallengeResponse | null>(null);
  const [accessKey, setAccessKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await Api.loginSuperadmin(username, password);
      if ("auth_status" in res) {
        setChallenge(res);
        setAccessKey("");
        return;
      }
      completeLogin(res);
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

  const completeLogin = (res: LoginSuccessResponse) => {
    const user: AuthUser = {
      id: Number(res.user.id),
      shopId: res.user.shop_id == null ? null : Number(res.user.shop_id),
      role: res.user.role as Role,
      username: String(res.user.username ?? ""),
      fullName: String(res.user.full_name ?? ""),
      phone: String(res.user.phone ?? ""),
    };
    login(res.access_token, user);
    navigate("/admin", { replace: true });
  };

  const verifyAccessKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!challenge) return;
    setError(null);
    setLoading(true);
    try {
      const verified = await Api.verifyTwoFactor({
        challenge_token: challenge.challenge_token,
        access_key: accessKey.trim(),
      });
      completeLogin(verified);
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 401) setError("Wrong access key. Enter the latest 6-digit key.");
        else if (e.status === 410 || e.status === 409 || e.status === 429) {
          setChallenge(null);
          setAccessKey("");
          setError(e.detail);
        } else {
          setError(e.detail);
        }
      } else {
        setError("Unexpected error.");
      }
    } finally {
      setLoading(false);
    }
  };

  const backToCredentials = () => {
    if (loading) return;
    setChallenge(null);
    setAccessKey("");
    setError(null);
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
      {challenge ? (
        <form onSubmit={verifyAccessKey} className="auth-terminal-form">
          <div className="space-y-1">
            <div className="auth-terminal-label">Enter Access Key</div>
            <div className="text-sm text-[#9eb1c5]">Superadmin verification required.</div>
          </div>

          <label className="block">
            <span className="auth-terminal-label">6-Digit Access Key</span>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              value={accessKey}
              onChange={(e) => {
                setAccessKey(e.target.value.replace(/\D/g, "").slice(0, 6));
                if (error) setError(null);
              }}
              className="auth-terminal-field"
              autoFocus
              required
              aria-label="6-Digit Access Key"
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

          <button type="submit" disabled={loading || accessKey.length !== 6} className="auth-terminal-submit">
            {loading ? "Verifying..." : "Verify Access Key"}
          </button>

          <button type="button" onClick={backToCredentials} className="auth-terminal-link text-left">
            Back to login
          </button>
        </form>
      ) : (
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
      )}
    </AuthShell>
  );
}
