import { Link } from "react-router-dom";
import { AuthShell } from "../components/AuthShell";

const CHECKOUT_STEPS = [
  "Scan the barcode or type the barcode, then tap ADD.",
  "Check that the item appears in the cart.",
  "Use + or - to change quantity, or remove the line if it is wrong.",
  "Check the total and enter payment amounts.",
  "Make sure payment sum matches the total.",
  "Tap Finish & Pay to complete the sale.",
];

const CHECKOUT_PROBLEMS = [
  {
    title: "Barcode not found",
    body: "Check the barcode and scan again. If it is a new item, ask the owner or use quick-add if your shop allows it.",
  },
  {
    title: "Pending or no-price product",
    body: "This item is not ready for sale yet. The owner must set a price and receive stock first.",
  },
  {
    title: "Network issue",
    body: "If the network is down, normal finalizing can fail. Check internet or local network first.",
  },
  {
    title: "Offline finalizing limit",
    body: "Offline sales work only after Work offline was started while the system was online.",
  },
  {
    title: "Payment sum mismatch",
    body: "The payment total must exactly match the cart total before checkout can finish.",
  },
];

function MockBarcodeShot() {
  return (
    <article className="auth-help-shot">
      <div className="auth-help-shot__header">
        <span>1. Start scan</span>
        <span>Barcode entry</span>
      </div>
      <div className="auth-help-shot__body">
        <div className="auth-help-shot__callout auth-help-shot__callout--top-left">Scan here first</div>
        <div className="auth-help-shot__panel">
          <div className="auth-help-shot__windowbar">
            <span>Checkout</span>
            <span>Catalog cached</span>
          </div>
          <div className="auth-help-shot__field">Scan or enter barcode</div>
          <div className="auth-help-shot__button">ADD</div>
        </div>
        <div className="auth-help-shot__callout auth-help-shot__callout--bottom-right">Tap ADD after typing</div>
      </div>
      <p className="auth-help-shot__caption">Use the scanner first. Manual barcode typing also works.</p>
    </article>
  );
}

function MockCartShot() {
  return (
    <article className="auth-help-shot">
      <div className="auth-help-shot__header">
        <span>2. Item added</span>
        <span>Cart line</span>
      </div>
      <div className="auth-help-shot__body">
        <div className="auth-help-shot__callout auth-help-shot__callout--top-left">Item enters cart</div>
        <div className="auth-help-shot__panel">
          <div className="auth-help-shot__windowbar">
            <span>Cart</span>
            <span>1 line</span>
          </div>
          <div className="auth-help-shot__grid">
            <div className="auth-help-shot__tile auth-help-shot__tile--wide">Royal Stag 750ml</div>
            <div className="auth-help-shot__tile">8901234567890</div>
            <div className="auth-help-shot__tile">In stock: 9</div>
          </div>
        </div>
        <div className="auth-help-shot__callout auth-help-shot__callout--bottom-right">Check brand and size</div>
      </div>
      <p className="auth-help-shot__caption">After a successful scan, confirm the product details before taking payment.</p>
    </article>
  );
}

function MockQtyShot() {
  return (
    <article className="auth-help-shot">
      <div className="auth-help-shot__header">
        <span>3. Change quantity</span>
        <span>Line controls</span>
      </div>
      <div className="auth-help-shot__body">
        <div className="auth-help-shot__callout auth-help-shot__callout--top-left">Use + or -</div>
        <div className="auth-help-shot__panel">
          <div className="auth-help-shot__windowbar">
            <span>Royal Stag 750ml</span>
            <span>Qty 2</span>
          </div>
          <div className="auth-help-shot__stepper-row">
            <span className="auth-help-shot__stepper-button">-</span>
            <span className="auth-help-shot__stepper-value">2</span>
            <span className="auth-help-shot__stepper-button">+</span>
          </div>
          <div className="auth-help-shot__alert">Only 2 available; reduce quantity or remove this item.</div>
        </div>
        <div className="auth-help-shot__callout auth-help-shot__callout--bottom-right">Red or yellow note means check stock</div>
      </div>
      <p className="auth-help-shot__caption">If quantity is wrong, change it here. Remove the line if the item should not be sold.</p>
    </article>
  );
}

