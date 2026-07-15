import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Store, RefreshCw, Plus, Save, Users, Package, Settings } from "lucide-react";
import { listProducts, type Product } from "../api/products";
import { toUserMessage } from "../api/client";
import {
  createShop,
  createShopUser,
  getMyShop,
  listShopUsers,
  listShops,
  resetShopUserPassword,
  setShopUserActive,
  updateShop,
  type ShopPublic,
  type ShopSummary,
  type ShopUser,
  type ShopUserRole,
} from "../api/shops";
import { useShopScope } from "../auth/ShopScopeProvider";
import { AppTabButton } from "../components/AppTabs";
import { ModalDialog } from "../components/ModalDialog";

const ROLES: ShopUserRole[] = ["owner", "cashier_user", "receiver_user"];
const ROLE_FILTERS = ["all", ...ROLES] as const;
const STATUS_FILTERS = ["all", "active", "inactive"] as const;

type RoleFilter = (typeof ROLE_FILTERS)[number];
type StatusFilter = (typeof STATUS_FILTERS)[number];
type ShopTab = "details" | "users" | "inventory";

const TABS: Array<{ id: ShopTab; label: string }> = [
  { id: "details", label: "Shop Details" },
  { id: "users", label: "Allotted Users" },
  { id: "inventory", label: "Quick Inventory Check" },
];

