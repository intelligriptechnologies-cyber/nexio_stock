import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth, type Role } from "../auth/AuthProvider";
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
  { to: "/dashboard", label: "Dashboard", roles: ["owner", "superadmin"] },
  { to: "/admin/products", label: "Products", roles: ["owner", "superadmin"] },
  { to: "/admin/pending", label: "Pending Products", roles: ["owner", "superadmin"] },
  { to: "/admin/staff", label: "Staff", roles: ["owner", "superadmin"] },
  { to: "/admin/shop", label: "Shop Config", roles: ["owner", "superadmin"] },
  { to: "/admin/voids", label: "Void Approvals", roles: ["owner", "superadmin"] },
];

export function Sidebar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  if (!user) return null;
  const items = ITEMS.filter((i) => i.roles.includes(user.role));

  return (
    <>
      {/* Mobile menu trigger */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="fixed left-3 top-3 z-40 flex h-12 w-12 items-center justify-center rounded-md bg-primary text-on-primary md:hidden"
        aria-label="Toggle menu"
      >
        ☰
      </button>

      {/* Drawer overlay on mobile, fixed sidebar on desktop */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 flex w-64 flex-col bg-primary text-on-primary transition-transform md:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-label="Main navigation"
      >
        <div className="flex h-16 items-center pl-16 pr-stack-gap text-headline-md font-bold md:px-stack-gap">
          Barstock
        </div>
        <ShopPicker />
        <nav className="flex flex-1 flex-col gap-1 px-2">
          {items.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `flex min-h-touchTarget-sm items-center rounded-md px-stack-gap text-label-md transition ${
                  isActive
                    ? "bg-primary-container text-on-primary"
                    : "text-on-primary/80 hover:bg-primary-container/60"
                }`
              }
            >
              {it.label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-on-primary/20 p-stack-gap">
          <div className="text-label-md">{user.fullName}</div>
          <div className="text-label-md text-on-primary/70">{user.role}</div>
          <button
            type="button"
            onClick={() => {
              logout();
              navigate("/login");
            }}
            className="mt-stack-gap w-full min-h-touchTarget-sm rounded-md bg-accent text-on-accent"
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