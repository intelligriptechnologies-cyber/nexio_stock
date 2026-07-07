import { Navigate } from "react-router-dom";
import { useAuth, homePathFor } from "../auth/AuthProvider";

// `/` is a redirect to the role-appropriate home. If not authenticated,
// sends to /login.
export function HomeRedirect() {
  const { user, isReady } = useAuth();
  if (!isReady) return null;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={homePathFor(user.role)} replace />;
}