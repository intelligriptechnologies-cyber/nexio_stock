import { Link } from "react-router-dom";
import { AuthShell } from "../components/AuthShell";

const RECEIVING_STEPS = [
  "Scan the barcode or type the barcode, then tap ADD.",
  "Check that the item appears in the inward list.",
  "Use + or - to change quantity, or remove the line if needed.",
  "Tap Review & Submit when all lines are ready.",
  "Check vendor, invoice, and good-condition quantities.",
  "Tap Confirm save to submit the inward.",
];

const RECEIVING_PROBLEMS = [
  {
    title: "Barcode not found",
    body: "Check the barcode and scan again. If it is a new product, use quick-add if your shop allows it.",
  },
  {
    title: "Catalog loading issue",
    body: "If the catalog is still loading or failed to load, wait a moment or refresh the page.",
  },
  {
    title: "Missing vendor or save blocked",
    body: "If vendor linking is enabled, you must pick a vendor and enter invoice details before saving.",
  },
  {
    title: "Validation failure on review",
    body: "Check good-condition quantity, invoice value, purchase date, and notes for breakage before saving again.",
  },
];

function MockReceivingScanShot() {
  return (
    <article className="auth-help-shot">
      <div className="auth-help-shot__header">
        <span>1. Start scan</span>
        <span>Barcode entry</span>
      </div>
      <div className="auth-help-shot__body">
        <div className="auth-help-shot__callout auth-help-shot__callout--top-left">Scan or type barcode</div>
        <div className="auth-help-shot__panel">
          <div className="auth-help-shot__windowbar">
            <span>Stock Inward</span>
            <span>Catalog ready</span>
          </div>
          <div className="auth-help-shot__field">Scan or enter barcode</div>
          <div className="auth-help-shot__button">ADD</div>
        </div>
        <div className="auth-help-shot__callout auth-help-shot__callout--bottom-right">Tap ADD after typing</div>
      </div>
      <p className="auth-help-shot__caption">Start every inward line by scanning or typing the barcode.</p>
    </article>
  );
}

function MockReceivingListShot() {
  return (
    <article className="auth-help-shot">
      <div className="auth-help-shot__header">
        <span>2. Item added</span>
        <span>Inward list</span>
      </div>
      <div className="auth-help-shot__body">
        <div className="auth-help-shot__callout auth-help-shot__callout--top-left">Item enters list</div>
        <div className="auth-help-shot__panel">
          <div className="auth-help-shot__windowbar">
            <span>Lines</span>
            <span>1 item</span>
          </div>
          <div className="auth-help-shot__grid">
            <div className="auth-help-shot__tile auth-help-shot__tile--wide">Royal Stag 750ml</div>
            <div className="auth-help-shot__tile">8901234567890</div>
            <div className="auth-help-shot__tile">On shelf: 12</div>
          </div>
        </div>
        <div className="auth-help-shot__callout auth-help-shot__callout--bottom-right">Check item details</div>
      </div>
      <p className="auth-help-shot__caption">Confirm the barcode, product name, and shelf stock before continuing.</p>
    </article>
  );
}

function MockReceivingQtyShot() {
  return (
    <article className="auth-help-shot">
      <div className="auth-help-shot__header">
        <span>3. Change quantity</span>
        <span>Stepper</span>
      </div>
      <div className="auth-help-shot__body">
        <div className="auth-help-shot__callout auth-help-shot__callout--top-left">Adjust units</div>
        <div className="auth-help-shot__panel">
          <div className="auth-help-shot__stepper-row">
            <span className="auth-help-shot__stepper-button">-</span>
            <span className="auth-help-shot__stepper-value">4</span>
            <span className="auth-help-shot__stepper-button">+</span>
          </div>
          <div className="auth-help-shot__field">Remove line if scanned by mistake</div>
        </div>
        <div className="auth-help-shot__callout auth-help-shot__callout--bottom-right">Use the stepper or type a number</div>
      </div>
      <p className="auth-help-shot__caption">Change quantity before review so the inward line matches the real shipment.</p>
    </article>
  );
}

