import { describe, expect, it } from "vitest";
import { calculateBalances, equalExpense } from "./balances.js";
import {
  applyCompletedSettlements,
  generateSettlements,
} from "./settlement.js";
import type { ExpenseInput, MemberBalance } from "./types.js";
import { dollarsToCents } from "./money.js";

function clear(
  balances: MemberBalance[],
  plan: ReturnType<typeof generateSettlements>
) {
  const net = new Map(balances.map((b) => [b.memberId, b.netCents]));
  for (const tx of plan) {
    net.set(tx.fromMemberId, net.get(tx.fromMemberId)! + tx.amountCents);
    net.set(tx.toMemberId, net.get(tx.toMemberId)! - tx.amountCents);
  }
  for (const v of net.values()) expect(v).toBe(0);
}

describe("settlement edge cases (Stage 5)", () => {
  it("handles percentage splits with odd cent remainders", () => {
    const members = ["a", "b", "c"];
    const expenses: ExpenseInput[] = [
      {
        amountCents: dollarsToCents("10.00"),
        paidByMemberId: "a",
        participantIds: members,
        splitMethod: "PERCENTAGE",
        splits: { a: 3333, b: 3333, c: 3334 },
      },
    ];
    const balances = calculateBalances(members, expenses);
    expect(balances.reduce((s, b) => s + b.netCents, 0)).toBe(0);
    clear(balances, generateSettlements(balances));
  });

  it("many creditors and one debtor still clears in ≤ n-1 transfers", () => {
    const balances: MemberBalance[] = [
      { memberId: "debtor", paidCents: 0, shareCents: 0, netCents: -1000 },
      ...Array.from({ length: 10 }, (_, i) => ({
        memberId: `c${i}`,
        paidCents: 0,
        shareCents: 0,
        netCents: 100,
      })),
    ];
    const plan = generateSettlements(balances);
    expect(plan.length).toBeLessThanOrEqual(10);
    expect(plan.every((tx) => tx.fromMemberId === "debtor")).toBe(true);
    clear(balances, plan);
  });

  it("spec trip example produces a valid minimized-style plan", () => {
    const members = ["alice", "bob", "charlie", "david"];
    const expenses = [
      equalExpense(200, "alice", members),
      equalExpense(100, "bob", ["bob", "charlie", "david"]),
      equalExpense(60, "charlie", ["charlie", "david"]),
    ];
    const balances = calculateBalances(members, expenses);
    const plan = generateSettlements(balances);
    const nonZero = balances.filter((b) => b.netCents !== 0).length;
    expect(plan.length).toBeLessThanOrEqual(nonZero - 1);
    clear(balances, plan);
  });

  it("stacking two completed payments still leaves a correct remainder", () => {
    const balances: MemberBalance[] = [
      { memberId: "a", paidCents: 0, shareCents: 0, netCents: 100 },
      { memberId: "b", paidCents: 0, shareCents: 0, netCents: -40 },
      { memberId: "c", paidCents: 0, shareCents: 0, netCents: -35 },
      { memberId: "d", paidCents: 0, shareCents: 0, netCents: -25 },
    ];
    const after = applyCompletedSettlements(balances, [
      { fromMemberId: "b", toMemberId: "a", amountCents: 40 },
      { fromMemberId: "c", toMemberId: "a", amountCents: 35 },
    ]);
    const plan = generateSettlements(after);
    expect(plan).toEqual([
      { fromMemberId: "d", toMemberId: "a", amountCents: 25 },
    ]);
  });
});
