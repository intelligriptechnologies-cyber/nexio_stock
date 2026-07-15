import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth, type Role } from "./auth/AuthProvider";
import { Sidebar } from "./components/Sidebar";
import { FocusedModeContext, type FocusedModeContextValue } from "./components/FocusedModeContext";
import { LoginPage } from "./pages/LoginPage";
import { SuperadminLoginPage } from "./pages/SuperadminLoginPage";
import { ForbiddenPage } from "./pages/ForbiddenPage";
import { HomeRedirect } from "./pages/HomeRedirect";
import { CheckoutPage } from "./pages/CheckoutPage";
import { ReceivingPage } from "./pages/ReceivingPage";
import { DashboardPage } from "./pages/DashboardPage";
import { AdminPlaceholder } from "./pages/AdminPlaceholder";
import { ProductsPage } from "./pages/ProductsPage";
import { InvoiceLookupPage } from "./pages/InvoiceLookupPage";
import { StaffPage } from "./pages/StaffPage";
import { SettingsPage } from "./pages/SettingsPage";
import { PendingProductsPage } from "./pages/PendingProductsPage";
import { ShopMaintenancePage } from "./pages/ShopMaintenancePage";
import { VendorsPage } from "./pages/VendorsPage";
import { LogsPage } from "./pages/LogsPage";
import { InventoryPage } from "./pages/InventoryPage";
import { ApprovalsPage } from "./pages/ApprovalsPage";
import { StockTrackingPage } from "./pages/StockTrackingPage";

const FOCUSED_MODE_STORAGE_KEY = "nexio.focused-mode-enabled";
const FOCUSED_MODE_PATHS = new Set(["/checkout", "/receiving"]);

function readFocusedModePreference(): boolean {
  try {
    return localStorage.getItem(FOCUSED_MODE_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function writeFocusedModePreference(enabled: boolean) {
  try {
    localStorage.setItem(FOCUSED_MODE_STORAGE_KEY, enabled ? "true" : "false");
  } catch {
    // Ignore storage failures and keep the in-memory preference.
  }
}

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
  const location = useLocation();
  const shellRef = useRef<HTMLDivElement | null>(null);
  const supportsFocusedMode = FOCUSED_MODE_PATHS.has(location.pathname);
  const supportsFocusedModeRef = useRef(supportsFocusedMode);
  const [focusedModePreference, setFocusedModePreference] = useState(readFocusedModePreference);
  const [isBrowserFullscreenActive, setIsBrowserFullscreenActive] = useState(
    () => typeof document !== "undefined" && Boolean(document.fullscreenElement)
  );
  const previousFullscreenStateRef = useRef(isBrowserFullscreenActive);

  useEffect(() => {
    supportsFocusedModeRef.current = supportsFocusedMode;
  }, [supportsFocusedMode]);

  useEffect(() => {
    writeFocusedModePreference(focusedModePreference);
  }, [focusedModePreference]);

  useEffect(() => {
    const onFullscreenChange = () => {
      const isActive = Boolean(document.fullscreenElement);
      setIsBrowserFullscreenActive(isActive);
      if (previousFullscreenStateRef.current && !isActive && supportsFocusedModeRef.current) {
        setFocusedModePreference(false);
      }
      previousFullscreenStateRef.current = isActive;
    };

    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
    };
  }, []);

  useEffect(() => {
    if (supportsFocusedMode || !document.fullscreenElement || !document.exitFullscreen) return;
    void document.exitFullscreen().catch(() => {
      // Ignore denied exits; the layout already returns to the normal shell.
    });
  }, [supportsFocusedMode]);

  const enterFocusedMode = useCallback(async () => {
    setFocusedModePreference(true);
    if (document.fullscreenElement || !shellRef.current?.requestFullscreen) return;
    try {
      await shellRef.current.requestFullscreen();
    } catch {
      // Best effort only. Focused layout still stays enabled.
    }
  }, []);

  const exitFocusedMode = useCallback(async () => {
    setFocusedModePreference(false);
    if (!document.fullscreenElement || !document.exitFullscreen) return;
    try {
      await document.exitFullscreen();
    } catch {
      // Ignore exit failures; preference is already cleared.
    }
  }, []);

  const focusedModeValue = useMemo<FocusedModeContextValue>(
    () => ({
      supportsFocusedMode,
      isFocusedModeEnabled: supportsFocusedMode && focusedModePreference,
      isBrowserFullscreenActive,
      enterFocusedMode,
      exitFocusedMode,
    }),
    [
      enterFocusedMode,
      exitFocusedMode,
      focusedModePreference,
      isBrowserFullscreenActive,
      supportsFocusedMode,
    ]
  );

  if (!user) return <Navigate to="/login" replace />;
  return (
    <FocusedModeContext.Provider value={focusedModeValue}>
      <div ref={shellRef} className="h-full bg-slate-50 text-slate-900">
        {!focusedModeValue.isFocusedModeEnabled && <Sidebar />}
        <main
          data-app-shell-scroll-container="true"
          className={`h-full overflow-y-auto p-margin-mobile animate-fade-in ${
            focusedModeValue.isFocusedModeEnabled ? "md:p-margin-desktop" : "md:ml-64 md:p-margin-desktop"
          }`}
        >
          {children}
        </main>
      </div>
    </FocusedModeContext.Provider>
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
          <Protected allow={["receiver_user", "cashier_user", "owner", "superadmin"]}>
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
        path="/admin/vendors"
        element={
          <Protected allow={["owner", "superadmin"]}>
            <AuthedShell>
              <VendorsPage />
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
        path="/approvals"
        element={
          <Protected allow={["owner", "superadmin"]}>
            <AuthedShell>
              <ApprovalsPage />
            </AuthedShell>
          </Protected>
        }
      />
      <Route
        path="/admin/voids"
        element={
          <Protected allow={["owner", "superadmin"]}>
            <Navigate to="/approvals?tab=voids" replace />
          </Protected>
        }
      />
      <Route
        path="/admin/stock-inward-queue"
        element={
          <Protected allow={["owner", "superadmin"]}>
            <Navigate to="/approvals?tab=inward" replace />
          </Protected>
        }
      />
      <Route
        path="/admin/stock-tracking"
        element={
          <Protected allow={["owner", "superadmin"]}>
            <AuthedShell>
              <StockTrackingPage />
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
