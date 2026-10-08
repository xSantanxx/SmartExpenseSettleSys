import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, ApiError } from "../api/client";
import type { GroupDetail, SplitMethod } from "../api/types";
import { useAuth } from "../auth/AuthContext";

export function AddExpensePage() {
  const { groupId = "" } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState("");
  const [paidByUserId, setPaidByUserId] = useState(user?.id ?? "");
  const [expenseDate, setExpenseDate] = useState(
    new Date().toISOString().slice(0, 10)
  );
  const [splitMethod, setSplitMethod] = useState<SplitMethod>("EQUAL");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [unequal, setUnequal] = useState<Record<string, string>>({});
  const [percents, setPercents] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void api
      .getGroup(groupId)
      .then((g) => {
        setGroup(g);
        const initial: Record<string, boolean> = {};
        for (const m of g.members) initial[m.userId] = true;
        setSelected(initial);
        if (!paidByUserId && g.members[0]) {
          setPaidByUserId(g.members[0].userId);
        }
      })
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : "Failed to load group");
      });
  }, [groupId, paidByUserId]);

  const participantIds = useMemo(
    () => Object.keys(selected).filter((id) => selected[id]),
    [selected]
  );

  function toggleMember(id: string) {
    setSelected((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!group) return;
    setError(null);
    setSubmitting(true);

    try {
      let splits: Record<string, string | number> | undefined;
      if (splitMethod === "UNEQUAL") {
        splits = {};
        for (const id of participantIds) {
          splits[id] = unequal[id] ?? "0";
        }
      } else if (splitMethod === "PERCENTAGE") {
        splits = {};
        for (const id of participantIds) {
          splits[id] = Number(percents[id] ?? 0);
        }
      }

      await api.createExpense(groupId, {
        description,
        amount,
        paidByUserId,
        expenseDate,
        splitMethod,
        participantIds,
        splits,
      });
      navigate(`/groups/${groupId}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not create expense");
    } finally {
      setSubmitting(false);
    }
  }

  if (!group && !error) {
    return <p className="muted page-pad">Loading…</p>;
  }

  return (
    <div className="page">
      <p className="breadcrumb">
        <Link to={`/groups/${groupId}`}>← {group?.name ?? "Group"}</Link>
      </p>
      <h1>Add expense</h1>
      {error && <p className="error-banner">{error}</p>}

      <form className="stack-form" onSubmit={onSubmit}>
        <label>
          Description
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
            placeholder="Dinner"
          />
        </label>

        <div className="form-row">
          <label>
            Amount (USD)
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
              placeholder="120.00"
              inputMode="decimal"
            />
          </label>
          <label>
            Date
            <input
              type="date"
              value={expenseDate}
              onChange={(e) => setExpenseDate(e.target.value)}
              required
            />
          </label>
        </div>

        <label>
          Paid by
          <select
            value={paidByUserId}
            onChange={(e) => setPaidByUserId(e.target.value)}
            required
          >
            {group?.members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.displayName}
              </option>
            ))}
          </select>
        </label>

        <fieldset>
          <legend>Participants</legend>
          <div className="check-grid">
            {group?.members.map((m) => (
              <label key={m.userId} className="check-item">
                <input
                  type="checkbox"
                  checked={!!selected[m.userId]}
                  onChange={() => toggleMember(m.userId)}
                />
                {m.displayName}
              </label>
            ))}
          </div>
        </fieldset>

        <label>
          Split method
          <select
            value={splitMethod}
            onChange={(e) => setSplitMethod(e.target.value as SplitMethod)}
          >
            <option value="EQUAL">Equal</option>
            <option value="UNEQUAL">Unequal amounts</option>
            <option value="PERCENTAGE">Percentage</option>
          </select>
        </label>

        {splitMethod === "UNEQUAL" && (
          <fieldset>
            <legend>Amounts per person (must total expense)</legend>
            {participantIds.map((id) => {
              const member = group?.members.find((m) => m.userId === id);
              return (
                <label key={id}>
                  {member?.displayName}
                  <input
                    value={unequal[id] ?? ""}
                    onChange={(e) =>
                      setUnequal((prev) => ({ ...prev, [id]: e.target.value }))
                    }
                    placeholder="25.00"
                    required
                  />
                </label>
              );
            })}
          </fieldset>
        )}

        {splitMethod === "PERCENTAGE" && (
          <fieldset>
            <legend>Percent per person (must total 100)</legend>
            {participantIds.map((id) => {
              const member = group?.members.find((m) => m.userId === id);
              return (
                <label key={id}>
                  {member?.displayName}
                  <input
                    value={percents[id] ?? ""}
                    onChange={(e) =>
                      setPercents((prev) => ({ ...prev, [id]: e.target.value }))
                    }
                    placeholder="50"
                    required
                  />
                </label>
              );
            })}
          </fieldset>
        )}

        <button className="btn btn-primary" type="submit" disabled={submitting}>
          {submitting ? "Saving…" : "Save expense"}
        </button>
      </form>
    </div>
  );
}
