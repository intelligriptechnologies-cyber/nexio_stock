import { useLocation } from "react-router-dom";

// Placeholder for owner-only admin routes (#14, #15, #17, #18).
// The real screens for products, staff, shop config, and void approvals
// fill in via their own issues.
export function AdminPlaceholder() {
  const loc = useLocation();
  return (
    <div className="rounded-lg bg-surface-container p-gutter shadow">
      <h1 className="mb-stack-gap text-headline-lg text-primary">Admin</h1>
      <p className="text-body-md text-on-surface-variant">
        Owner-only admin section. Current path: <code>{loc.pathname}</code>. Per-screen
        implementations arrive with issues #14 (Products), #15 (Void Approvals), #17 (Staff),
        and #18 (Shop Config).
      </p>
    </div>
  );
}