import { useEffect, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth, type Role } from "../auth/AuthProvider";
import { useShopScope } from "../auth/ShopScopeProvider";
import { PENDING_PRODUCTS_CHANGED_EVENT } from "../api/pending-products-events";
import { getPendingProductCount } from "../api/products";
import { useSettingsTheme } from "../theme/settingsThemeContext";
import { ShopPicker } from "./ShopPicker";

interface NavItem {
  to: string;
  label: string;
  roles: Role[];
}

const ITEMS: NavItem[] = [
  { to: "/checkout", label: "Checkout", roles: ["cashier_user", "owner", "superadmin"] },
  { to: "/invoices", label: "Invoices", roles: ["cashier_user", "owner", "superadmin"] },
  { to: "/receiving", label: "Receiving", roles: ["receiver_user", "owner", "superadmin"] },
  // Issue #43 — Inventory page. Open to all three shop-scoped roles
  // (D-v3-13) and superadmin.
  { to: "/inventory", label: "Inventory", roles: ["cashier_user", "receiver_user", "owner", "superadmin"] },
  { to: "/dashboard", label: "Dashboard", roles: ["owner", "superadmin"] },
  { to: "/inventory", label: "Inventory", roles: ["owner", "superadmin"] },
  { to: "/admin/shops", label: "Shops", roles: ["superadmin"] },
  { to: "/admin/products", label: "Products", roles: ["owner", "superadmin"] },
  { to: "/admin/pending", label: "Pending", roles: ["owner", "superadmin"] },
  { to: "/admin/staff", label: "Staff", roles: ["owner", "superadmin"] },
  { to: "/admin/settings", label: "Settings", roles: ["owner", "superadmin"] },
  { to: "/admin/voids", label: "Void Approvals", roles: ["owner", "superadmin"] },
  { to: "/admin/logs", label: "Logs", roles: ["owner", "superadmin"] },
];

export function Sidebar() {
  const { user, logout } = useAuth();
  const { actingShopId } = useShopScope();
  const { displayName } = useSettingsTheme();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

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

  if (!user) return null;
  const items = ITEMS.filter((i) => i.roles.includes(user.role));

  return (
    <>
      {/* Mobile menu trigger */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="fixed left-3 top-3 z-40 flex h-12 w-12 items-center justify-center rounded-md bg-action text-on-action md:hidden"
        aria-label="Toggle menu"
      >
        ☰
      </button>

      {/* Drawer overlay on mobile, fixed sidebar on desktop */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 flex w-64 flex-col border-r border-outline bg-sidebar text-on-sidebar transition-transform md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-label="Main navigation"
      >
        <div className="flex h-16 items-center justify-start pl-5 pr-stack-gap text-left text-headline-md font-bold">
          {displayName}
        </div>
        <ShopPicker />
        <nav className="flex flex-1 flex-col gap-1">
          {items.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `flex min-h-touchTarget-nav items-center pl-9 pr-stack-gap text-left text-label-md font-bold transition ${
                  isActive
                    ? "bg-sidebar-active text-on-sidebar-active shadow-sm"
                    : "text-on-sidebar-muted hover:bg-sidebar-hover hover:text-on-sidebar"
                }`
              }
            >
              <span className="flex-1">
                {it.to === "/admin/pending" ? `Pending (${pendingCount})` : it.label}
              </span>
              {it.to === "/admin/pending" && pendingCount > 0 && (
                <span className="rounded bg-action px-2 py-0.5 text-label-md text-on-action">
                  NEW
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-outline p-stack-gap">
          <div className="text-label-md">{user.fullName}</div>
          <div className="text-label-md text-on-sidebar-muted">{user.role}</div>
          <button
            type="button"
            onClick={() => {
              logout();
              navigate("/login");
            }}
            className="mt-stack-gap w-full min-h-touchTarget-sm rounded-md bg-logout text-on-logout"
          >
            Logout
          </button>
        </div>
      </aside>

      {open && (
        <div
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-20 bg-black/40 md:hidden"
          aria-hidden="true"
        />
      )}
    </>
  );
}
