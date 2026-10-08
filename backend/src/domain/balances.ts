import { dollarsToCents, splitEvenly } from "./money.js";
import type {
  ExpenseInput,
  MemberBalance,
  MemberId,
} from "./types.js";

export class BalanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BalanceError";
  }
}

/**
 * Compute each participant's share of a single expense in cents.
 * Validates that splits are internally consistent.
 */
export function computeExpenseShares(
  expense: ExpenseInput
): Record<MemberId, number> {
  const { amountCents, participantIds, splitMethod, splits } = expense;

  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new BalanceError("Expense amount must be a positive integer (cents)");
  }
  if (participantIds.length === 0) {
    throw new BalanceError("Expense must have at least one participant");
  }

  const uniqueParticipants = new Set(participantIds);
  if (uniqueParticipants.size !== participantIds.length) {
    throw new BalanceError("Duplicate participants are not allowed");
  }

  if (!uniqueParticipants.has(expense.paidByMemberId)) {
    // Payer may or may not be a participant (e.g. Alice pays for Bob & Charlie only).
    // We allow that — paidBy just needs to be a known member at the API layer.
  }

  switch (splitMethod) {
    case "EQUAL": {
      const shares = splitEvenly(amountCents, participantIds.length);
      return Object.fromEntries(
        participantIds.map((id, i) => [id, shares[i]])
      );
    }

    case "UNEQUAL": {
      if (!splits) {
        throw new BalanceError("UNEQUAL split requires per-member amounts");
      }
      const shareMap: Record<MemberId, number> = {};
      let total = 0;
      for (const id of participantIds) {
        const share = splits[id];
        if (share === undefined || !Number.isInteger(share) || share < 0) {
          throw new BalanceError(
            `Missing or invalid unequal share for participant ${id}`
          );
        }
        shareMap[id] = share;
        total += share;
      }
      if (total !== amountCents) {
        throw new BalanceError(
          `Unequal shares sum to ${total} cents but expense is ${amountCents} cents`
        );
      }
      return shareMap;
    }

    case "PERCENTAGE": {
      // Percentages stored as basis points: 10000 = 100.00%
      // Share = floor(amount * bp / 10000), with remainder distributed by order
      // so the sum always equals amountCents exactly.
      if (!splits) {
        throw new BalanceError("PERCENTAGE split requires per-member basis points");
      }
      let totalBp = 0;
      for (const id of participantIds) {
        const bp = splits[id];
        if (bp === undefined || !Number.isInteger(bp) || bp < 0) {
          throw new BalanceError(
            `Missing or invalid percentage for participant ${id}`
          );
        }
        totalBp += bp;
      }
      if (totalBp !== 10000) {
        throw new BalanceError(
          `Percentages must total 100% (10000 basis points), got ${totalBp}`
        );
      }

      const raw = participantIds.map((id) => {
        const bp = splits[id]!;
        return Math.floor((amountCents * bp) / 10000);
      });
      let remainder = amountCents - raw.reduce((a, b) => a + b, 0);
      // Give leftover cents to participants in order until the sum is exact.
      const shareMap: Record<MemberId, number> = {};
      for (let i = 0; i < participantIds.length; i++) {
        let share = raw[i];
        if (remainder > 0) {
          share += 1;
          remainder -= 1;
        }
        shareMap[participantIds[i]] = share;
      }
      return shareMap;
    }

    default: {
      const _exhaustive: never = splitMethod;
      throw new BalanceError(`Unknown split method: ${_exhaustive}`);
    }
  }
}

/**
 * Aggregate paid / share / net balances across all expenses for a set of members.
 *
 * netCents = paidCents - shareCents
 *   > 0 → creditor (should receive money)
 *   < 0 → debtor (owes money)
 *   = 0 → settled
 */
export function calculateBalances(
  memberIds: MemberId[],
  expenses: ExpenseInput[]
): MemberBalance[] {
  const paid = new Map<MemberId, number>();
  const share = new Map<MemberId, number>();

  for (const id of memberIds) {
    paid.set(id, 0);
    share.set(id, 0);
  }

  const memberSet = new Set(memberIds);

  for (const expense of expenses) {
    if (!memberSet.has(expense.paidByMemberId)) {
      throw new BalanceError(
        `Payer ${expense.paidByMemberId} is not a group member`
      );
    }
    for (const pid of expense.participantIds) {
      if (!memberSet.has(pid)) {
        throw new BalanceError(`Participant ${pid} is not a group member`);
      }
    }

    paid.set(
      expense.paidByMemberId,
      paid.get(expense.paidByMemberId)! + expense.amountCents
    );

    const shares = computeExpenseShares(expense);
    for (const [id, cents] of Object.entries(shares)) {
      share.set(id, share.get(id)! + cents);
    }
  }

  return memberIds.map((memberId) => {
    const paidCents = paid.get(memberId)!;
    const shareCents = share.get(memberId)!;
    return {
      memberId,
      paidCents,
      shareCents,
      netCents: paidCents - shareCents,
    };
  });
}

/** Convenience for tests/docs: build an equal-split expense from dollar amounts. */
export function equalExpense(
  amountDollars: string | number,
  paidBy: MemberId,
  participants: MemberId[]
): ExpenseInput {
  return {
    amountCents: dollarsToCents(amountDollars),
    paidByMemberId: paidBy,
    participantIds: participants,
    splitMethod: "EQUAL",
  };
}
