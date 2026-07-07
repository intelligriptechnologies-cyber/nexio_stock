import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthProvider";

export function ForbiddenPage() {
  const { user } = useAuth();
  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-surface p-stack-gap text-on-surface">
      <div className="rounded-lg bg-surface-container p-gutter text-center shadow">
        <h1 className="mb-stack-gap text-headline-lg text-error">403 — Not permitted</h1>
        <p className="mb-stack-gap text-body-md text-on-surface-variant">
          Your role
          {user ? <strong> ({user.role}) </strong> : " "}
          is not allowed to access that screen.
        </p>
        <p className="mb-stack-gap text-label-md text-on-surface-variant">
          If you reached this screen via a link, you don&apos;t have permission. The server
          will also reject this action if attempted directly — role enforcement is a server-side
          boundary.
        </p>
        <Link
          to="/"
          className="inline-block min-h-touch-target-sm rounded-md bg-primary px-gutter text-label-md leading-[48px] text-on-primary"
        >
          Go home
        </Link>
      </div>
    </div>
  );
}