import type {
  MemberBalance,
  MemberId,
  SettlementTransaction,
} from "./types.js";

export class SettlementError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettlementError";
  }
}

interface OpenBalance {
  memberId: MemberId;
  /** Absolute cents still owed or receivable. Always > 0 while open. */
  remainingCents: number;
}

/**
 * Greedy settlement algorithm (min-cash-flow style).
 *
 * Given net balances (paid − share):
 *   1. Drop anyone with net 0 (already settled).
 *   2. Split the rest into debtors (net < 0) and creditors (net > 0).
 *   3. Sort both by remaining amount descending (largest first).
 *   4. Repeatedly match the current largest debtor with the current largest
 *      creditor for min(debt, credit), then remove whoever is fully settled.
 *
 * Why this works:
 *   - Sum of all nets must be 0 (money is conserved). If not, data is corrupt.
 *   - Each match transfers value from a debtor to a creditor without changing
 *     anyone else's net, so the global invariant is preserved.
 *   - When both lists empty, everyone is settled.
 *
 * Complexity:
 *   Let n = number of members with non-zero balance.
 *   - Building lists: O(n)
 *   - Sorting: O(n log n)
 *   - Matching loop: at most n − 1 transfers (each step clears ≥ 1 person)
 *   - Total time: O(n log n)
 *   - Space: O(n)
 *
 * Optimality note:
 *   Finding the absolute minimum number of transactions is NP-hard
 *   (related to the subset-sum / partition problem). This greedy approach
 *   always produces a *correct* settlement with ≤ n − 1 transactions, which
 *   is enough for real group expenses and easy to explain in interviews.
 *   We re-sort after each match to keep preferring the largest remaining
 *   balances (simple and predictable).
 */
export function generateSettlements(
  balances: MemberBalance[]
): SettlementTransaction[] {
  assertBalancesConserveMoney(balances);

  const debtors: OpenBalance[] = [];
  const creditors: OpenBalance[] = [];

  for (const b of balances) {
    if (b.netCents < 0) {
      debtors.push({ memberId: b.memberId, remainingCents: -b.netCents });
    } else if (b.netCents > 0) {
      creditors.push({ memberId: b.memberId, remainingCents: b.netCents });
    }
  }

  const settlements: SettlementTransaction[] = [];

  // At most debtors.length + creditors.length − 1 iterations.
  while (debtors.length > 0 && creditors.length > 0) {
    // Prefer settling the largest remaining amounts first.
    debtors.sort((a, b) => b.remainingCents - a.remainingCents);
    creditors.sort((a, b) => b.remainingCents - a.remainingCents);

    const debtor = debtors[0];
    const creditor = creditors[0];
    const amount = Math.min(debtor.remainingCents, creditor.remainingCents);

    settlements.push({
      fromMemberId: debtor.memberId,
      toMemberId: creditor.memberId,
      amountCents: amount,
    });

    debtor.remainingCents -= amount;
    creditor.remainingCents -= amount;

    if (debtor.remainingCents === 0) {
      debtors.shift();
    }
    if (creditor.remainingCents === 0) {
      creditors.shift();
    }
  }

  if (debtors.length > 0 || creditors.length > 0) {
    // Should be unreachable if nets sum to zero.
    throw new SettlementError(
      "Settlement incomplete: balances do not conserve money"
    );
  }

  return settlements;
}

/** Verify Σ netCents === 0. Floating leftovers should never appear with cents. */
function assertBalancesConserveMoney(balances: MemberBalance[]): void {
  const sum = balances.reduce((acc, b) => acc + b.netCents, 0);
  if (sum !== 0) {
    throw new SettlementError(
      `Balances do not sum to zero (got ${sum} cents). Check expense shares.`
    );
  }
  for (const b of balances) {
    if (!Number.isInteger(b.netCents)) {
      throw new SettlementError(
        `Non-integer net balance for ${b.memberId}: ${b.netCents}`
      );
    }
  }
}

/**
 * Apply completed settlements to raw balances before regenerating a plan.
 * Used later for partial settlement tracking: completed payments reduce
 * outstanding nets so the next plan only covers what is still owed.
 */
export function applyCompletedSettlements(
  balances: MemberBalance[],
  completed: SettlementTransaction[]
): MemberBalance[] {
  const net = new Map(balances.map((b) => [b.memberId, b.netCents]));

  for (const tx of completed) {
    if (!Number.isInteger(tx.amountCents) || tx.amountCents <= 0) {
      throw new SettlementError("Settlement amount must be a positive integer");
    }
    if (!net.has(tx.fromMemberId) || !net.has(tx.toMemberId)) {
      throw new SettlementError("Settlement references unknown member");
    }
    // Debtor paid → their net increases (less negative / more settled).
    net.set(tx.fromMemberId, net.get(tx.fromMemberId)! + tx.amountCents);
    // Creditor received → their net decreases (less positive / more settled).
    net.set(tx.toMemberId, net.get(tx.toMemberId)! - tx.amountCents);
  }

  return balances.map((b) => ({
    ...b,
    netCents: net.get(b.memberId)!,
  }));
}
