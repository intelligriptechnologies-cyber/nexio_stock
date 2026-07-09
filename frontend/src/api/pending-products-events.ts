export const PENDING_PRODUCTS_CHANGED_EVENT = "nexio:pending-products-changed";

export function notifyPendingProductsChanged(): void {
  window.dispatchEvent(new Event(PENDING_PRODUCTS_CHANGED_EVENT));
}
