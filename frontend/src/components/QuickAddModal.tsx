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
      className="flex w-full max-w-md flex-col gap-stack-gap rounded-lg bg-surface-container p-gutter"
    >
      <header className="flex items-start justify-between">
        <div>
          <h2 className="text-headline-md text-primary">Quick-add new product</h2>
          <p className="mt-1 text-label-md text-on-surface-variant">
            This barcode isn't in the catalog. Register it as
            <strong> pending</strong> &mdash; the owner will set the
            price later. The new product can't be sold until priced
            and stock-received.
          </p>
        </div>
        <button
          type="button"
          onClick={onCancel}
          className="h-12 w-12 rounded-md bg-error text-display-lg text-on-error"
          aria-label="Cancel quick-add"
        >
          &times;
        </button>
      </header>

      <div className="rounded-md bg-surface p-stack-gap text-label-md">
        <span className="text-on-surface-variant">Barcode</span>
        <div className="font-mono text-body-md">{barcode}</div>
      </div>

      <label className="flex flex-col gap-1 text-label-md">
        Brand
        <input
          name="brand"
          type="text"
          placeholder="e.g. Royal Stag"
          maxLength={200}
          autoFocus
          className="min-h-touchTarget-sm rounded-md border border-outline bg-surface px-stack-gap text-body-md"
        />
      </label>

      <label className="flex flex-col gap-1 text-label-md">
        Size
        <input
          name="size"
          type="text"
          placeholder="e.g. 750ml"
          maxLength={64}
          className="min-h-touchTarget-sm rounded-md border border-outline bg-surface px-stack-gap text-body-md"
        />
      </label>

      {error && (
        <div
          role="alert"
          className="rounded-md bg-error px-stack-gap py-3 text-on-error"
        >
          {error}
        </div>
      )}

      <div className="flex gap-stack-gap">
        <button
          type="button"
          onClick={onCancel}
          className="min-h-touchTarget flex-1 rounded-md bg-surface-container-high text-label-xl text-on-surface"
          disabled={busy}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="min-h-touchTarget flex-1 rounded-md bg-accent text-display-lg text-on-accent disabled:opacity-50"
          disabled={busy}
        >
          {busy ? "ADDING\u2026" : "ADD"}
        </button>
      </div>
    </form>
  );
}