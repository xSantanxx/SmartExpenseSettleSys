import { useState } from "react";
import { Link, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { FriendsMenu } from "./FriendsMenu";

export function Layout() {
  const { user, logout } = useAuth();
  const [copied, setCopied] = useState(false);

  async function copyEmail() {
    if (!user?.email) return;
    try {
      await navigator.clipboard.writeText(user.email);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Fallback for older browsers / insecure contexts
      window.prompt("Copy your email:", user.email);
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <Link to="/" className="brand">
          Smart Expense Settlement
        </Link>
        {user && (
          <div className="topbar-right">
            <button
              type="button"
              className="profile-chip"
              title={user.email}
              aria-label={`Copy email ${user.email}`}
              onClick={() => void copyEmail()}
            >
              {copied ? "Email copied!" : user.displayName}
            </button>
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
