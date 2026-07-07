// Placeholder screen for the cashier checkout flow (#11).
export function CheckoutPlaceholder() {
  return (
    <div className="rounded-lg bg-surface-container p-gutter shadow">
      <h1 className="mb-stack-gap text-headline-lg text-primary">Checkout</h1>
      <p className="text-body-md text-on-surface-variant">
        The barcode-scan → cart → finalize flow lands in issue #11. This placeholder is
        reachable by cashier_user and owner only.
      </p>
    </div>
  );
}