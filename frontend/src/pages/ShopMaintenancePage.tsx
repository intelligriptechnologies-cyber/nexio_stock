import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
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
    <div className="flex flex-col gap-stack-gap">
      <header className="flex flex-wrap items-center justify-between gap-stack-gap">
        <h1 className="text-headline-lg text-primary">Shop Management</h1>
        <button
          type="button"
          onClick={reload}
          className="min-h-touchTarget-sm rounded-md bg-surface-container-high px-stack-gap text-label-md"
        >
          Refresh
        </button>
      </header>

      {error && (
        <div role="alert" className="rounded-md bg-error px-stack-gap py-3 text-on-error">
          {error}
        </div>
      )}
      {message && (
        <div role="status" className="rounded-md bg-success px-stack-gap py-3 text-on-secondary">
          {message}
        </div>
      )}

      <div className="grid gap-stack-gap lg:grid-cols-[280px_1fr]">
        <aside className="flex flex-col gap-stack-gap rounded-lg bg-surface-container p-stack-gap">
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
          <div className="border-t border-outline pt-stack-gap">
            <h2 className="mb-2 text-headline-md text-primary">Shops</h2>
            <div className="flex max-h-[calc(100vh-24rem)] min-h-32 flex-col gap-2 overflow-y-auto pr-1">
              {shops.map((shop) => (
                <button
                  key={shop.id}
                  type="button"
                  onClick={() => selectShop(shop.id)}
                  className={`min-h-touchTarget rounded-md border px-stack-gap py-3 text-left transition ${
                    shop.id === selectedShopId
                      ? "border-primary bg-primary text-on-primary shadow-sm"
                      : "border-outline bg-surface text-on-surface hover:border-primary hover:bg-surface-container-high"
                  }`}
                  aria-current={shop.id === selectedShopId ? "true" : undefined}
                >
                  <div className="text-body-md font-bold leading-tight">{shop.name}</div>
                  <div
                    className={`mt-1 font-mono text-label-md ${
                      shop.id === selectedShopId ? "text-on-primary" : "text-on-surface-variant"
                    }`}
                  >
                    {shop.code}
                  </div>
                </button>
              ))}
              {shops.length === 0 && (
                <div className="rounded-md bg-surface px-stack-gap py-4 text-label-md text-on-surface-variant">
                  No shops yet.
                </div>
              )}
            </div>
          </div>
        </aside>

        {selectedShop && shopDetails ? (
          <main className="flex min-w-0 flex-col rounded-lg bg-surface-container">
            <div className="border-b border-outline px-gutter pt-gutter">
              <div className="mb-3">
                <div className="text-label-md text-on-surface-variant">Selected shop</div>
                <h2 className="text-headline-md text-primary">{selectedShop.name}</h2>
              </div>
              <div className="flex flex-wrap gap-2" role="tablist" aria-label="Shop management tabs">
                {TABS.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={activeTab === tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`min-h-touchTarget-sm rounded-t-md border border-b-0 px-stack-gap text-label-md transition ${
                      activeTab === tab.id
                        ? "border-primary bg-action text-on-action"
                        : "border-outline bg-surface text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="max-h-[calc(100vh-14rem)] overflow-y-auto p-gutter">
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
          <div className="rounded-md bg-surface-container p-gutter text-on-surface-variant">
            Create or select a shop to manage its details.
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
    <form onSubmit={submit} className="flex flex-col gap-2">
      <h2 className="text-headline-md text-primary">New shop</h2>
      <Field label="Name" value={name} onChange={setName} required />
      <Field label="Code" value={code} onChange={setCode} required />
      <button
        type="submit"
        disabled={busy}
        className="min-h-touchTarget-sm rounded-md bg-action px-stack-gap text-label-md text-on-action disabled:opacity-50"
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
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setName(shop.name);
    setCode(fallbackSummary.code);
    setThreshold(shop.low_stock_threshold_default == null ? "" : String(shop.low_stock_threshold_default));
    setGstin(shop.gstin ?? "");
    setDutyRate(shop.excise_duty_rate ?? "");
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
      });
      await onSaved();
    } catch (err) {
      onError(toUserMessage(err, "Update shop failed."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-stack-gap">
      <h2 className="text-headline-md text-primary">Shop details</h2>
      <div className="grid gap-stack-gap md:grid-cols-2">
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
      </div>
      <button
        type="submit"
        disabled={busy}
        className="min-h-touchTarget-sm w-fit rounded-md bg-action px-stack-gap text-label-md text-on-action disabled:opacity-50"
      >
        {busy ? "Saving..." : "Save shop"}
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

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    onError(null);
    try {
      await createShopUser(shopId, {
        role,
        username: username.trim(),
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

  const resetPassword = async (user: ShopUser) => {
    const next = window.prompt(`New password/PIN for ${user.full_name}`);
    if (!next) return;
    try {
      await resetShopUserPassword(shopId, user.id, next);
      onChanged();
    } catch (err) {
      onError(toUserMessage(err, "Password reset failed."));
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
    <section className="flex flex-col gap-stack-gap">
      <div className="flex flex-wrap items-center justify-between gap-stack-gap">
        <h2 className="text-headline-md text-primary">Allotted users</h2>
        <div className="flex flex-wrap gap-stack-gap">
          <SelectFilter label="Role" value={roleFilter} options={ROLE_FILTERS} onChange={onRoleFilter} />
          <SelectFilter label="Status" value={statusFilter} options={STATUS_FILTERS} onChange={onStatusFilter} />
        </div>
      </div>
      <form onSubmit={create} className="grid gap-stack-gap md:grid-cols-3">
        <label className="flex flex-col gap-1 text-label-md">
          Role
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as ShopUserRole)}
            className="min-h-touchTarget-sm rounded-md border border-outline bg-surface px-stack-gap text-body-md"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {formatRole(r)}
              </option>
            ))}
          </select>
        </label>
        <Field label="Username" value={username} onChange={setUsername} required />
        <Field label="Full name" value={fullName} onChange={setFullName} required />
        <Field label="Phone" value={phone} onChange={setPhone} required />
        <Field label="Password/PIN" value={password} onChange={setPassword} required type="password" />
        <button
          type="submit"
          disabled={busy}
          className="min-h-touchTarget-sm self-end rounded-md bg-action px-stack-gap text-label-md text-on-action disabled:opacity-50"
        >
          {busy ? "Adding..." : "Add user"}
        </button>
      </form>

      <div className="max-h-[22rem] overflow-auto rounded-md bg-surface">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-outline text-label-md text-on-surface-variant">
              <th className="px-stack-gap py-2 text-left">Name</th>
              <th className="px-stack-gap py-2 text-left">Role</th>
              <th className="px-stack-gap py-2 text-left">Username</th>
              <th className="px-stack-gap py-2 text-left">Phone</th>
              <th className="px-stack-gap py-2 text-left">Status</th>
              <th className="px-stack-gap py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className="border-b border-outline/40">
                <td className="px-stack-gap py-2">{user.full_name}</td>
                <td className="px-stack-gap py-2">{formatRole(user.role)}</td>
                <td className="px-stack-gap py-2 font-mono">{user.username}</td>
                <td className="px-stack-gap py-2 font-mono">{user.phone}</td>
                <td className="px-stack-gap py-2">{user.is_active ? "Active" : "Inactive"}</td>
                <td className="px-stack-gap py-2 text-right">
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => resetPassword(user)}
                      className="rounded-md bg-surface-container-high px-stack-gap py-1 text-label-md"
                    >
                      Reset
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleActive(user)}
                      className="rounded-md bg-primary px-stack-gap py-1 text-label-md text-on-primary"
                    >
                      {user.is_active ? "Deactivate" : "Activate"}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td className="px-stack-gap py-4 text-on-surface-variant" colSpan={6}>
                  No users match the current filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
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
    <section className="flex flex-col gap-stack-gap">
      <div className="flex flex-wrap items-center justify-between gap-stack-gap">
        <h2 className="text-headline-md text-primary">Quick inventory check</h2>
        <button
          type="button"
          onClick={onOpenProducts}
          className="min-h-touchTarget-sm rounded-md bg-primary px-stack-gap text-label-md text-on-primary"
        >
          Open in Products
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-stack-gap">
        <input
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search brand, barcode, or size"
          className="min-h-touchTarget-sm flex-1 rounded-md border border-outline bg-surface px-stack-gap text-body-md"
        />
        <label className="flex items-center gap-2 text-label-md">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => onIncludeInactive(e.target.checked)}
          />
          Include inactive
        </label>
      </div>
      <div className="max-h-[24rem] overflow-auto rounded-md bg-surface">
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-outline text-label-md text-on-surface-variant">
              <th className="px-stack-gap py-2 text-left">Brand</th>
              <th className="px-stack-gap py-2 text-left">Size</th>
              <th className="px-stack-gap py-2 text-left">Barcode</th>
              <th className="px-stack-gap py-2 text-right">Price</th>
              <th className="px-stack-gap py-2 text-left">Status</th>
              <th className="px-stack-gap py-2 text-right">Current stock</th>
              <th className="px-stack-gap py-2 text-right">Low-stock</th>
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.id} className="border-b border-outline/40">
                <td className="px-stack-gap py-2">{product.brand}</td>
                <td className="px-stack-gap py-2">{product.size_label}</td>
                <td className="px-stack-gap py-2 font-mono text-label-md">{product.barcode}</td>
                <td className="px-stack-gap py-2 text-right font-mono">
                  {product.price == null ? "-" : `Rs ${product.price}`}
                </td>
                <td className="px-stack-gap py-2">
                  {product.status}
                  {!product.is_active ? " / inactive" : ""}
                </td>
                <td className="px-stack-gap py-2 text-right font-mono">{product.current_stock}</td>
                <td className="px-stack-gap py-2 text-right font-mono">
                  {product.low_stock_threshold ?? "-"}
                </td>
              </tr>
            ))}
            {products.length === 0 && (
              <tr>
                <td className="px-stack-gap py-4 text-on-surface-variant" colSpan={7}>
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
    <label className="flex items-center gap-2 text-label-md">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="min-h-touchTarget-sm rounded-md border border-outline bg-surface px-2 text-body-md"
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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  required?: boolean;
  step?: string;
  min?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-label-md">
      {label}
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        step={step}
        min={min}
        className="min-h-touchTarget-sm rounded-md border border-outline bg-surface px-stack-gap text-body-md"
      />
    </label>
  );
}
