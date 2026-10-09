import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

export function ProtectedRoute() {
  const { user, loading, waking } = useAuth();

  if (loading || waking) {
    return (
      <div className="page-pad">
        <p className="muted">
          {waking
            ? "Waking up the free server — this can take up to a minute…"
            : "Loading…"}
        </p>
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}
