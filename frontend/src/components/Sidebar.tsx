import { useEffect, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { getPendingProductCount } from "../api/products";
import { getPendingApprovalsCount } from "../api/approvals";
import { PENDING_PRODUCTS_CHANGED_EVENT } from "../api/pending-products-events";
import { APPROVALS_CHANGED_EVENT } from "../api/approvals-events";
import { useAuth, type Role } from "../auth/AuthProvider";
import { useShopScope } from "../auth/ShopScopeProvider";
import { useSettingsTheme } from "../theme/settingsThemeContext";
import { useConnectivityStatus } from "../hooks/useOnlineStatus";
import { ShopPicker } from "./ShopPicker";

interface NavItem {
  to: string;
  label: string;
  roles: Role[];
}

const ITEMS: NavItem[] = [
  { to: "/checkout", label: "Checkout", roles: ["cashier_user", "owner", "superadmin"] },
  { to: "/invoices", label: "Invoices", roles: ["cashier_user", "owner", "superadmin"] },
  { to: "/receiving", label: "Stock Inward", roles: ["receiver_user", "owner", "superadmin"] },
  { to: "/dashboard", label: "Dashboard", roles: ["owner", "superadmin"] },
  {
    to: "/inventory",
    label: "Inventory",
    roles: ["receiver_user", "cashier_user", "owner", "superadmin"],
  },
  { to: "/admin/stock-tracking", label: "Stock Tracking", roles: ["owner", "superadmin"] },
  { to: "/admin/shops", label: "Shop Master", roles: ["superadmin"] },
  { to: "/admin/products", label: "Products", roles: ["owner", "superadmin"] },
  { to: "/admin/vendors", label: "Vendors", roles: ["owner", "superadmin"] },
  { to: "/admin/pending", label: "Pending", roles: ["owner", "superadmin"] },
  { to: "/admin/staff", label: "Staff", roles: ["owner"] },
  { to: "/admin/settings", label: "Settings", roles: ["owner", "superadmin"] },
  { to: "/approvals", label: "Approvals", roles: ["owner", "superadmin"] },
  { to: "/admin/logs", label: "Logs", roles: ["owner", "superadmin"] },
];

const ADMIN_SUPPORT_PATHS = new Set(["/admin/settings", "/admin/logs"]);

export function Sidebar() {
  const { user, logout } = useAuth();
  const { actingShopId } = useShopScope();
  const { displayName } = useSettingsTheme();
  const connectivity = useConnectivityStatus();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [approvalCount, setApprovalCount] = useState(0);

  useEffect(() => {
    if (!user || !["owner", "superadmin"].includes(user.role)) return;
    let cancelled = false;
    const refresh = () => {
      getPendingProductCount(actingShopId)
        .then((r) => {
          if (!cancelled) setPendingCount(r.count);
        })
        .catch(() => {
          if (!cancelled) setPendingCount(0);
        });
    };
    refresh();
    window.addEventListener(PENDING_PRODUCTS_CHANGED_EVENT, refresh);
    return () => {
      cancelled = true;
      window.removeEventListener(PENDING_PRODUCTS_CHANGED_EVENT, refresh);
    };
  }, [actingShopId, user]);

  useEffect(() => {
    if (!user || !["owner", "superadmin"].includes(user.role)) return;
    let cancelled = false;
    const refresh = () => {
      getPendingApprovalsCount(actingShopId)
        .then((count) => {
          if (!cancelled) setApprovalCount(count);
        })
        .catch(() => {
          if (!cancelled) setApprovalCount(0);
        });
    };
    refresh();
    window.addEventListener(APPROVALS_CHANGED_EVENT, refresh);
    return () => {
      cancelled = true;
      window.removeEventListener(APPROVALS_CHANGED_EVENT, refresh);
    };
  }, [actingShopId, user]);

  if (!user) return null;
  const items = ITEMS.filter((i) => i.roles.includes(user.role));
  const mainItems = items.filter((i) => !ADMIN_SUPPORT_PATHS.has(i.to));
  const adminSupportItems = items.filter((i) => ADMIN_SUPPORT_PATHS.has(i.to));
  const connectivityLabel =
    connectivity.status === "online"
      ? "Online"
      : connectivity.status === "offline"
        ? "No network"
        : "Checking";
  const connectivityDotClass =
    connectivity.status === "online"
      ? "bg-success"
      : connectivity.status === "offline"
        ? "bg-error"
        : "bg-warning";
  const renderNavItem = (it: NavItem) => (
    <NavLink
      key={it.to}
      to={it.to}
      onClick={() => setOpen(false)}
      className={({ isActive }) =>
        `group app-sidebar-nav-item focus-visible active:scale-[0.97] ${
          isActive
            ? "app-sidebar-nav-item-active"
            : "app-sidebar-nav-item-inactive"
        }`
      }
    >
      <span className="flex-1 transition-transform duration-300 group-hover:translate-x-1">
        {it.to === "/admin/pending"
          ? `Pending (${pendingCount})`
          : it.to === "/approvals"
            ? `Approvals (${approvalCount})`
            : it.label}
      </span>
      {it.to === "/admin/pending" && pendingCount > 0 && (
        <span className="animate-modal-in ml-2 flex h-5 items-center justify-center rounded-full bg-action px-2 text-[10px] font-bold text-on-action shadow-sm">
          NEW
        </span>
      )}
      {it.to === "/approvals" && approvalCount > 0 && (
        <span className="animate-modal-in ml-2 flex h-5 items-center justify-center rounded-full bg-action px-2 text-[10px] font-bold text-on-action shadow-sm">
          NEW
        </span>
      )}
    </NavLink>
  );

  return (
    <>
      {/* Mobile menu trigger */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`fixed left-4 top-4 z-40 flex h-11 w-11 items-center justify-center rounded-xl bg-action/90 text-on-action shadow-lg backdrop-blur-md transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:scale-[1.02] hover:bg-action active:scale-[0.95] md:hidden ${
          open ? "pointer-events-none opacity-0" : "opacity-100"
        }`}
        aria-label="Toggle menu"
      >
        <span className="flex flex-col gap-1.5" aria-hidden="true">
          <span className={`block h-0.5 w-5 rounded-full bg-current transition-transform duration-300 ${open ? "translate-y-2 rotate-45" : ""}`} />
          <span className={`block h-0.5 w-5 rounded-full bg-current transition-opacity duration-300 ${open ? "opacity-0" : ""}`} />
          <span className={`block h-0.5 w-5 rounded-full bg-current transition-transform duration-300 ${open ? "-translate-y-2 -rotate-45" : ""}`} />
        </span>
      </button>

      {/* Drawer overlay on mobile, fixed sidebar on desktop */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 flex w-[280px] flex-col border-r border-slate-200/60 bg-[#dbe4ee] text-slate-900 shadow-[20px_0_60px_rgba(0,0,0,0.03)] backdrop-blur-2xl transition-transform duration-500 ease-out md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-label="Main navigation"
      >
        <div className="app-sidebar-header shrink-0 pb-3">
          <div className="flex h-20 items-center justify-start px-8 text-left text-2xl font-bold tracking-tight text-slate-900">
            {displayName}
          </div>
          <div className="px-3 pt-0">
            <ShopPicker />
          </div>
          <div className="app-sidebar-section-divider mx-6 mt-3" aria-hidden="true" />
        </div>
        <nav className="custom-scrollbar flex flex-1 flex-col gap-1 overflow-y-auto pb-6 pt-2">
          {mainItems.map(renderNavItem)}
          {adminSupportItems.length > 0 && (
            <div className="mt-6 pt-4">
              <div className="mb-3 px-8 text-[12px] font-bold uppercase tracking-widest text-slate-400">System</div>
              <div className="flex flex-col gap-1">{adminSupportItems.map(renderNavItem)}</div>
            </div>
          )}
        </nav>
        <div className="shrink-0 border-t border-slate-200/50 bg-white/20 p-6 backdrop-blur-sm">
          <div className="mb-5 flex items-center gap-3 text-sm">
            <span className="relative flex h-2 w-2">
              <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${connectivityDotClass}`} aria-hidden="true" />
              <span className={`relative inline-flex h-2 w-2 rounded-full ${connectivityDotClass}`} aria-hidden="true" />
            </span>
            <span className="font-medium text-slate-600">{connectivityLabel}</span>
          </div>
          <div className="mb-1 text-base font-semibold tracking-tight text-slate-900">{user.fullName}</div>
          <div className="text-[12px] font-bold uppercase tracking-widest text-slate-400">{user.role}</div>
          <button
            type="button"
            onClick={() => {
              logout();
              navigate("/login");
            }}
            className="group relative mt-5 flex h-11 w-full items-center justify-center overflow-hidden rounded-xl bg-logout text-sm font-bold tracking-wide text-on-logout shadow-sm transition-[transform,box-shadow,background-color] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-md active:scale-[0.97] active:translate-y-0"
          >
            <span className="relative z-10 transition-transform duration-300 group-hover:translate-x-1">Logout</span>
          </button>
        </div>
      </aside>

      {open && (
        <div
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-20 bg-black/40 backdrop-blur-sm transition-opacity duration-500 md:hidden"
          aria-hidden="true"
        />
      )}
    </>
  );
}
