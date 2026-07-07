import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Api, ApiError } from "../api/client";
import { useAuth, homePathFor, type AuthUser, type Role } from "../auth/AuthProvider";
import { PinPad } from "../components/PinPad";

type Stage = "phone" | "password";

export function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [stage, setStage] = useState<Stage>("phone");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleDigit = (d: string) => {
    setError(null);
    if (stage === "phone") setPhone((p) => p + d);
    else setPassword((p) => p + d);
  };
  const handleBackspace = () => {
    if (stage === "phone") setPhone((p) => p.slice(0, -1));
    else setPassword((p) => p.slice(0, -1));
  };
  const handleClear = () => {
    if (stage === "phone") setPhone("");
    else setPassword("");
  };
  const handleSubmit = async () => {
    setError(null);
    if (stage === "phone") {
      if (phone.length < 7) {
        setError("Enter a phone number (7+ digits).");
        return;
      }
      setStage("password");
      return;
    }
    if (password.length < 4) {
      setError("Enter your password/PIN (4+ digits).");
      return;
    }
    setLoading(true);
    try {
      const res = await Api.loginShop(phone, password);
      const raw = res.user as Record<string, unknown>;
      const user: AuthUser = {
        id: Number(raw.id),
        shopId: raw.shop_id == null ? null : Number(raw.shop_id),
        role: raw.role as Role,
        username: String(raw.username ?? ""),
        fullName: String(raw.full_name ?? ""),
        phone: String(raw.phone ?? phone),
      };
      login(res.access_token, user);
      navigate(homePathFor(user.role), { replace: true });
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 401) setError("Invalid phone or password.");
        else if (e.status === 0) setError("Network error — is the backend reachable?");
        else setError(e.detail);
      } else {
        setError("Unexpected error.");
      }
    } finally {
      setLoading(false);
    }
  };

  const maskedPhone = phone.length > 4 ? phone.slice(0, -4) + "••••" : phone;
  const maskedPw = "•".repeat(password.length);

  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-surface p-stack-gap">
      <h1 className="mb-stack-gap text-headline-lg text-primary">Barstock</h1>
      <p className="mb-stack-gap text-body-md text-on-surface-variant">
        {stage === "phone" ? "Enter your phone number" : "Enter your password"}
      </p>

      <div className="mb-stack-gap min-h-touchTarget w-full max-w-xs rounded-md bg-surface-container px-stack-gap py-3 text-center font-mono text-headline-md tracking-widest text-on-surface">
        {stage === "phone" ? maskedPhone || "—" : maskedPw || "—"}
      </div>

      <PinPad
        onDigit={handleDigit}
        onBackspace={handleBackspace}
        onClear={handleClear}
        onSubmit={handleSubmit}
        disabled={loading}
        accentLabel={stage === "phone" ? "NEXT" : loading ? "SIGNING IN…" : "LOGIN"}
      />

      {error && (
        <div
          role="alert"
          className="mt-stack-gap w-full max-w-xs rounded-md bg-error px-stack-gap py-3 text-on-error"
        >
          {error}
        </div>
      )}

      <div className="mt-stack-gap flex w-full max-w-xs justify-between text-label-md text-on-surface-variant">
        <button
          type="button"
          onClick={() => (stage === "phone" ? navigate("/login/superadmin") : setStage("phone"))}
          className="underline"
        >
          {stage === "phone" ? "Superadmin login" : "Back"}
        </button>
        <a href="/login/superadmin" className="underline">
          ?
        </a>
      </div>
    </div>
  );
}