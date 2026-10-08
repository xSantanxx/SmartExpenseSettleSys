# Database Schema

PostgreSQL stores all application state. Domain math (balances, settlements)
stays in TypeScript; the database owns **integrity**, **persistence**, and
**authorization facts** (who belongs to which group).

## Why PostgreSQL?

| Need | How Postgres helps |
|------|--------------------|
| Relationships (users ↔ groups ↔ expenses) | Foreign keys enforce them |
| Money integrity | `INTEGER` cents + `CHECK` constraints |
| Atomic multi-table writes | Transactions (expense + participants) |
| Concurrent access | Row-level locking / isolation |
| AuthZ queries | `group_members` is the access control list |

An in-memory store would lose data on restart and skip these guarantees —
fine for a demo, weak for a portfolio backend.

We use **one database in one app** (monolith). No microservices: the domain
is small and the consistency boundary is the expense write.

## Entity-relationship overview

```
users ──────────────┐
  │                 │ created_by
  │                 ▼
  │              groups
  │                 │
  │    group_members│
  │◄────────────────┤
  │                 │
  │                 ▼
  │              expenses ◄── paid_by / created_by
  │                 │
  │    expense_participants
  │◄────────────────┘
  │
  └── settlements (from_user, to_user, group)
```

## Tables

### `users`

Account identity. Password hash only — never store plaintext passwords.

| Column | Type | Notes |
|--------|------|--------|
| `id` | `UUID` PK | |
| `email` | `CITEXT` UNIQUE | Case-insensitive unique login |
| `password_hash` | `TEXT` | bcrypt/argon2 output |
| `display_name` | `TEXT` | Shown in UI |
| `created_at` | `TIMESTAMPTZ` | |

### `groups`

A trip, apartment, dinner party, etc.

| Column | Type | Notes |
|--------|------|--------|
| `id` | `UUID` PK | |
| `name` | `TEXT` | |
| `created_by` | `UUID` FK → users | Creator; also added as member |
| `created_at` | `TIMESTAMPTZ` | |

### `group_members`

Membership join table — **the authorization source of truth**.

| Column | Type | Notes |
|--------|------|--------|
| `group_id` | `UUID` FK → groups | PK part |
| `user_id` | `UUID` FK → users | PK part |
| `joined_at` | `TIMESTAMPTZ` | |

Composite primary key `(group_id, user_id)` prevents duplicate membership.

Before any `GET/POST /groups/:id/...`, the API checks this table. Changing an
ID in the URL cannot bypass that check.

### `expenses`

One shared cost event.

| Column | Type | Notes |
|--------|------|--------|
| `id` | `UUID` PK | |
| `group_id` | `UUID` FK → groups | |
| `description` | `TEXT` | |
| `amount_cents` | `INTEGER` | `CHECK > 0` |
| `paid_by` | `UUID` FK → users | Must be a group member (app + trigger/check) |
| `expense_date` | `DATE` | |
| `split_method` | `TEXT` | `EQUAL` \| `UNEQUAL` \| `PERCENTAGE` |
| `created_by` | `UUID` FK → users | Who entered it |
| `created_at` | `TIMESTAMPTZ` | |

Money is **integer cents**, matching Stage 1 domain code.

### `expense_participants`

Who benefited, and their computed share.

| Column | Type | Notes |
|--------|------|--------|
| `expense_id` | `UUID` FK → expenses | PK part, `ON DELETE CASCADE` |
| `user_id` | `UUID` FK → users | PK part |
| `share_cents` | `INTEGER` | Final owed share; `CHECK >= 0` |
| `split_input` | `INTEGER` NULL | Unequal cents or percentage basis points |

**Design choice:** always persist `share_cents` at write time.

- Balance queries become `SUM(share_cents)` / `SUM(amount_cents)` — no
  re-deriving EQUAL remainder logic in SQL.
- `split_input` keeps the original unequal/percentage inputs for UI display.
- For `EQUAL`, `split_input` is NULL; `share_cents` still holds the result of
  `splitEvenly`.

App validation (Stage 3) still enforces:

- participants ⊆ group members
- payer ∈ group members
- unequal shares sum to `amount_cents`
- percentages sum to `10000` basis points
- `Σ share_cents === amount_cents`

Migration `002_membership_guards.sql` adds **triggers** so payers,
participants, and settlement parties must appear in `group_members`.
That is defense in depth: even a buggy SQL script cannot attach an
outsider to a group’s expenses.

### `settlements`

Optimized payment plan + completion tracking.

| Column | Type | Notes |
|--------|------|--------|
| `id` | `UUID` PK | |
| `group_id` | `UUID` FK → groups | |
| `from_user_id` | `UUID` FK → users | Debtor |
| `to_user_id` | `UUID` FK → users | Creditor |
| `amount_cents` | `INTEGER` | `CHECK > 0` |
| `status` | `TEXT` | `PENDING` \| `COMPLETED` |
| `created_at` | `TIMESTAMPTZ` | When plan row was created |
| `completed_at` | `TIMESTAMPTZ` NULL | Set when marked paid |

`CHECK (from_user_id <> to_user_id)` blocks self-payments.

#### Regeneration strategy

When expenses change (add/delete):

1. Keep rows with `status = 'COMPLETED'` (history).
2. Delete `PENDING` rows for that group.
3. Recompute nets from expenses, subtract completed settlements
   (`applyCompletedSettlements`), generate a new pending plan.

That preserves “Bob paid Alice last week” while refreshing what is still owed.

## Cascading behavior

| Parent deleted | Children |
|----------------|----------|
| `groups` | members, expenses, settlements cascade |
| `expenses` | participants cascade |
| `users` | **RESTRICT** if still referenced | Prefer remove from groups first |

Restricting user delete avoids silently rewriting financial history.

## Transactions (expense creation)

Creating an expense touches two tables. Pseudocode:

```
BEGIN;
  INSERT INTO expenses (...);
  INSERT INTO expense_participants (...) — one row per participant;
  -- later: regenerate PENDING settlements for the group
COMMIT;
```

If any insert fails, `ROLLBACK` leaves no orphan expense without participants.
That is the main integrity story for interview questions about transactions.

## Indexes

- `group_members(user_id)` — “list my groups”
- `expenses(group_id, expense_date DESC)` — group history / filters
- `settlements(group_id, status)` — outstanding plan

## What is *not* stored

- Net balances are **computed**, not cached tables (avoids stale cache bugs).
- Settlement optimality metadata is optional later; not required for core.

## Mapping to Stage 1 domain types

| Domain | Database |
|--------|----------|
| `MemberId` | `users.id` (UUID string) |
| `ExpenseInput.amountCents` | `expenses.amount_cents` |
| `ExpenseInput.splits` | `expense_participants.split_input` |
| computed shares | `expense_participants.share_cents` |
| `SettlementTransaction` | `settlements` row |
| `MemberBalance` | query aggregation, not a table |
