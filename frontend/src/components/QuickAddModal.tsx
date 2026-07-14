// QuickAddModal \u2014 the shared modal UI for both receiving and checkout
// (architecture review Candidate A, 2026-07-08). The two pages used
// to maintain their own copy of this JSX with the same three fields
// (barcode, brand, size), the same buttons, the same error styling.
// See useQuickAdd for the shared state and submission logic.
//
// The modal is dumb: it renders the form, fires onSubmit with the
// brand+size values, and lets the parent hook own the busy/error
// state. That keeps the modal stateless and trivially testable.

interface QuickAddModalProps {
  barcode: string;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (values: { brand: string; size: string }) => void;
}

export function QuickAddModal({
  barcode,
  busy,
  error,
  onCancel,
  onSubmit,
}: QuickAddModalProps) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const brand = (
          form.elements.namedItem("brand") as HTMLInputElement
        ).value;
        const size = (
          form.elements.namedItem("size") as HTMLInputElement
        ).value;
        onSubmit({ brand, size });
      }}
      className="animate-modal-in flex w-full max-w-md flex-col gap-6 rounded-xl bg-white p-8 shadow-[0_20px_60px_rgba(0,0,0,0.1)] ring-1 ring-slate-200/50"
    >
      <header className="flex items-start justify-between gap-4">
        <div>
          <h2 id="quick-add-title" className="text-xl font-semibold tracking-tight text-slate-900">
            Register new catalog item
          </h2>
          <p className="mt-2 text-sm text-slate-500">
            No catalog item matches this barcode. Add a pending product request now; the owner can set the price later. It can be received into stock, but cannot be sold until priced.
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition-colors hover:bg-slate-200 hover:text-slate-900"
          aria-label="Cancel quick-add"
        >
          &times;
        </button>
      </header>

      <div className="flex flex-col gap-1 rounded-xl bg-slate-50 p-4">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Barcode</span>
        <div className="font-mono text-sm text-slate-900">{barcode}</div>
      </div>

      <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
        Brand
        <input
          name="brand"
          type="text"
          placeholder="e.g. Royal Stag"
          maxLength={200}
          autoFocus
          className="h-11 w-full rounded-xl border border-slate-200 bg-white/50 px-4 text-sm font-medium normal-case text-slate-700 shadow-sm outline-none transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:bg-white focus:border-action focus:ring-1 focus:ring-action"
        />
      </label>

      <label className="flex flex-col gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
        Size
        <input
          name="size"
          type="text"
          placeholder="e.g. 750ml"
          maxLength={64}
          className="h-11 w-full rounded-xl border border-slate-200 bg-white/50 px-4 text-sm font-medium normal-case text-slate-700 shadow-sm outline-none transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:bg-white focus:border-action focus:ring-1 focus:ring-action"
        />
      </label>

      {error && (
        <div
          role="alert"
          className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-600 ring-1 ring-red-200"
        >
          {error}
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex h-11 items-center justify-center rounded-xl bg-white px-6 text-sm font-semibold tracking-wide text-slate-600 shadow-sm ring-1 ring-slate-200 transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:bg-slate-50 hover:text-slate-900 active:scale-[0.97] disabled:opacity-50"
          disabled={busy}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="flex h-11 items-center justify-center rounded-xl bg-action px-6 text-sm font-bold tracking-wide text-white shadow-sm transition-[transform,opacity,background-color,box-shadow] duration-200 ease-out hover:-translate-y-0.5 hover:shadow-[var(--color-action)]/30 active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50"
          disabled={busy}
        >
          {busy ? "Adding..." : "Add product"}
        </button>
      </div>
    </form>
  );
}
