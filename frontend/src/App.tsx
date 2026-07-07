import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth, type Role } from "./auth/AuthProvider";
import { Sidebar } from "./components/Sidebar";
import { LoginPage } from "./pages/LoginPage";
import { SuperadminLoginPage } from "./pages/SuperadminLoginPage";
import { ForbiddenPage } from "./pages/ForbiddenPage";
import { HomeRedirect } from "./pages/HomeRedirect";
import { CheckoutPage } from "./pages/CheckoutPage";
import { ReceivingPlaceholder } from "./pages/ReceivingPlaceholder";
import { DashboardPlaceholder } from "./pages/DashboardPlaceholder";
import { AdminPlaceholder } from "./pages/AdminPlaceholder";

function Protected({ allow, children }: { allow: Role[]; children: JSX.Element }) {
  const { user, isReady } = useAuth();
  if (!isReady) {
    return (
      <div className="flex h-full items-center justify-center text-on-surface-variant">
        Loading…
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (!allow.includes(user.role)) return <Navigate to="/forbidden" replace />;
  return children;
}

function AuthedShell({ children }: { children: JSX.Element }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return (
    <div className="flex h-full bg-surface">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-stack-gap md:p-gutter">{children}</main>
    </div>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/login/superadmin" element={<SuperadminLoginPage />} />
      <Route path="/forbidden" element={<ForbiddenPage />} />
      <Route path="/" element={<HomeRedirect />} />

      <Route
        path="/checkout"
        element={
          <Protected allow={["cashier_user", "owner"]}>
            <AuthedShell>
              <CheckoutPage />
            </AuthedShell>
          </Protected>
        }
      />
      <Route
        path="/receiving"
        element={
          <Protected allow={["receiver_user", "owner"]}>
            <AuthedShell>
              <ReceivingPlaceholder />
            </AuthedShell>
          </Protected>
        }
      />
      <Route
        path="/dashboard"
        element={
          <Protected allow={["owner"]}>
            <AuthedShell>
              <DashboardPlaceholder />
            </AuthedShell>
          </Protected>
        }
      />
      <Route
        path="/admin/*"
        element={
          <Protected allow={["owner", "superadmin"]}>
            <AuthedShell>
              <AdminPlaceholder />
            </AuthedShell>
          </Protected>
        }
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}