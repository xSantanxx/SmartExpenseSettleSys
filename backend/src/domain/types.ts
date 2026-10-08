/**
 * Domain types for expense balances and settlements.
 *
 * Money is always represented as integer cents to avoid floating-point errors.
 * Example: $12.34 → 1234
 */

export type MemberId = string;

/** Net balance in cents. Positive = should receive; negative = owes. */
export interface MemberBalance {
  memberId: MemberId;
  /** Total amount this member paid (cents). */
  paidCents: number;
  /** Total amount this member should have contributed (cents). */
  shareCents: number;
  /** paidCents - shareCents. Positive = creditor; negative = debtor. */
  netCents: number;
}

/**
 * A single settlement payment: debtor pays creditor.
 * Amounts are always positive cents.
 */
export interface SettlementTransaction {
  fromMemberId: MemberId;
  toMemberId: MemberId;
  amountCents: number;
}

export type SplitMethod = "EQUAL" | "UNEQUAL" | "PERCENTAGE";

/**
 * Minimal expense shape needed to compute balances.
 * Full persistence schema comes in Stage 2.
 */
export interface ExpenseInput {
  amountCents: number;
  paidByMemberId: MemberId;
  /** Members who share this expense (must be non-empty). */
  participantIds: MemberId[];
  splitMethod: SplitMethod;
  /**
   * For UNEQUAL: cents owed by each participant (must sum to amountCents).
   * For PERCENTAGE: basis points (10000 = 100%), must sum to 10000.
   * For EQUAL: ignored.
   */
  splits?: Record<MemberId, number>;
}
