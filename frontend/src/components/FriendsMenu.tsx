import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiError } from "../api/client";
import type { Friend } from "../api/types";

export function FriendsMenu() {
  const [open, setOpen] = useState(false);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  async function loadFriends() {
    setLoading(true);
    setError(null);
    try {
      setFriends(await api.listFriends());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load friends");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) void loadFriends();
  }, [open]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.addFriend({ email: email.trim() });
      setEmail("");
      await loadFriends();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add friend");
    }
  }

  async function onRemove(friendUserId: string) {
    setError(null);
    try {
      await api.removeFriend(friendUserId);
      setFriends((prev) => prev.filter((f) => f.userId !== friendUserId));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not remove friend");
    }
  }

  return (
    <div className="friends-menu" ref={rootRef}>
      <button
        type="button"
        className="btn btn-ghost friends-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        Friends ▾
      </button>
      {open && (
        <div className="friends-dropdown" role="menu">
          <p className="friends-title">Your friends</p>
          {loading ? (
            <p className="muted">Loading…</p>
          ) : friends.length === 0 ? (
            <p className="muted">No friends yet. Add someone by email.</p>
          ) : (
            <ul className="friends-list">
              {friends.map((f) => (
                <li key={f.userId}>
                  <div>
                    <strong>{f.displayName}</strong>
                    <div className="muted small">{f.email}</div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost danger"
                    onClick={() => void onRemove(f.userId)}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form className="friends-add" onSubmit={onAdd}>
            <input
              type="email"
              placeholder="friend@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <button className="btn btn-secondary" type="submit">
              Add
            </button>
          </form>
          {error && <p className="error-banner tight">{error}</p>}
        </div>
      )}
    </div>
  );
}
