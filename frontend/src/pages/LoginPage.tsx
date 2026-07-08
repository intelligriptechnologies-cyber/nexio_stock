import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Api, ApiError } from "../api/client";
import { useAuth, homePathFor, type AuthUser, type Role } from "../auth/AuthProvider";
import { PinPad } from "../components/PinPad";

// Issue #24 — login flow is two stages:
//   1. PICKER — render a tap-list of staff names + roles fetched from
//      GET /auth/shop-staff (D-v2-16). The picker returns
//      {id, full_name, role} only; the LoginPage keeps the picked row's
//      id in state for the second stage.
//   2. PIN    — identical to the previous PIN pad; on submit, POST
//      /auth/login with {staff_id, password} instead of {phone, password}
//      (the backend's LoginRequest accepts either identifier — see
//      app/schemas/auth.py).
//
// Superadmin login is unaffected (separate route + page).

type Stage = "picker" | "pin";

interface StaffRow {
  id: number;
  full_name: string;
  role: string;
}

function roleLabel(r: string): string {
  // The picker's role strings are UserRole .values: "owner",
  // "receiver_user", "cashier_user". Render them human-readable.
  if (r === "owner") return "Owner";
  if (r === "receiver_user") return "Receiver";
  if (r === "cashier_user") return "Cashier";
  return r;
}

export function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();
  const [stage, setStage] = useState<Stage>("picker");
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [picked, setPicked] = useState<StaffRow | null>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Stage 1 — fetch the staff list on mount. If the backend is
  // unreachable, show a friendly message rather than a blank screen.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Api.listShopStaff()
      .then((rows) => {
        if (cancelled) return;
        setStaff(rows);
        setError(null);
      })
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof ApiError) {
          if (e.status === 0) {
            setError("Network error — is the backend reachable?");
          } else {
            setError(e.detail);
          }
        } else {
          setError("Could not load staff list.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handlePick = (row: StaffRow) => {
    setError(null);
    setPassword("");
    setPicked(row);
    setStage("pin");
  };

  const handleBackToPicker = () => {
    setStage("picker");
    setPicked(null);
    setPassword("");
    setError(null);
  };

  const handleDigit = (d: string) => {
    setError(null);
    setPassword((p) => p + d);
  };
  const handleBackspace = () => {
    setPassword((p) => p.slice(0, -1));
  };
  const handleClear = () => {
    setPassword("");
  };

  const handleSubmit = async () => {
    setError(null);
    if (password.length < 4) {
      setError("Enter your password/PIN (4+ digits).");
      return;
    }
    if (!picked) return; // type-narrowing; shouldn't happen
    setLoading(true);
    try {
      // The picker intentionally doesn't expose phone (D-v2-16); the
      // backend's LoginRequest accepts staff_id as the alternative
      // identifier for shop login. Either identifier is fine; the
      // backend's role gate (owner/receiver/cashier) is unchanged.
      const json = await Api.loginShop({ staff_id: picked.id }, password);
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
        if (e.status === 401) setError("Invalid PIN.");
        else if (e.status === 0) setError("Network error — is the backend reachable?");
        else setError(e.detail);
      } else {
        setError("Unexpected error.");
      }
    } finally {
      setLoading(false);
    }
  };

  // -------- Render --------

  if (stage === "picker") {
    return (
      <div className="flex min-h-full flex-col items-center justify-center bg-surface p-stack-gap">
        <h1 className="mb-stack-gap text-headline-lg text-primary">Barstock</h1>
        <p className="mb-stack-gap text-body-md text-on-surface-variant">
          Tap your name to sign in
        </p>

        {loading && staff.length === 0 && (
          <div
            role="status"
            className="mb-stack-gap w-full max-w-xs rounded-md bg-surface-container px-stack-gap py-3 text-center text-label-md text-on-surface-variant"
          >
            Loading staff…
          </div>
        )}

        {!loading && staff.length === 0 && !error && (
          <div
            role="status"
            className="mb-stack-gap w-full max-w-xs rounded-md bg-surface-container px-stack-gap py-3 text-center text-label-md text-on-surface-variant"
          >
            No active staff on this shop. Ask your owner to create an account.
          </div>
        )}

        <ul className="mb-stack-gap flex w-full max-w-xs flex-col gap-stack-gap">
          {staff.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => handlePick(row)}
                className="min-h-touchTarget flex w-full items-center justify-between rounded-md bg-surface-container px-stack-gap py-3 text-left hover:bg-surface-container-high"
                data-testid="staff-row"
                data-staff-id={row.id}
                data-staff-role={row.role}
              >
                <span className="text-label-xl text-on-surface">{row.full_name}</span>
                <span className="text-label-md text-on-surface-variant">
                  {roleLabel(row.role)}
                </span>
              </button>
            </li>
          ))}
        </ul>

        {error && (
          <div
            role="alert"
            className="mb-stack-gap w-full max-w-xs rounded-md bg-error px-stack-gap py-3 text-on-error"
          >
            {error}
          </div>
        )}

        <div className="mt-stack-gap flex w-full max-w-xs justify-between text-label-md text-on-surface-variant">
          <button
            type="button"
            onClick={() => navigate("/login/superadmin")}
            className="underline"
          >
            Superadmin login
          </button>
        </div>
      </div>
    );
  }

  // stage === "pin"
  const maskedPw = "•".repeat(password.length);
  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-surface p-stack-gap">
      <h1 className="mb-stack-gap text-headline-lg text-primary">Barstock</h1>
      <p className="mb-stack-gap text-body-md text-on-surface-variant">
        Enter your PIN
      </p>

      <div className="mb-stack-gap w-full max-w-xs rounded-md bg-surface-container px-stack-gap py-3 text-center text-label-xl text-on-surface">
        <span className="text-on-surface-variant">Signed in as </span>
        <span className="font-medium">{picked?.full_name}</span>
        {picked ? (
          <span className="ml-2 text-on-surface-variant">({roleLabel(picked.role)})</span>
        ) : null}
      </div>

      <div className="mb-stack-gap min-h-touchTarget w-full max-w-xs rounded-md bg-surface px-stack-gap py-3 text-center font-mono text-headline-md tracking-widest text-on-surface">
        {maskedPw || "—"}
      </div>

      <PinPad
        onDigit={handleDigit}
        onBackspace={handleBackspace}
        onClear={handleClear}
        onSubmit={handleSubmit}
        disabled={loading}
        accentLabel={loading ? "SIGNING IN…" : "LOGIN"}
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
        <button type="button" onClick={handleBackToPicker} className="underline">
          Back
        </button>
        <button
          type="button"
          onClick={() => navigate("/login/superadmin")}
          className="underline"
        >
          Superadmin login
        </button>
      </div>
    </div>
  );
}