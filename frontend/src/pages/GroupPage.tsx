import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../api/client";
import type {
  ExpenseDetail,
  Friend,
  GroupDetail,
  GroupSummaryPayload,
} from "../api/types";
import { useAuth } from "../auth/AuthContext";
import { SubscriptionsSection } from "../components/SubscriptionsSection";

interface FriendPrompt {
  userId: string;
  email: string;
  displayName: string;
}

export function GroupPage() {
  const { groupId = "" } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [expenses, setExpenses] = useState<ExpenseDetail[]>([]);
  const [summary, setSummary] = useState<GroupSummaryPayload | null>(null);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [selectedFriendId, setSelectedFriendId] = useState("");
  const [memberEmail, setMemberEmail] = useState("");
  const [friendPrompt, setFriendPrompt] = useState<FriendPrompt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expandedExpense, setExpandedExpense] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [g, ex, sum, fr] = await Promise.all([
        api.getGroup(groupId),
        api.listExpenses(groupId),
        api.getSummary(groupId),
        api.listFriends(),
      ]);
      setGroup(g);
      setExpenses(ex);
      setSummary(sum);
      setFriends(fr);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load group");
    }
  }, [groupId]);

  useEffect(() => {
    void load();
  }, [load]);

  const friendOptions = useMemo(() => {
    const memberIds = new Set(group?.members.map((m) => m.userId) ?? []);
    return friends.filter((f) => !memberIds.has(f.userId));
  }, [friends, group]);

  async function addMemberByEmail(
    email: string,
    opts: { fromFriendList: boolean }
  ) {
    setError(null);
    const updated = await api.addMember(groupId, email);
    setGroup(updated);
    setMemberEmail("");
    setSelectedFriendId("");

    const added = updated.members.find(
      (m) => m.email.toLowerCase() === email.trim().toLowerCase()
    );
    await load();

    if (!opts.fromFriendList && added) {
      const alreadyFriend = friends.some((f) => f.userId === added.userId);
      if (!alreadyFriend) {
        setFriendPrompt({
          userId: added.userId,
          email: added.email,
          displayName: added.displayName,
        });
      }
    }
  }

  async function onAddMember(e: FormEvent) {
    e.preventDefault();
    try {
      if (selectedFriendId) {
        const friend = friends.find((f) => f.userId === selectedFriendId);
        if (!friend) return;
        await addMemberByEmail(friend.email, { fromFriendList: true });
      } else if (memberEmail.trim()) {
        await addMemberByEmail(memberEmail.trim(), { fromFriendList: false });
      } else {
        setError("Select a friend or enter an email");
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add member");
    }
  }

  async function onSaveFriend() {
    if (!friendPrompt) return;
    try {
      await api.addFriend({ userId: friendPrompt.userId });
      setFriends(await api.listFriends());
      setFriendPrompt(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not save friend");
      setFriendPrompt(null);
    }
  }

  async function onCompleteSettlement(id: string) {
    setBusyId(id);
    setError(null);
    try {
      await api.completeSettlement(id);
      await load();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Could not complete settlement"
      );
    } finally {
      setBusyId(null);
    }
  }

  async function onDeleteExpense(expenseId: string) {
    if (!confirm("Delete this expense?")) return;
    setError(null);
    try {
      await api.deleteExpense(groupId, expenseId);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete");
    }
  }

  function nameFor(userId: string): string {
    return (
      group?.members.find((m) => m.userId === userId)?.displayName ?? userId
    );
  }

  if (!group && !error) {
    return <p className="muted page-pad">Loading group…</p>;
  }

  const pending = summary?.settlements.filter((s) => s.status === "PENDING") ?? [];
  const completed =
    summary?.settlements.filter((s) => s.status === "COMPLETED") ?? [];
  const isCreator = Boolean(group && user && group.createdBy === user.id);

  async function onDeleteGroup() {
    if (
      !confirm(
        `Delete "${group?.name}"? This removes expenses, settlements, and subscriptions permanently.`
      )
    ) {
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      await api.deleteGroup(groupId);
      navigate("/");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not delete group");
      setDeleting(false);
    }
  }

  return (
    <div className="page">
      <p className="breadcrumb">
        <Link to="/">← All groups</Link>
      </p>

      <div className="page-header">
        <div>
          <h1>{group?.name ?? "Group"}</h1>
          <p className="muted">
            Total spent:{" "}
            <span className="money">${summary?.totalSpent ?? "0.00"}</span>
          </p>
        </div>
        <div className="header-actions">
          <Link className="btn btn-primary" to={`/groups/${groupId}/expenses/new`}>
            Add expense
          </Link>
          {isCreator && (
            <button
              type="button"
              className="btn btn-ghost danger"
              disabled={deleting}
              onClick={() => void onDeleteGroup()}
            >
              {deleting ? "Deleting…" : "Delete group"}
            </button>
          )}
        </div>
      </div>

      {error && <p className="error-banner">{error}</p>}

      <section className="section">
        <h2>Members</h2>
        <ul className="plain-list">
          {group?.members.map((m) => (
            <li key={m.userId}>
              <strong>{m.displayName}</strong>
              <span className="muted"> · {m.email}</span>
              {m.userId === user?.id && <span className="tag">you</span>}
            </li>
          ))}
        </ul>
        <form className="stack-form compact" onSubmit={onAddMember}>
          <label>
            Add from friends
            <select
              value={selectedFriendId}
              onChange={(e) => {
                setSelectedFriendId(e.target.value);
                if (e.target.value) setMemberEmail("");
              }}
            >
              <option value="">
                {friendOptions.length === 0
                  ? "No friends available to add"
                  : "Select a friend…"}
              </option>
              {friendOptions.map((f) => (
                <option key={f.userId} value={f.userId}>
                  {f.displayName} ({f.email})
                </option>
              ))}
            </select>
          </label>
          <p className="muted center-or">or</p>
          <label>
            Add by email
            <input
              type="email"
              placeholder="someone@example.com"
              value={memberEmail}
              onChange={(e) => {
                setMemberEmail(e.target.value);
                if (e.target.value) setSelectedFriendId("");
              }}
            />
          </label>
          <button className="btn btn-secondary" type="submit">
            Add member
          </button>
        </form>
        <p className="hint">
          They must already have an account. New emails can be saved as friends
          after you add them.
        </p>
      </section>

      {friendPrompt && (
        <div className="modal-backdrop" role="presentation">
          <div className="modal" role="dialog" aria-labelledby="friend-prompt-title">
            <h2 id="friend-prompt-title">Save as friend?</h2>
            <p>
              <strong>{friendPrompt.displayName}</strong> ({friendPrompt.email})
              was added to this group. Save them to your friends list for next
              time?
            </p>
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setFriendPrompt(null)}
              >
                Not now
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => void onSaveFriend()}
              >
                Save as friend
              </button>
            </div>
          </div>
        </div>
      )}

      {group && (
        <SubscriptionsSection
          groupId={groupId}
          groupMembers={group.members}
          friends={friends}
        />
      )}

      <section className="section">
        <h2>Balances</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Member</th>
                <th>Paid</th>
                <th>Share</th>
                <th>Net</th>
                <th>Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {summary?.members.map((m) => (
                <tr key={m.userId}>
                  <td>{m.displayName}</td>
                  <td className="money">${m.paid}</td>
                  <td className="money">${m.share}</td>
                  <td
                    className={`money ${
                      m.netCents > 0
                        ? "positive"
                        : m.netCents < 0
                          ? "negative"
                          : ""
                    }`}
                  >
                    {m.netCents > 0 ? "+" : ""}
                    ${m.net}
                  </td>
                  <td
                    className={`money ${
                      m.outstandingNetCents > 0
                        ? "positive"
                        : m.outstandingNetCents < 0
                          ? "negative"
                          : ""
                    }`}
                  >
                    {m.outstandingNetCents > 0 ? "+" : ""}
                    ${m.outstandingNet}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="hint">
          Net = paid − share. Positive means they should receive money.
        </p>
      </section>

      <section className="section">
        <h2>Settlement plan</h2>
        {pending.length === 0 ? (
          <p className="empty">Everyone is settled — nothing pending.</p>
        ) : (
          <ul className="settlement-list">
            {pending.map((s) => {
              const youOwe = s.fromUserId === user?.id;
              const youReceive = s.toUserId === user?.id;
              return (
                <li key={s.id} className="settlement-item">
                  <div>
                    {youOwe ? (
                      <p className="settlement-line you-owe">
                        You owe <strong>{s.toDisplayName}</strong>{" "}
                        <span className="money">${s.amount}</span>
                      </p>
                    ) : youReceive ? (
                      <p className="settlement-line you-receive">
                        <strong>{s.fromDisplayName}</strong> should pay you{" "}
                        <span className="money">${s.amount}</span>
                      </p>
                    ) : (
                      <p className="settlement-line">
                        <strong>{s.fromDisplayName}</strong> →{" "}
                        <strong>{s.toDisplayName}</strong>
                        <span className="money"> ${s.amount}</span>
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={busyId === s.id}
                    onClick={() => void onCompleteSettlement(s.id)}
                  >
                    {busyId === s.id ? "Saving…" : "Mark paid"}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {completed.length > 0 && (
          <>
            <h3 className="subhead">Completed</h3>
            <ul className="plain-list muted">
              {completed.map((s) => (
                <li key={s.id}>
                  {s.fromDisplayName} → {s.toDisplayName}: ${s.amount}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="section">
        <h2>Expenses</h2>
        {expenses.length === 0 ? (
          <p className="empty">No expenses yet.</p>
        ) : (
          <ul className="expense-list">
            {expenses.map((ex) => (
              <li key={ex.id} className="expense-item">
                <button
                  type="button"
                  className="expense-toggle"
                  onClick={() =>
                    setExpandedExpense((id) => (id === ex.id ? null : ex.id))
                  }
                >
                  <span>
                    <strong>{ex.description}</strong>
                    <span className="muted">
                      {" "}
                      · {ex.expenseDate} · paid by {nameFor(ex.paidByUserId)} ·{" "}
                      {ex.splitMethod.toLowerCase()}
                    </span>
                  </span>
                  <span className="money">${ex.amount}</span>
                </button>
                {expandedExpense === ex.id && (
                  <div className="expense-detail">
                    <p className="muted">How it was split:</p>
                    <ul className="plain-list">
                      {ex.participants.map((p) => (
                        <li key={p.userId}>
                          {nameFor(p.userId)}:{" "}
                          <span className="money">${p.share}</span>
                          {user?.id === p.userId && (
                            <span className="tag">your share</span>
                          )}
                        </li>
                      ))}
                    </ul>
                    <button
                      type="button"
                      className="btn btn-ghost danger"
                      onClick={() => void onDeleteExpense(ex.id)}
                    >
                      Delete expense
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