function MockPaymentShot() {
  return (
    <article className="auth-help-shot">
      <div className="auth-help-shot__header">
        <span>4. Take payment</span>
        <span>Payment area</span>
      </div>
      <div className="auth-help-shot__body">
        <div className="auth-help-shot__callout auth-help-shot__callout--top-left">Total first</div>
        <div className="auth-help-shot__panel">
          <div className="auth-help-shot__money-card">Total Payable: Rs 200.00</div>
          <div className="auth-help-shot__field">Payment mode: Cash</div>
          <div className="auth-help-shot__field">Payment amount: 200.00</div>
          <div className="auth-help-shot__chip auth-help-shot__chip--active">Payments sum matches</div>
        </div>
        <div className="auth-help-shot__callout auth-help-shot__callout--bottom-right">Sum must match total</div>
      </div>
      <p className="auth-help-shot__caption">Do not finish checkout until the payment sum and total are the same.</p>
    </article>
  );
}

function MockFinishShot() {
  return (
    <article className="auth-help-shot">
      <div className="auth-help-shot__header">
        <span>5. Finish sale</span>
        <span>Final action</span>
      </div>
      <div className="auth-help-shot__body">
        <div className="auth-help-shot__callout auth-help-shot__callout--top-left">Tap this last</div>
        <div className="auth-help-shot__panel">
          <div className="auth-help-shot__button">Finish &amp; Pay</div>
          <div className="auth-help-shot__field">Invoice preview opens after success</div>
        </div>
        <div className="auth-help-shot__callout auth-help-shot__callout--bottom-right">Wait for success message</div>
      </div>
      <p className="auth-help-shot__caption">When the sale completes, the invoice opens and the cart clears.</p>
    </article>
  );
}

function MockOfflineShot() {
  return (
    <article className="auth-help-shot">
      <div className="auth-help-shot__header">
        <span>6. Work offline</span>
        <span>Offline mode</span>
      </div>
      <div className="auth-help-shot__body">
        <div className="auth-help-shot__callout auth-help-shot__callout--top-left">Start while online</div>
        <div className="auth-help-shot__panel">
          <div className="auth-help-shot__link-row">
            <span className="auth-help-shot__text-link">Work offline</span>
            <span className="auth-help-shot__text-link">Help</span>
          </div>
          <div className="auth-help-shot__alert auth-help-shot__alert--warning">
            Offline sales still require an active Work offline session started while online.
          </div>
        </div>
        <div className="auth-help-shot__callout auth-help-shot__callout--bottom-right">Sync later for official invoice numbers</div>
      </div>
      <p className="auth-help-shot__caption">Use Work offline only when you expect a network problem and the system is still online.</p>
    </article>
  );
}

export function CheckoutHelpPage() {
  return (
    <AuthShell
      variant="shop"
      badge="CHECKOUT HELP"
      title="Checkout Help"
      subcopy="Simple steps for scanning items, collecting payment, finishing the sale, and using Work offline correctly."
      contentWidthClassName="max-w-[60rem]"
      headerLink={{ label: "Back to Shop Login", to: "/login" }}
      footerLink={{ label: "Back to Shop Login", to: "/login" }}
    >
      <div className="auth-help-page">
        <div className="auth-help-page__intro">
          <Link to="/login" className="auth-terminal-submit auth-help-page__primary-link">
            Back to shop login
          </Link>
          <p>
            This page shows the normal Checkout flow for cashiers. Follow the steps in order and use the notes below when something blocks the sale.
          </p>
        </div>

        <section className="auth-help-section">
          <div className="auth-help-section__heading">
            <span>Section 1</span>
            <h2>How Checkout works</h2>
          </div>
          <ol className="auth-help-list">
            {CHECKOUT_STEPS.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </section>

        <section className="auth-help-section">
          <div className="auth-help-section__heading">
            <span>Section 2</span>
            <h2>Using Work offline</h2>
          </div>
          <div className="auth-help-note">
            Start <strong>Work offline</strong> only while the shop is still online. This saves the offline session first, so temporary receipts can be synced later.
          </div>
          <ol className="auth-help-list">
            <li>Tap Work offline before the connection drops.</li>
            <li>Continue billing and save temporary receipts.</li>
            <li>When the network returns, use Resume Online to sync receipts.</li>
          </ol>
        </section>

        <section className="auth-help-section">
          <div className="auth-help-section__heading">
            <span>Section 3</span>
            <h2>Common problems and what to do</h2>
          </div>
          <div className="auth-help-problem-grid">
            {CHECKOUT_PROBLEMS.map((problem) => (
              <article key={problem.title} className="auth-help-problem-card">
                <h3>{problem.title}</h3>
                <p>{problem.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="auth-help-section">
          <div className="auth-help-section__heading">
            <span>Visual Guide</span>
            <h2>See the Checkout screens</h2>
          </div>
          <div className="auth-help-shot-grid">
            <MockBarcodeShot />
            <MockCartShot />
            <MockQtyShot />
            <MockPaymentShot />
            <MockFinishShot />
            <MockOfflineShot />
          </div>
        </section>
      </div>
    </AuthShell>
  );
}
