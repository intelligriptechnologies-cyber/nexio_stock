import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth, type Role } from "./auth/AuthProvider";
import { Sidebar } from "./components/Sidebar";
import { LoginPage } from "./pages/LoginPage";
import { SuperadminLoginPage } from "./pages/SuperadminLoginPage";
import { ForbiddenPage } from "./pages/ForbiddenPage";
import { HomeRedirect } from "./pages/HomeRedirect";
import { CheckoutPage } from "./pages/CheckoutPage";
import { ReceivingPage } from "./pages/ReceivingPage";
import { DashboardPage } from "./pages/DashboardPage";
import { AdminPlaceholder } from "./pages/AdminPlaceholder";
import { ProductsPage } from "./pages/ProductsPage";
import { VoidApprovalsPage } from "./pages/VoidApprovalsPage";
import { InvoiceLookupPage } from "./pages/InvoiceLookupPage";
import { StaffPage } from "./pages/StaffPage";
import { SettingsPage } from "./pages/SettingsPage";
import { PendingProductsPage } from "./pages/PendingProductsPage";
import { ShopMaintenancePage } from "./pages/ShopMaintenancePage";
import { LogsPage } from "./pages/LogsPage";
import { InventoryPage } from "./pages/InventoryPage";

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
    <div className="h-full bg-surface">
      <Sidebar />
      <main className="h-full overflow-y-auto p-stack-gap md:ml-64 md:p-gutter">{children}</main>
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
          <Protected allow={["cashier_user", "owner", "superadmin"]}>
            <AuthedShell>
              <CheckoutPage />
            </AuthedShell>
          </Protected>
        }
      />
      <Route
        path="/receiving"
        element={
          <Protected allow={["receiver_user", "owner", "superadmin"]}>
            <AuthedShell>
              <ReceivingPage />
            </AuthedShell>
          </Protected>
        }
      />
      <Route
        path="/dashboard"
        element={
          <Protected allow={["owner", "superadmin"]}>
            <AuthedShell>
              <DashboardPage />
            </AuthedShell>
          </Protected>
        }
      />
      <Route
        path="/inventory"
        element={
          <Protected allow={["owner", "superadmin"]}>
            <AuthedShell>
              <InventoryPage />
            </AuthedShell>
          </Protected>
        }
      />
      <Route
        path="/admin"
        element={
          <Protected allow={["owner", "superadmin"]}>
            <AuthedShell>
              <AdminPlaceholder />
            </AuthedShell>
          </Protected>
        }
      />
      <Route
        path="/admin/shops"
        element={
          <Protected allow={["superadmin"]}>
            <AuthedShell>
              <ShopMaintenancePage />
            </AuthedShell>
          </Protected>
        }
      />
      <Route
        path="/admin/products"
        element={
          <Protected allow={["owner", "superadmin"]}>
            <AuthedShell>
              <ProductsPage />
            </AuthedShell>
          </Protected>
        }
      />
      <Route
        path="/admin/pending"
        element={
          <Protected allow={["owner", "superadmin"]}>
            <AuthedShell>
              <PendingProductsPage />
            </AuthedShell>
          </Protected>
        }
      />
      <Route
        path="/admin/voids"
        element={
          <Protected allow={["owner", "superadmin"]}>
            <AuthedShell>
              <VoidApprovalsPage />
            </AuthedShell>
          </Protected>
        }
      />
      <Route
        path="/admin/staff"
        element={
          <Protected allow={["owner", "superadmin"]}>
            <AuthedShell>
              <StaffPage />
            </AuthedShell>
          </Protected>
        }
      />
      <Route
        path="/admin/settings"
        element={
          <Protected allow={["owner", "superadmin"]}>
            <AuthedShell>
              <SettingsPage />
            </AuthedShell>
          </Protected>
        }
      />
      <Route
        path="/admin/logs"
        element={
          <Protected allow={["owner", "superadmin"]}>
            <AuthedShell>
              <LogsPage />
            </AuthedShell>
          </Protected>
        }
      />
      <Route path="/admin/shop" element={<Navigate to="/admin/settings" replace />} />
      <Route
        path="/invoices"
        element={
          <Protected allow={["cashier_user", "owner", "superadmin"]}>
            <AuthedShell>
              <InvoiceLookupPage />
            </AuthedShell>
          </Protected>
        }
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
