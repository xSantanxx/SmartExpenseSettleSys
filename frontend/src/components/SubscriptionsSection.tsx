import { useEffect, useMemo, useState, type FormEvent } from "react";
import { api, ApiError } from "../api/client";
import type { Friend, GroupMember, SubscriptionDetail } from "../api/types";
import { useAuth } from "../auth/AuthContext";

interface Props {
  groupId: string;
  groupMembers: GroupMember[];
  friends: Friend[];
}

export function SubscriptionsSection({
  groupId,
  groupMembers,
  friends,
}: Props) {
  const { user } = useAuth();
  const [items, setItems] = useState<SubscriptionDetail[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [billingDay, setBillingDay] = useState(1);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [friendPick, setFriendPick] = useState("");
  const [addEmail, setAddEmail] = useState<Record<string, string>>({});
  const [addFriendPick, setAddFriendPick] = useState<Record<string, string>>(
    {}
  );
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setItems(await api.listSubscriptions(groupId));
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "Failed to load subscriptions"
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [groupId]);

  useEffect(() => {
    const initial: Record<string, boolean> = {};
    for (const m of groupMembers) {
      initial[m.userId] = m.userId === user?.id;
    }
    setSelected(initial);
  }, [groupMembers, user?.id]);

  const friendsInGroup = useMemo(() => {
    const memberIds = new Set(groupMembers.map((m) => m.userId));
    return friends.filter((f) => memberIds.has(f.userId));
  }, [friends, groupMembers]);

  function toggle(id: string) {
    setSelected((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const memberIds = Object.keys(selected).filter((id) => selected[id]);
    try {
      await api.createSubscription(groupId, {
        name: name.trim(),
        amount,
        billingDay: Number(billingDay),
        memberIds,
      });
      setName("");
      setAmount("");
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create");
    }
  }

  async function onMarkPaid(subscriptionId: string) {
    setBusy(subscriptionId);
    setError(null);
    try {
      await api.markSubscriptionPaid(groupId, subscriptionId);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not mark paid");
    } finally {
      setBusy(null);
    }
  }

  async function onAddMember(subscriptionId: string) {
    setBusy(subscriptionId);
    setError(null);
    try {
      const friendId = addFriendPick[subscriptionId];
      const email = addEmail[subscriptionId]?.trim();
      if (friendId) {
        await api.addSubscriptionMember(groupId, subscriptionId, {
          userId: friendId,
        });
      } else if (email) {
        await api.addSubscriptionMember(groupId, subscriptionId, { email });
      } else {
        setError("Pick a friend or enter an email");
        return;
      }
      setAddFriendPick((p) => ({ ...p, [subscriptionId]: "" }));
      setAddEmail((p) => ({ ...p, [subscriptionId]: "" }));
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not add person");
    } finally {
      setBusy(null);
    }
  }

  async function onRemoveMember(subscriptionId: string, memberId: string) {
    if (!confirm("Remove this person from the subscription?")) return;
    setBusy(subscriptionId);
    try {
      await api.removeSubscriptionMember(groupId, subscriptionId, memberId);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not remove");
    } finally {
      setBusy(null);
    }
  }

  async function onDeactivate(subscriptionId: string) {
    if (!confirm("End this subscription?")) return;
    try {
      await api.deactivateSubscription(groupId, subscriptionId);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not end");
    }
  }

  return (
    <section className="section">
      <div className="page-header" style={{ marginBottom: "0.75rem" }}>
        <div>
          <h2>Shared subscriptions</h2>
          <p className="muted" style={{ margin: 0 }}>
            Split streaming bills evenly. Shares update when people join or leave.
            Unpaid members get an email reminder within 3 days of the billing day.
          </p>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => setShowForm((v) => !v)}
        >
          {showForm ? "Cancel" : "New subscription"}
        </button>
      </div>

      {error && <p className="error-banner">{error}</p>}

      {showForm && (
        <form className="stack-form compact" onSubmit={onCreate}>
          <label>
            Name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Netflix"
              required
            />
          </label>
          <div className="form-row">
            <label>
              Monthly price (USD)
              <input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="22.99"
                required
              />
            </label>
            <label>
              Billing day (1–28)
              <input
                type="number"
                min={1}
                max={28}
                value={billingDay}
                onChange={(e) => setBillingDay(Number(e.target.value))}
                required
              />
            </label>
          </div>

          <fieldset>
            <legend>Who splits this?</legend>
            <div className="check-grid">
              {groupMembers.map((m) => (
                <label key={m.userId} className="check-item">
                  <input
                    type="checkbox"
                    checked={!!selected[m.userId]}
                    onChange={() => toggle(m.userId)}
                  />
                  {m.displayName}
                </label>
              ))}
            </div>
            {friendsInGroup.length > 0 && (
              <label style={{ marginTop: "0.75rem" }}>
                Quick-add friend on the list
                <select
                  value={friendPick}
                  onChange={(e) => {
                    const id = e.target.value;
                    setFriendPick("");
                    if (id) setSelected((prev) => ({ ...prev, [id]: true }));
                  }}
                >
                  <option value="">Select friend…</option>
                  {friendsInGroup.map((f) => (
                    <option key={f.userId} value={f.userId}>
                      {f.displayName}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </fieldset>

          <button className="btn btn-primary" type="submit">
            Create subscription
          </button>
          <p className="hint">
            Only people already on this group (with an account) can be added.
            They get an email with their share and billing date when Resend is
            configured.
          </p>
        </form>
      )}

      {loading ? (
        <p className="muted">Loading subscriptions…</p>
      ) : items.length === 0 ? (
        <p className="empty">
          No shared subscriptions yet. Create one for Netflix, Spotify, etc.
        </p>
      ) : (
        <ul className="subscription-list">
          {items.map((sub) => {
            const notOnSub = new Set(sub.members.map((m) => m.userId));
            const addableFriends = friendsInGroup.filter(
              (f) => !notOnSub.has(f.userId)
            );
            const addableMembers = groupMembers.filter(
              (m) => !notOnSub.has(m.userId)
            );

            return (
              <li key={sub.id} className="subscription-card">
                <div className="subscription-head">
                  <div>
                    <strong>{sub.name}</strong>
                    <span className="money"> ${sub.amount}</span>
                    <span className="muted">
                      {" "}
                      / month · bills on day {sub.billingDay} · next{" "}
                      {sub.nextBillingDate}
                    </span>
                  </div>
                  {sub.yourStatus === "PENDING" && (
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busy === sub.id}
                      onClick={() => void onMarkPaid(sub.id)}
                    >
                      Mark my ${sub.yourShare} paid
                    </button>
                  )}
                  {sub.yourStatus === "PAID" && (
                    <span className="tag">You paid this period</span>
                  )}
                </div>

                <p className="hint">
                  Period {sub.periodKey} · your share{" "}
                  <span className="money">${sub.yourShare}</span> (
                  {sub.members.length} people)
                </p>

                <ul className="plain-list">
                  {sub.members.map((m) => (
                    <li key={m.userId}>
                      <strong>{m.displayName}</strong>
                      <span className="money"> ${m.share}</span>
                      <span className="muted">
                        {" "}
                        · {m.status === "PAID" ? "paid" : "pending"}
                      </span>
                      {m.userId !== user?.id && (
                        <button
                          type="button"
                          className="btn btn-ghost danger"
                          onClick={() => void onRemoveMember(sub.id, m.userId)}
                        >
                          Remove
                        </button>
                      )}
                    </li>
                  ))}
                </ul>

                {addableMembers.length > 0 && (
                  <div className="inline-form">
                    <select
                      value={addFriendPick[sub.id] ?? ""}
                      onChange={(e) =>
                        setAddFriendPick((p) => ({
                          ...p,
                          [sub.id]: e.target.value,
                        }))
                      }
                    >
                      <option value="">Add friend / member…</option>
                      {addableFriends.map((f) => (
                        <option key={f.userId} value={f.userId}>
                          Friend: {f.displayName}
                        </option>
                      ))}
                      {addableMembers
                        .filter(
                          (m) => !addableFriends.some((f) => f.userId === m.userId)
                        )
                        .map((m) => (
                          <option key={m.userId} value={m.userId}>
                            {m.displayName}
                          </option>
                        ))}
                    </select>
                    <input
                      type="email"
                      placeholder="or email"
                      value={addEmail[sub.id] ?? ""}
                      onChange={(e) =>
                        setAddEmail((p) => ({ ...p, [sub.id]: e.target.value }))
                      }
                    />
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={busy === sub.id}
                      onClick={() => void onAddMember(sub.id)}
                    >
                      Add
                    </button>
                  </div>
                )}

                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => void onDeactivate(sub.id)}
                >
                  End subscription
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
