import { Link } from "react-router-dom";
import { AuthShell } from "../components/AuthShell";

type RoleCard = {
  title: string;
  purpose: string;
  loginName: string;
  pinLabel: string;
  destination: string;
  access: string[];
  accentClassName: string;
};

const ROLE_CARDS: RoleCard[] = [
  {
    title: "Cashier",
    purpose: "Used for billing and sales.",
    loginName: "cashier1",
    pinLabel: "PIN",
    destination: "Checkout",
    access: ["Checkout", "Invoices", "Inventory"],
    accentClassName: "border-cyan-300/30 bg-cyan-300/10 text-cyan-50",
  },
  {
    title: "Stock Keeper",
    purpose: "Used for stock inward and receiving.",
    loginName: "receiver1",
    pinLabel: "PIN",
    destination: "Stock Inward",
    access: ["Stock Inward", "Inventory"],
    accentClassName: "border-emerald-300/30 bg-emerald-300/10 text-emerald-50",
  },
];

const SIGN_IN_STEPS = [
  "Select your role first.",
  "Enter your username or terminal ID.",
  "Enter your PIN carefully.",
  "Tap the login button.",
];

const COMMON_PROBLEMS = [
  {
    title: "Invalid username, role, or PIN",
    body: "Recheck the role, username, and PIN. Even one wrong character can stop login.",
  },
  {
    title: "Wrong role selected",
    body: "If you are a Cashier but selected Stock Keeper, login can fail or open the wrong page.",
  },
  {
    title: "Network or backend not reachable",
    body: "If you see a network error, check internet or local network first. Then try again after a short wait.",
  },
  {
    title: "Permission denied or forbidden page",
    body: "Your role may not be allowed on that page. Go back and use the page allowed for your role.",
  },
  {
    title: "Device or terminal message",
    body: "If you see a device or terminal error, use the normal shop device or ask the owner/admin to check the terminal setup.",
  },
];

const SUPPORT_STEPS = [
  "Check the role again.",
  "Type the username again slowly.",
  "Type the PIN again slowly.",
  "Check internet or local network.",
  "Ask the shop owner or admin if you are still blocked.",
];

function MockLoginScreenshot() {
  return (
    <article className="auth-help-shot">
      <div className="auth-help-shot__header">
        <span>1. Login screen</span>
        <span>Role selector highlighted</span>
      </div>
      <div className="auth-help-shot__body">
        <div className="auth-help-shot__callout auth-help-shot__callout--top-left">1. Choose role</div>
        <div className="auth-help-shot__panel">
          <div className="auth-help-shot__chip-row">
            <span className="auth-help-shot__chip auth-help-shot__chip--active">Cashier</span>
            <span className="auth-help-shot__chip">Stock Keeper</span>
            <span className="auth-help-shot__chip">Shop Owner</span>
          </div>
          <div className="auth-help-shot__field">Terminal ID / Username</div>
          <div className="auth-help-shot__field">Security PIN</div>
          <div className="auth-help-shot__button">Open Terminal</div>
        </div>
        <div className="auth-help-shot__callout auth-help-shot__callout--bottom-right">2. Enter username and PIN</div>
      </div>
      <p className="auth-help-shot__caption">Pick the correct role before entering login details.</p>
    </article>
  );
}

function MockCashierScreenshot() {
  return (
    <article className="auth-help-shot">
      <div className="auth-help-shot__header">
        <span>2. Cashier success</span>
        <span>Checkout opens</span>
      </div>
      <div className="auth-help-shot__body">
        <div className="auth-help-shot__callout auth-help-shot__callout--top-left">Cashier lands here</div>
        <div className="auth-help-shot__panel">
          <div className="auth-help-shot__windowbar">
            <span>Checkout</span>
            <span>Ready</span>
          </div>
          <div className="auth-help-shot__grid">
            <div className="auth-help-shot__tile auth-help-shot__tile--wide">Scan item</div>
            <div className="auth-help-shot__tile">Invoices</div>
            <div className="auth-help-shot__tile">Inventory</div>
          </div>
        </div>
        <div className="auth-help-shot__callout auth-help-shot__callout--bottom-right">Allowed pages shown</div>
      </div>
      <p className="auth-help-shot__caption">After Cashier login, start from Checkout.</p>
    </article>
  );
}

function MockReceivingScreenshot() {
  return (
    <article className="auth-help-shot">
      <div className="auth-help-shot__header">
        <span>3. Stock Keeper success</span>
        <span>Stock Inward opens</span>
      </div>
      <div className="auth-help-shot__body">
        <div className="auth-help-shot__callout auth-help-shot__callout--top-left">Stock Keeper lands here</div>
        <div className="auth-help-shot__panel">
          <div className="auth-help-shot__windowbar">
            <span>Stock Inward</span>
            <span>Ready</span>
          </div>
          <div className="auth-help-shot__grid">
            <div className="auth-help-shot__tile auth-help-shot__tile--wide">Receive stock</div>
            <div className="auth-help-shot__tile">Inventory</div>
          </div>
        </div>
        <div className="auth-help-shot__callout auth-help-shot__callout--bottom-right">Inventory is also allowed</div>
      </div>
      <p className="auth-help-shot__caption">After Stock Keeper login, start from Stock Inward.</p>
    </article>
  );
}

