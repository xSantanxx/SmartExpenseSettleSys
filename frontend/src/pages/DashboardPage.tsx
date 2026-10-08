import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../api/client";
import type { GroupSummary } from "../api/types";
import { useAuth } from "../auth/AuthContext";

export function DashboardPage() {
  const { user } = useAuth();
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setGroups(await api.listGroups());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load groups");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const group = await api.createGroup(name.trim());
      setName("");
      setGroups((prev) => [group, ...prev]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create group");
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Your groups</h1>
          <p className="muted">Hi {user?.displayName}. Pick a group or start a new one.</p>
        </div>
      </div>

      {error && <p className="error-banner">{error}</p>}

      <form className="inline-form" onSubmit={onCreate}>
        <input
          placeholder="Group name (e.g. NYC Trip)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <button className="btn btn-primary" type="submit">
          Create group
        </button>
      </form>

      {loading ? (
        <p className="muted">Loading groups…</p>
      ) : groups.length === 0 ? (
        <p className="empty">No groups yet. Create one to start tracking expenses.</p>
      ) : (
        <ul className="group-list">
          {groups.map((g) => (
            <li key={g.id}>
              <Link to={`/groups/${g.id}`} className="group-link">
                <span className="group-name">{g.name}</span>
                <span className="muted">
                  {g.memberCount} member{g.memberCount === 1 ? "" : "s"}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