export function ShopMaintenancePage() {
  const navigate = useNavigate();
  const { actingShopId, setActingShopId, refreshShops } = useShopScope();
  const [shops, setShops] = useState<ShopSummary[]>([]);
  const [selectedShopId, setSelectedShopId] = useState<number | null>(actingShopId);
  const [activeTab, setActiveTab] = useState<ShopTab>("details");
  const [shopDetails, setShopDetails] = useState<ShopPublic | null>(null);
  const [users, setUsers] = useState<ShopUser[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [productQuery, setProductQuery] = useState("");
  const [includeInactiveProducts, setIncludeInactiveProducts] = useState(false);
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const loadShops = useCallback(
    async (nextSelectedShopId?: number | null) => {
      const rows = await listShops();
      setShops(rows);
      setSelectedShopId((current) => {
        if (nextSelectedShopId !== undefined) return nextSelectedShopId;
        if (current != null && rows.some((shop) => shop.id === current)) return current;
        if (actingShopId != null && rows.some((shop) => shop.id === actingShopId)) return actingShopId;
        return rows[0]?.id ?? null;
      });
    },
    [actingShopId]
  );

  const refreshPageData = useCallback(() => {
    setRefreshKey((key) => key + 1);
    refreshShops();
  }, [refreshShops]);

  useEffect(() => {
    loadShops().catch((e) => setError(toUserMessage(e, "Could not load shops.")));
  }, [loadShops, refreshKey]);

  useEffect(() => {
    if (selectedShopId == null) return;
    setActingShopId(selectedShopId);
  }, [selectedShopId, setActingShopId]);

  useEffect(() => {
    let cancelled = false;
    if (selectedShopId == null) {
      setShopDetails(null);
      setUsers([]);
      setProducts([]);
      return;
    }
    setError(null);
    Promise.all([
      getMyShop(selectedShopId),
      listShopUsers(selectedShopId),
      listProducts({
        shopId: selectedShopId,
        q: productQuery.trim() || undefined,
        includeInactive: includeInactiveProducts,
      }),
    ])
      .then(([details, userRows, productRows]) => {
        if (cancelled) return;
        setShopDetails(details);
        setUsers(userRows);
        setProducts(productRows);
      })
      .catch((e) => {
        if (!cancelled) setError(toUserMessage(e, "Could not load selected shop."));
      });
    return () => {
      cancelled = true;
    };
  }, [selectedShopId, productQuery, includeInactiveProducts, refreshKey]);

  const selectedShop = shops.find((shop) => shop.id === selectedShopId) ?? null;
  const filteredUsers = useMemo(
    () =>
      users.filter((user) => {
        const roleOk = roleFilter === "all" || user.role === roleFilter;
        const statusOk =
          statusFilter === "all" ||
          (statusFilter === "active" ? user.is_active : !user.is_active);
        return roleOk && statusOk;
      }),
    [users, roleFilter, statusFilter]
  );
  const selectShop = (shopId: number) => {
    setSelectedShopId(shopId);
    setActingShopId(shopId);
  };

  const reload = () => refreshPageData();

  return (
    <div className="flex flex-col gap-8 font-sans">
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200/50 bg-white/60 p-6 shadow-[0_8px_30px_rgb(0,0,0,0.02)] backdrop-blur-xl">
        <h1 className="flex items-center gap-3 text-2xl font-bold tracking-tight text-slate-900">
          <Store className="h-6 w-6 text-action" /> Shop Master
        </h1>
        <button
          type="button"
          onClick={reload}
          className="group flex h-10 items-center justify-center rounded-xl bg-white px-5 text-sm font-semibold tracking-wide text-slate-700 shadow-sm ring-1 ring-slate-200 transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:scale-[1.02] hover:bg-slate-50 hover:shadow-md active:scale-[0.97]"
        >
          <RefreshCw className="h-4 w-4 text-slate-400 transition-transform duration-300 group-hover:rotate-180" />
          <span className="ml-2">Refresh</span>
        </button>
      </header>

      {error && (
        <div role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600 ring-1 ring-red-200">
          {error}
        </div>
      )}
      {message && (
        <div role="status" className="rounded-xl bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-600 ring-1 ring-emerald-200">
          {message}
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-[300px_1fr]">
        <aside className="flex flex-col gap-6 rounded-xl border border-slate-200/50 bg-white/60 p-6 shadow-[0_8px_30px_rgb(0,0,0,0.02)] backdrop-blur-xl">
          <CreateShopForm
            onCreated={async (shop) => {
              setMessage("Shop created.");
              setActiveTab("details");
              setActingShopId(shop.id);
              setSelectedShopId(shop.id);
              refreshShops();
              setRefreshKey((key) => key + 1);
              await loadShops(shop.id);
            }}
            onError={setError}
          />
          <div className="border-t border-slate-200/50 pt-6">
            <h2 className="mb-4 text-xs font-bold uppercase tracking-widest text-slate-500">Shops</h2>
            <div className="flex max-h-[calc(100vh-28rem)] flex-col gap-2 overflow-y-auto pr-2 custom-scrollbar">
              {shops.map((shop) => (
                <button
                  key={shop.id}
                  type="button"
                  onClick={() => selectShop(shop.id)}
                  className={`group relative flex w-full flex-col items-start gap-0.5 rounded-[18px] px-4 py-3 text-left transition-[transform,opacity,background-color,border-color,box-shadow] duration-200 ease-out ${
                    shop.id === selectedShopId
                      ? "border border-primary bg-primary text-white shadow-[0_10px_24px_rgba(30,41,59,0.18)]"
                      : "border border-slate-300/90 bg-white text-slate-700 shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:border-slate-400 hover:bg-slate-50 hover:shadow-sm"
                  }`}
                  aria-current={shop.id === selectedShopId ? "true" : undefined}
                >
                  <div className="text-[0.95rem] font-bold tracking-tight">{shop.name}</div>
                  <div
                    className={`font-mono text-xs ${
                      shop.id === selectedShopId ? "text-white/80" : "text-slate-400"
                    }`}
                  >
                    {shop.code}
                  </div>
                </button>
              ))}
              {shops.length === 0 && (
                <div className="rounded-xl border border-dashed border-slate-300 py-8 text-center text-sm font-medium text-slate-500">
                  No shops yet.
                </div>
              )}
            </div>
          </div>
        </aside>

        {selectedShop && shopDetails ? (
          <main className="flex min-w-0 flex-col rounded-xl border border-slate-200/50 bg-white/60 shadow-[0_8px_30px_rgb(0,0,0,0.02)] backdrop-blur-xl">
            <div className="border-b border-slate-200/50 px-8 pt-8">
              <div className="mb-6">
                <div className="text-[11px] font-bold uppercase tracking-widest text-slate-500">Selected shop</div>
                <h2 className="text-2xl font-bold tracking-tight text-slate-900">{selectedShop.name}</h2>
              </div>
              <div className="app-tab-strip" role="tablist" aria-label="Shop management tabs">
                {TABS.map((tab) => (
                  <AppTabButton
                    key={tab.id}
                    role="tab"
                    aria-selected={activeTab === tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    active={activeTab === tab.id}
                    className="whitespace-nowrap"
                  >
                    {tab.label}
                  </AppTabButton>
                ))}
              </div>
            </div>
            <div className="app-tab-panel max-h-[calc(100vh-18rem)] overflow-y-auto custom-scrollbar">
              {activeTab === "details" && (
                <EditShopForm
                  shop={shopDetails}
                  fallbackSummary={selectedShop}
                  onSaved={async () => {
                    setMessage("Shop updated.");
                    refreshShops();
                    setRefreshKey((key) => key + 1);
                    await loadShops(selectedShop.id);
                  }}
                  onError={setError}
                />
              )}
              {activeTab === "users" && (
                <UserPanel
                  shopId={selectedShop.id}
                  users={filteredUsers}
                  roleFilter={roleFilter}
                  statusFilter={statusFilter}
                  onRoleFilter={setRoleFilter}
                  onStatusFilter={setStatusFilter}
                  onChanged={() => {
                    setMessage("User updated.");
                    reload();
                  }}
                  onError={setError}
                />
              )}
              {activeTab === "inventory" && (
                <InventoryPanel
                  products={products}
                  query={productQuery}
                  includeInactive={includeInactiveProducts}
                  onQuery={setProductQuery}
                  onIncludeInactive={setIncludeInactiveProducts}
                  onOpenProducts={() => navigate("/admin/products")}
                />
              )}
            </div>
          </main>
        ) : (
          <div className="flex h-[50vh] items-center justify-center rounded-xl border border-slate-200/50 bg-white/60 p-8 shadow-[0_8px_30px_rgb(0,0,0,0.02)] backdrop-blur-xl">
            <div className="text-center text-sm font-medium text-slate-500">
              Create or select a shop to manage its details.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CreateShopForm({
  onCreated,
  onError,
}: {
  onCreated: (shop: ShopPublic) => void | Promise<void>;
  onError: (message: string | null) => void;
}) {
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    onError(null);
    try {
      const shop = await createShop({ name: name.trim(), code: code.trim() });
      setName("");
      setCode("");
      await onCreated(shop);
    } catch (err) {
      onError(toUserMessage(err, "Create shop failed."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-slate-900">
        <Plus className="h-5 w-5 text-action" /> New shop
      </h2>
      <Field label="Name" value={name} onChange={setName} required />
      <Field label="Code" value={code} onChange={setCode} required />
      <button
        type="submit"
        disabled={busy}
        className="mt-2 flex h-11 items-center justify-center rounded-xl bg-action px-6 text-sm font-bold tracking-wide text-white shadow-sm transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[var(--color-action)]/30 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50"
      >
        {busy ? "Creating..." : "Create"}
      </button>
    </form>
  );
}

function EditShopForm({
  shop,
  fallbackSummary,
  onSaved,
  onError,
}: {
  shop: ShopPublic;
  fallbackSummary: ShopSummary;
  onSaved: () => void | Promise<void>;
  onError: (message: string | null) => void;
}) {
  const [name, setName] = useState(shop.name);
  const [code, setCode] = useState(fallbackSummary.code);
  const [threshold, setThreshold] = useState(
    shop.low_stock_threshold_default == null ? "" : String(shop.low_stock_threshold_default)
  );
  const [gstin, setGstin] = useState(shop.gstin ?? "");
  const [dutyRate, setDutyRate] = useState(shop.excise_duty_rate ?? "");
  const [receivingVendorLinkEnabled, setReceivingVendorLinkEnabled] = useState(
    shop.receiving_vendor_link_enabled
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(shop.name);
    setCode(fallbackSummary.code);
    setThreshold(shop.low_stock_threshold_default == null ? "" : String(shop.low_stock_threshold_default));
    setGstin(shop.gstin ?? "");
    setDutyRate(shop.excise_duty_rate ?? "");
    setReceivingVendorLinkEnabled(shop.receiving_vendor_link_enabled);
  }, [shop, fallbackSummary]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    onError(null);
    try {
      const nextThreshold = threshold.trim();
      await updateShop(shop.id, {
        name: name.trim(),
        code: code.trim(),
        low_stock_threshold_default: nextThreshold ? Number(nextThreshold) : null,
        gstin: gstin.trim() || null,
        excise_duty_rate: dutyRate.trim() || null,
        receiving_vendor_link_enabled: receivingVendorLinkEnabled,
      });
      await onSaved();
    } catch (err) {
      onError(toUserMessage(err, "Update shop failed."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-6">
      <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-slate-900">
        <Settings className="h-5 w-5 text-action" /> Shop details
      </h2>
      <div className="grid gap-6 md:grid-cols-2">
        <Field label="Name" value={name} onChange={setName} required />
        <Field label="Code" value={code} onChange={setCode} required />
        <Field label="GSTIN" value={gstin} onChange={setGstin} />
        <Field label="Excise / VAT rate" value={dutyRate} onChange={setDutyRate} type="number" step="0.01" min="0" />
        <Field
          label="Default low-stock threshold"
          value={threshold}
          onChange={setThreshold}
          type="number"
          min="0"
        />
        <ToggleField
          label="Vendor link for receiving"
          description="Require vendor, invoice, date, and invoice value on stock inward."
          checked={receivingVendorLinkEnabled}
          onChange={setReceivingVendorLinkEnabled}
        />
      </div>
      <button
        type="submit"
        disabled={busy}
        className="flex h-11 w-fit items-center justify-center gap-2 rounded-xl bg-action px-8 text-sm font-bold tracking-wide text-white shadow-sm transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[var(--color-action)]/30 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50"
      >
        <Save className="h-4 w-4" /> {busy ? "Saving..." : "Save shop"}
      </button>
    </form>
  );
}

function UserPanel({
  shopId,
  users,
  roleFilter,
  statusFilter,
  onRoleFilter,
  onStatusFilter,
  onChanged,
  onError,
}: {
  shopId: number;
  users: ShopUser[];
  roleFilter: RoleFilter;
  statusFilter: StatusFilter;
  onRoleFilter: (value: RoleFilter) => void;
  onStatusFilter: (value: StatusFilter) => void;
  onChanged: () => void;
  onError: (message: string | null) => void;
}) {
  const [role, setRole] = useState<ShopUserRole>("owner");
  const [username, setUsername] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [resetUser, setResetUser] = useState<ShopUser | null>(null);
  const [resetDraftPassword, setResetDraftPassword] = useState("");
  const [resetBusy, setResetBusy] = useState(false);
  const [resetValidationError, setResetValidationError] = useState<string | null>(null);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    onError(null);
    try {
      await createShopUser(shopId, {
        role,
        username: username.trim() || undefined,
        full_name: fullName.trim(),
        phone: phone.trim(),
        password,
      });
      setUsername("");
      setFullName("");
      setPhone("");
      setPassword("");
      onChanged();
    } catch (err) {
      onError(toUserMessage(err, "Create user failed."));
    } finally {
      setBusy(false);
    }
  };

  const closeResetDialog = () => {
    if (resetBusy) return;
    setResetUser(null);
    setResetDraftPassword("");
    setResetValidationError(null);
  };

  const openResetDialog = (user: ShopUser) => {
    setResetUser(user);
    setResetDraftPassword("");
    setResetValidationError(null);
  };

  const resetPassword = async () => {
    if (!resetUser) return;
    if (resetDraftPassword.length < 4) {
      setResetValidationError("Password/PIN must be at least 4 characters.");
      return;
    }
    setResetBusy(true);
    setResetValidationError(null);
    try {
      await resetShopUserPassword(shopId, resetUser.id, resetDraftPassword);
      setResetUser(null);
      setResetDraftPassword("");
      setResetValidationError(null);
      onChanged();
    } catch (err) {
      onError(toUserMessage(err, "Password reset failed."));
    } finally {
      setResetBusy(false);
    }
  };

  const toggleActive = async (user: ShopUser) => {
    try {
      await setShopUserActive(shopId, user.id, !user.is_active);
      onChanged();
    } catch (err) {
      onError(toUserMessage(err, "Status update failed."));
    }
  };

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-slate-900">
          <Users className="h-5 w-5 text-action" /> Allotted users
        </h2>
        <div className="flex flex-wrap gap-4">
          <SelectFilter label="Role" value={roleFilter} options={ROLE_FILTERS} onChange={onRoleFilter} />
          <SelectFilter label="Status" value={statusFilter} options={STATUS_FILTERS} onChange={onStatusFilter} />
        </div>
      </div>
      <form onSubmit={create} className="grid items-end gap-4 rounded-2xl bg-slate-50 p-6 ring-1 ring-slate-200/50 md:grid-cols-[1fr_1fr_1fr_auto]">
        <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
          Role
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as ShopUserRole)}
            className="h-11 w-full rounded-xl border border-slate-200 bg-white/50 px-4 text-sm font-medium text-slate-700 shadow-sm outline-none transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:bg-white focus:border-action focus:ring-1 focus:ring-action"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {formatRole(r)}
              </option>
            ))}
          </select>
        </label>
        <Field
          label="Username"
          value={username}
          onChange={setUsername}
          placeholder="Leave blank to auto-generate"
        />
        <Field label="Full name" value={fullName} onChange={setFullName} required />
        <Field label="Phone" value={phone} onChange={setPhone} required />
        <Field label="Password/PIN" value={password} onChange={setPassword} required type="password" />
        <button
          type="submit"
          disabled={busy}
          className="flex h-11 items-center justify-center gap-2 rounded-xl bg-action px-6 text-sm font-bold tracking-wide text-white shadow-sm transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[var(--color-action)]/30 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50"
        >
          <Plus className="h-4 w-4" /> {busy ? "Adding..." : "Add user"}
        </button>
      </form>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <table className="app-list-table">
          <thead className="bg-slate-50/80 text-[11px] uppercase tracking-widest text-slate-500">
            <tr>
              <th className="px-6 py-4 font-semibold">Name</th>
              <th className="px-6 py-4 font-semibold">Role</th>
              <th className="px-6 py-4 font-semibold">Username</th>
              <th className="px-6 py-4 font-semibold">Phone</th>
              <th className="px-6 py-4 font-semibold">Status</th>
              <th className="px-6 py-4 text-right font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {users.map((user) => (
              <tr key={user.id} className="transition-colors hover:bg-slate-50/50">
                <td className="px-6 py-4 font-medium text-slate-900">{user.full_name}</td>
                <td className="px-6 py-4">{formatRole(user.role)}</td>
                <td className="px-6 py-4 font-mono text-slate-500">{user.username}</td>
                <td className="px-6 py-4 font-mono text-slate-500">{user.phone}</td>
                <td className="px-6 py-4">
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                    user.is_active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"
                  }`}>
                    {user.is_active ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="px-6 py-4 text-right">
                  <div className="flex justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => openResetDialog(user)}
                      className="text-sm font-semibold text-action underline decoration-transparent underline-offset-4 transition-colors hover:decoration-current"
                    >
                      Reset password
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleActive(user)}
                      className={`text-sm font-semibold transition-colors ${
                        user.is_active ? "text-red-500 hover:text-red-700" : "text-emerald-500 hover:text-emerald-700"
                      }`}
                    >
                      {user.is_active ? "Deactivate" : "Activate"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td className="px-6 py-8 text-center text-slate-500" colSpan={6}>
                  No users match the current filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {resetUser && (
        <ModalDialog labelledBy="shop-user-reset-password-title" onDismiss={closeResetDialog}>
          <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200/70">
            <div className="border-b border-slate-200/70 bg-slate-50/80 px-6 py-5">
              <h3
                id="shop-user-reset-password-title"
                className="text-xl font-semibold tracking-tight text-slate-900"
              >
                Reset password
              </h3>
            </div>
            <div className="flex flex-col gap-5 px-6 py-6">
              <p className="text-sm text-slate-600">
                Set a new password/PIN for{" "}
                <span className="font-semibold text-slate-900">
                  {resetUser.full_name} ({resetUser.username})
                </span>
                .
              </p>
              <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
                New password/PIN
                <input
                  type="password"
                  value={resetDraftPassword}
                  onChange={(e) => {
                    setResetDraftPassword(e.target.value);
                    if (resetValidationError) setResetValidationError(null);
                  }}
                  autoFocus
                  className="h-11 w-full rounded-xl border border-slate-200 bg-white/50 px-4 text-sm font-medium normal-case text-slate-700 shadow-sm outline-none transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:bg-white focus:border-action focus:ring-1 focus:ring-action"
                />
              </label>
              {resetValidationError && (
                <div role="alert" className="text-sm font-medium text-red-600">
                  {resetValidationError}
                </div>
              )}
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={closeResetDialog}
                  disabled={resetBusy}
                  className="rounded-xl bg-slate-100 px-5 py-2.5 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-200 disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void resetPassword()}
                  disabled={resetBusy}
                  className="rounded-xl bg-action px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:shadow-[var(--color-action)]/30 disabled:opacity-50"
                >
                  {resetBusy ? "Resetting..." : "Reset password"}
                </button>
              </div>
            </div>
          </div>
        </ModalDialog>
      )}
    </section>
  );
}

function InventoryPanel({
  products,
  query,
  includeInactive,
  onQuery,
  onIncludeInactive,
  onOpenProducts,
}: {
  products: Product[];
  query: string;
  includeInactive: boolean;
  onQuery: (value: string) => void;
  onIncludeInactive: (value: boolean) => void;
  onOpenProducts: () => void;
}) {
  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-slate-900">
          <Package className="h-5 w-5 text-action" /> Quick inventory check
        </h2>
        <button
          type="button"
          onClick={onOpenProducts}
          className="flex h-10 items-center justify-center rounded-xl bg-action px-6 text-sm font-semibold tracking-wide text-white shadow-sm transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[var(--color-action)]/30 active:scale-[0.97]"
        >
          Open in Products
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <input
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search brand, barcode, or size"
          className="h-11 flex-1 rounded-xl border border-slate-200 bg-white/50 px-4 text-sm font-medium text-slate-700 shadow-sm outline-none transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:bg-white focus:border-action focus:ring-1 focus:ring-action"
        />
        <label className="flex items-center gap-2 text-sm font-medium text-slate-600">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => onIncludeInactive(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-action focus:ring-action"
          />
          Include inactive
        </label>
      </div>
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <table className="app-list-table">
          <thead className="bg-slate-50/80 text-[11px] uppercase tracking-widest text-slate-500">
            <tr>
              <th className="px-6 py-4 font-semibold">Brand</th>
              <th className="px-6 py-4 font-semibold">Size</th>
              <th className="px-6 py-4 font-semibold">Barcode</th>
              <th className="px-6 py-4 text-right font-semibold">Price</th>
              <th className="px-6 py-4 font-semibold">Status</th>
              <th className="px-6 py-4 text-right font-semibold">Current stock</th>
              <th className="px-6 py-4 text-right font-semibold">Low-stock</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {products.map((product) => (
              <tr key={product.id} className="transition-colors hover:bg-slate-50/50">
                <td className="px-6 py-4 font-medium text-slate-900">{product.brand}</td>
                <td className="px-6 py-4 text-slate-500">{product.size_label}</td>
                <td className="px-6 py-4 font-mono text-slate-500">{product.barcode}</td>
                <td className="px-6 py-4 text-right font-mono font-medium text-slate-900">
                  {product.price == null ? "-" : `Rs ${product.price}`}
                </td>
                <td className="px-6 py-4">
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                    product.is_active ? (product.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700") : "bg-slate-100 text-slate-600"
                  }`}>
                    {product.status} {!product.is_active && "(inactive)"}
                  </span>
                </td>
                <td className="px-6 py-4 text-right font-mono font-medium text-slate-900">{product.current_stock}</td>
                <td className="px-6 py-4 text-right font-mono text-slate-500">
                  {product.low_stock_threshold ?? "-"}
                </td>
              </tr>
            ))}
            {products.length === 0 && (
              <tr>
                <td className="px-6 py-8 text-center text-slate-500" colSpan={7}>
                  No products match the current filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ToggleField({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex flex-col gap-2 rounded-2xl border border-slate-200/60 bg-white/70 p-4 text-slate-700 shadow-sm">
      <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</span>
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="mt-1 h-4 w-4 rounded border-slate-300 text-action focus:ring-action"
        />
        <span className="text-sm text-slate-600">{description}</span>
      </div>
    </label>
  );
}

function SelectFilter<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="h-9 min-w-[120px] rounded-lg border border-slate-200 bg-white/50 px-3 text-sm font-medium normal-case text-slate-700 shadow-sm outline-none transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:bg-white focus:border-action focus:ring-1 focus:ring-action"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option === "all" ? "All" : formatRole(option)}
          </option>
        ))}
      </select>
    </label>
  );
}

function formatRole(value: string): string {
  if (value === "owner") return "Owner";
  if (value === "cashier_user") return "Cashier";
  if (value === "receiver_user") return "Receiver";
  if (value === "active") return "Active";
  if (value === "inactive") return "Inactive";
  return value;
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  required = false,
  step,
  min,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  step?: string;
  min?: string;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
      {label}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        step={step}
        min={min}
        placeholder={placeholder}
        className="h-11 w-full rounded-xl border border-slate-200 bg-white/50 px-4 text-sm font-medium normal-case text-slate-700 shadow-sm outline-none transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:bg-white focus:border-action focus:ring-1 focus:ring-action"
      />
    </label>
  );
}