function MockReviewShot() {
  return (
    <article className="auth-help-shot">
      <div className="auth-help-shot__header">
        <span>4. Review inward</span>
        <span>Review modal</span>
      </div>
      <div className="auth-help-shot__body">
        <div className="auth-help-shot__callout auth-help-shot__callout--top-left">Check vendor and invoice</div>
        <div className="auth-help-shot__panel">
          <div className="auth-help-shot__field">Vendor</div>
          <div className="auth-help-shot__field">Vendor invoice number</div>
          <div className="auth-help-shot__field">Invoice value</div>
          <div className="auth-help-shot__field">Good-condition quantity</div>
        </div>
        <div className="auth-help-shot__callout auth-help-shot__callout--bottom-right">Validation runs here</div>
      </div>
      <p className="auth-help-shot__caption">The review step is where you catch invoice or quantity mistakes before saving.</p>
    </article>
  );
}

function MockConfirmShot() {
  return (
    <article className="auth-help-shot">
      <div className="auth-help-shot__header">
        <span>5. Save inward</span>
        <span>Confirm flow</span>
      </div>
      <div className="auth-help-shot__body">
        <div className="auth-help-shot__callout auth-help-shot__callout--top-left">Save after final check</div>
        <div className="auth-help-shot__panel">
          <div className="auth-help-shot__button">Confirm save</div>
          <div className="auth-help-shot__field">Inward submitted with 3 lines</div>
        </div>
        <div className="auth-help-shot__callout auth-help-shot__callout--bottom-right">Success message appears after save</div>
      </div>
      <p className="auth-help-shot__caption">After success, the inward is submitted and the list resets for the next lot.</p>
    </article>
  );
}

function MockQuickAddShot() {
  return (
    <article className="auth-help-shot">
      <div className="auth-help-shot__header">
        <span>6. Unknown barcode</span>
        <span>Quick-add</span>
      </div>
      <div className="auth-help-shot__body">
        <div className="auth-help-shot__callout auth-help-shot__callout--top-left">Use for new products</div>
        <div className="auth-help-shot__panel">
          <div className="auth-help-shot__alert auth-help-shot__alert--warning">Barcode not found in catalog.</div>
          <div className="auth-help-shot__field">Brand name</div>
          <div className="auth-help-shot__field">Size label</div>
          <div className="auth-help-shot__button">ADD</div>
        </div>
        <div className="auth-help-shot__callout auth-help-shot__callout--bottom-right">Creates a pending product for inward</div>
      </div>
      <p className="auth-help-shot__caption">Quick-add lets you register a new product without leaving Stock Inward.</p>
    </article>
  );
}

export function ReceivingHelpPage() {
  return (
    <AuthShell
      variant="shop"
      badge="STOCK INWARD HELP"
      title="Stock Inward Help"
      subcopy="Simple steps for receiving stock, reviewing invoice details, fixing quantity, and using quick-add for unknown barcodes."
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
            This page explains the normal Stock Inward flow for stock keepers. Scan items, review the inward carefully, and submit only after all details are correct.
          </p>
        </div>

        <section className="auth-help-section">
          <div className="auth-help-section__heading">
            <span>Section 1</span>
            <h2>How Stock Inward works</h2>
          </div>
          <ol className="auth-help-list">
            {RECEIVING_STEPS.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </section>

        <section className="auth-help-section">
          <div className="auth-help-section__heading">
            <span>Section 2</span>
            <h2>Using quick-add for unknown barcodes</h2>
          </div>
          <div className="auth-help-note">
            If a barcode is new, the quick-add form can create a pending product so you can continue the inward flow without leaving this page.
          </div>
          <ol className="auth-help-list">
            <li>Scan the missing barcode.</li>
            <li>Enter the brand and size in quick-add.</li>
            <li>Save it, then continue the inward with the new pending product.</li>
          </ol>
        </section>

        <section className="auth-help-section">
          <div className="auth-help-section__heading">
            <span>Section 3</span>
            <h2>Common problems and what to do</h2>
          </div>
          <div className="auth-help-problem-grid">
            {RECEIVING_PROBLEMS.map((problem) => (
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
            <h2>See the Stock Inward screens</h2>
          </div>
          <div className="auth-help-shot-grid">
            <MockReceivingScanShot />
            <MockReceivingListShot />
            <MockReceivingQtyShot />
            <MockReviewShot />
            <MockConfirmShot />
            <MockQuickAddShot />
          </div>
        </section>
      </div>
    </AuthShell>
  );
}