function MockErrorScreenshot() {
  return (
    <article className="auth-help-shot">
      <div className="auth-help-shot__header">
        <span>4. Login error</span>
        <span>Invalid details</span>
      </div>
      <div className="auth-help-shot__body">
        <div className="auth-help-shot__callout auth-help-shot__callout--top-left">Check role and PIN</div>
        <div className="auth-help-shot__panel">
          <div className="auth-help-shot__field">Terminal ID / Username</div>
          <div className="auth-help-shot__field">Security PIN</div>
          <div className="auth-help-shot__alert">Invalid username, role, or PIN.</div>
        </div>
        <div className="auth-help-shot__callout auth-help-shot__callout--bottom-right">Type details again</div>
      </div>
      <p className="auth-help-shot__caption">Wrong role, wrong username, or wrong PIN can show this.</p>
    </article>
  );
}

function MockNetworkScreenshot() {
  return (
    <article className="auth-help-shot">
      <div className="auth-help-shot__header">
        <span>5. Network problem</span>
        <span>Backend unreachable</span>
      </div>
      <div className="auth-help-shot__body">
        <div className="auth-help-shot__callout auth-help-shot__callout--top-left">Check internet</div>
        <div className="auth-help-shot__panel">
          <div className="auth-help-shot__field">Terminal ID / Username</div>
          <div className="auth-help-shot__field">Security PIN</div>
          <div className="auth-help-shot__alert auth-help-shot__alert--warning">
            Network error - is the backend reachable?
          </div>
        </div>
        <div className="auth-help-shot__callout auth-help-shot__callout--bottom-right">Try again after network returns</div>
      </div>
      <p className="auth-help-shot__caption">If the internet or backend is down, login cannot continue.</p>
    </article>
  );
}

function AccessMapCard() {
  return (
    <article className="auth-help-map">
      <div className="auth-help-map__header">
        <span>6. Access map</span>
        <span>Allowed screens by role</span>
      </div>
      <div className="auth-help-map__grid">
        {ROLE_CARDS.map((role) => (
          <div key={role.title} className={`auth-help-map__card ${role.accentClassName}`}>
            <h3>{role.title}</h3>
            <p>{role.destination} opens first.</p>
            <ul>
              {role.access.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="auth-help-shot__caption">Some other pages may stay blocked based on your role.</p>
    </article>
  );
}

export function LoginHelpPage() {
  return (
    <AuthShell
      variant="shop"
      badge="LOGIN HELP"
      title="Login Help"
      subcopy="Use this page if you are trying to sign in to the shop system and something is not clear. This guide is for Cashier and Stock Keeper users."
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
            Use the same shop login page for both roles. Choose the correct role first, then enter username and PIN.
          </p>
        </div>

        <section className="auth-help-section">
          <div className="auth-help-section__heading">
            <span>Section 1</span>
            <h2>Choose your role</h2>
          </div>
          <div className="auth-help-role-grid">
            {ROLE_CARDS.map((role) => (
              <article key={role.title} className="auth-help-role-card">
                <h3>{role.title}</h3>
                <p>{role.purpose}</p>
                <div className="auth-help-role-card__meta">Landing page: {role.destination}</div>
              </article>
            ))}
          </div>
          <div className="auth-help-note">
            Choosing the wrong role can cause login failure or open a page you are not allowed to use.
          </div>
        </section>

        <section className="auth-help-section">
          <div className="auth-help-section__heading">
            <span>Section 2</span>
            <h2>How to sign in</h2>
          </div>
          <ol className="auth-help-list">
            {SIGN_IN_STEPS.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </section>

        <section className="auth-help-section">
          <div className="auth-help-section__heading">
            <span>Section 3</span>
            <h2>Where you go after login</h2>
          </div>
          <div className="auth-help-route-grid">
            {ROLE_CARDS.map((role) => (
              <article key={role.title} className="auth-help-route-card">
                <h3>{role.title}</h3>
                <p>{role.title === "Cashier" ? "Checkout opens after login." : "Stock Inward opens after login."}</p>
                <ul>
                  {role.access.map((page) => (
                    <li key={page}>{page}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
          <p className="auth-help-section__footnote">Other screens may be blocked based on your role.</p>
        </section>

        <section className="auth-help-section">
          <div className="auth-help-section__heading">
            <span>Section 4</span>
            <h2>Common problems and what to do</h2>
          </div>
          <div className="auth-help-problem-grid">
            {COMMON_PROBLEMS.map((problem) => (
              <article key={problem.title} className="auth-help-problem-card">
                <h3>{problem.title}</h3>
                <p>{problem.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="auth-help-section">
          <div className="auth-help-section__heading">
            <span>Section 5</span>
            <h2>Before asking for support</h2>
          </div>
          <ol className="auth-help-list">
            {SUPPORT_STEPS.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </section>

        <section className="auth-help-section">
          <div className="auth-help-section__heading">
            <span>Visual Guide</span>
            <h2>See the screens</h2>
          </div>
          <div className="auth-help-shot-grid">
            <MockLoginScreenshot />
            <MockCashierScreenshot />
            <MockReceivingScreenshot />
            <MockErrorScreenshot />
            <MockNetworkScreenshot />
            <AccessMapCard />
          </div>
        </section>

        <section className="auth-help-section">
          <div className="auth-help-section__heading">
            <span>Section 6</span>
            <h2>Need to go back?</h2>
          </div>
          <p className="auth-help-section__footnote">Use the button below to return to the normal shop login page.</p>
          <Link to="/login" className="auth-terminal-submit auth-help-page__primary-link">
            Back to shop login
          </Link>
        </section>
      </div>
    </AuthShell>
  );
}
