import { Link, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { FriendsMenu } from "./FriendsMenu";

export function Layout() {
  const { user, logout } = useAuth();

  return (
    <div className="app-shell">
      <header className="topbar">
        <Link to="/" className="brand">
          Smart Expense Settlement
        </Link>
        {user && (
          <div className="topbar-right">
            <span className="muted">{user.displayName}</span>
            <FriendsMenu />
            <button type="button" className="btn btn-ghost" onClick={logout}>
              Log out
            </button>
          </div>
        )}
      </header>
      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
