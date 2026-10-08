# Settlement Algorithm

This document explains the core of Smart Expense Settlement System: how we turn
a pile of shared expenses into a short list of “who pays whom.”

## Money representation

All amounts are **integer cents**.

| Dollars | Cents |
|---------|-------|
| $12.34  | 1234  |
| $0.10   | 10    |

JavaScript floating-point cannot represent many decimal fractions exactly
(`0.1 + 0.2 !== 0.3`). Doing finance in cents keeps every sum exact and makes
bugs like “off by one cent after many expenses” much less likely.

In PostgreSQL (Stage 2) we will store amounts as `INTEGER` cents (or
`NUMERIC(12,0)` of cents). The API can accept dollar strings and convert at
the boundary.

## From expenses to balances

For each group member:

```
paid  = sum of expense amounts where this member is the payer
share = sum of this member’s calculated share across all expenses
net   = paid − share
```

| net | Meaning |
|-----|---------|
| `> 0` | Creditor — should receive money |
| `< 0` | Debtor — owes money |
| `= 0` | Already settled |

**Invariant:** across the whole group, `Σ net === 0`. Every cent someone paid
is someone else’s share. If the sum is not zero, expense shares are wrong.

### Split methods

- **EQUAL** — divide cents as evenly as possible; remainder cents go to the
  first participants so the total is exact (`100 / 3 → 34, 33, 33`).
- **UNEQUAL** — caller provides per-person cents; must sum to the expense.
- **PERCENTAGE** — caller provides basis points (`10000 = 100%`); we convert to
  cents with floor + remainder distribution so the total is exact.

## Settlement algorithm (greedy min-cash-flow)

```
1. Discard members with net = 0
2. Debtors  = people with net < 0  (store |net| as remaining debt)
3. Creditors = people with net > 0 (store net as remaining credit)
4. While both lists are non-empty:
     a. Sort each list by remaining amount (largest first)
     b. Let debtor D and creditor C be the first of each list
     c. amount = min(D.remaining, C.remaining)
     d. Emit settlement: D → C for `amount`
     e. Subtract amount from both remainings
     f. Remove anyone whose remaining hit 0
5. Done — everyone is settled
```

### Worked example (from the project brief)

Expenses (equal split unless noted):

1. Alice pays $200 hotel — shared by Alice, Bob, Charlie, David  
2. Bob pays $100 dinner — shared by Bob, Charlie, David  
3. Charlie pays $60 transport — shared by Charlie, David  

Approximate nets (exact values come from cents in code):

- Alice is owed a large amount (paid hotel for everyone)
- Bob / Charlie / David owe varying amounts

The algorithm never creates chains like “Bob pays Charlie, Charlie pays Alice”
when “Bob pays Alice” would do. Each emitted transaction moves money from a
debtor directly to a creditor until all nets are zero.

### Spec numeric example

```
A: +150
B: +50
C: -100
D: -100
```

One valid greedy result:

```
C → A: 100
D → A: 50
D → B: 50
```

After these three payments, every net is zero. Three transactions instead of a
naive “everyone pays everyone they interacted with” graph.

## Complexity

Let `n` = number of members with non-zero net balance.

| Step | Cost |
|------|------|
| Build debtor/creditor lists | O(n) |
| Matching loop | ≤ n − 1 iterations (each clears ≥ 1 person) |
| Sort each iteration | O(n log n) per sort; overall O(n² log n) worst case with re-sort |

Practical group sizes are tiny (roommates, trips), so this is effectively
instant. Space is O(n).

We can later optimize sorting with heaps to O(n log n) total; it is not needed
for correctness or for internship-scale demos.

## Correctness vs optimality

- **Correctness:** each transfer preserves `Σ net`. When both lists empty,
  every individual net is zero. Settlements therefore always clear the group
  if input balances conserved money.
- **Transaction count:** we produce **at most `n − 1`** payments. Finding the
  *absolute minimum* number of transactions is NP-hard (subset-sum style).
  The greedy approach is the standard practical choice (similar in spirit to
  apps like Splitwise) and is easy to explain in interviews.

## Partial settlements

If some payments are marked completed, we adjust nets before regenerating:

```
debtor.net   += amount   // they paid, so they owe less
creditor.net −= amount   // they received, so they are owed less
```

Then run the same algorithm on the remaining nets. History of completed
settlements is kept in the database; we do not delete debts.

### Persistence (Stage 4)

`regeneratePendingSettlements` in the API layer:

1. Load expense nets from SQL  
2. Load `COMPLETED` settlement rows  
3. `applyCompletedSettlements` → remaining nets  
4. `generateSettlements` → new plan  
5. `DELETE` all `PENDING` rows for the group; `INSERT` the new plan  

Triggered when an expense is created/deleted, when `GET .../settlements` runs,
and after `PATCH /settlements/:id` marks a payment `COMPLETED`.

## Interview talking points

- Why cents instead of floats?
- Why must nets sum to zero?
- Why is absolute min-transactions NP-hard, and why is greedy enough?
- How do equal splits avoid losing cents?
- How do completed settlements feed back into the next plan?
