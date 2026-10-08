import { describe, expect, it } from "vitest";
import {
  calculateBalances,
  computeExpenseShares,
  equalExpense,
} from "./balances.js";
import { dollarsToCents } from "./money.js";
import {
  applyCompletedSettlements,
  generateSettlements,
  SettlementError,
} from "./settlement.js";
import type { ExpenseInput, MemberBalance } from "./types.js";

function nets(balances: MemberBalance[]): Record<string, number> {
  return Object.fromEntries(balances.map((b) => [b.memberId, b.netCents]));
}

function assertSettlementsClearBalances(
  balances: MemberBalance[],
  settlements: ReturnType<typeof generateSettlements>
) {
  const remaining = new Map(balances.map((b) => [b.memberId, b.netCents]));
  for (const tx of settlements) {
    remaining.set(
      tx.fromMemberId,
      remaining.get(tx.fromMemberId)! + tx.amountCents
    );
    remaining.set(
      tx.toMemberId,
      remaining.get(tx.toMemberId)! - tx.amountCents
    );
  }
  for (const value of remaining.values()) {
    expect(value).toBe(0);
  }
}

describe("computeExpenseShares", () => {
  it("splits equally with remainder cents", () => {
    const shares = computeExpenseShares({
      amountCents: 100,
      paidByMemberId: "a",
      participantIds: ["a", "b", "c"],
      splitMethod: "EQUAL",
    });
    expect(shares).toEqual({ a: 34, b: 33, c: 33 });
    expect(Object.values(shares).reduce((x, y) => x + y, 0)).toBe(100);
  });

  it("validates unequal amounts sum to expense", () => {
    expect(() =>
      computeExpenseShares({
        amountCents: 10000,
        paidByMemberId: "a",
        participantIds: ["a", "b"],
        splitMethod: "UNEQUAL",
        splits: { a: 6000, b: 3000 },
      })
    ).toThrow(/sum to 9000/);
  });

  it("validates percentages total 100%", () => {
    expect(() =>
      computeExpenseShares({
        amountCents: 10000,
        paidByMemberId: "a",
        participantIds: ["a", "b"],
        splitMethod: "PERCENTAGE",
        splits: { a: 5000, b: 4000 },
      })
    ).toThrow(/100%/);
  });

  it("percentage split allocates remainder cents exactly", () => {
    const shares = computeExpenseShares({
      amountCents: 100,
      paidByMemberId: "a",
      participantIds: ["a", "b", "c"],
      splitMethod: "PERCENTAGE",
      // 33.33%, 33.33%, 33.34% in basis points
      splits: { a: 3333, b: 3333, c: 3334 },
    });
    expect(Object.values(shares).reduce((x, y) => x + y, 0)).toBe(100);
  });
});

describe("settlement algorithm", () => {
  // Case 1: Two people with one expense
  it("1. two people, one expense", () => {
    const members = ["alice", "bob"];
    const expenses = [equalExpense(100, "alice", members)];
    const balances = calculateBalances(members, expenses);
    expect(nets(balances)).toEqual({ alice: 5000, bob: -5000 });

    const plan = generateSettlements(balances);
    expect(plan).toEqual([
      { fromMemberId: "bob", toMemberId: "alice", amountCents: 5000 },
    ]);
    assertSettlementsClearBalances(balances, plan);
  });

  // Case 2: Three people with one payer
  it("2. three people, one payer", () => {
    const members = ["alice", "bob", "charlie"];
    const expenses = [equalExpense(90, "alice", members)];
    const balances = calculateBalances(members, expenses);
    expect(nets(balances)).toEqual({
      alice: 6000,
      bob: -3000,
      charlie: -3000,
    });

    const plan = generateSettlements(balances);
    expect(plan).toHaveLength(2);
    assertSettlementsClearBalances(balances, plan);
  });

  // Case 3: Multiple people paying
  it("3. multiple people paying", () => {
    const members = ["alice", "bob", "charlie", "david"];
    const expenses: ExpenseInput[] = [
      equalExpense(200, "alice", members), // hotel
      equalExpense(100, "bob", ["bob", "charlie", "david"]), // dinner
      equalExpense(60, "charlie", ["charlie", "david"]), // transport
    ];
    const balances = calculateBalances(members, expenses);
    // Alice: paid 200, share 50 → +150
    // Bob: paid 100, share 50+33.33≈83.34 → verify via cents
    // We'll assert conservation + settlement clears rather than hardcode every share.
    const sum = balances.reduce((a, b) => a + b.netCents, 0);
    expect(sum).toBe(0);
    expect(balances.find((b) => b.memberId === "alice")!.netCents).toBe(15000);

    const plan = generateSettlements(balances);
    assertSettlementsClearBalances(balances, plan);
    // No one should pay themselves; all amounts positive
    for (const tx of plan) {
      expect(tx.fromMemberId).not.toBe(tx.toMemberId);
      expect(tx.amountCents).toBeGreaterThan(0);
    }
  });

  // Case 4: Everyone already balanced
  it("4. everyone already balanced", () => {
    const balances: MemberBalance[] = [
      { memberId: "a", paidCents: 50, shareCents: 50, netCents: 0 },
      { memberId: "b", paidCents: 50, shareCents: 50, netCents: 0 },
    ];
    expect(generateSettlements(balances)).toEqual([]);
  });

  // Case 5: Some people owe nothing
  it("5. some people owe nothing", () => {
    const members = ["alice", "bob", "charlie"];
    // Charlie not in expense → net 0
    const expenses = [equalExpense(40, "alice", ["alice", "bob"])];
    const balances = calculateBalances(members, expenses);
    expect(nets(balances)).toEqual({
      alice: 2000,
      bob: -2000,
      charlie: 0,
    });
    const plan = generateSettlements(balances);
    expect(plan).toEqual([
      { fromMemberId: "bob", toMemberId: "alice", amountCents: 2000 },
    ]);
  });

  // Case 6: One person owed by everyone
  it("6. one creditor, many debtors", () => {
    const balances: MemberBalance[] = [
      { memberId: "a", paidCents: 300, shareCents: 0, netCents: 300 },
      { memberId: "b", paidCents: 0, shareCents: 100, netCents: -100 },
      { memberId: "c", paidCents: 0, shareCents: 100, netCents: -100 },
      { memberId: "d", paidCents: 0, shareCents: 100, netCents: -100 },
    ];
    const plan = generateSettlements(balances);
    expect(plan).toHaveLength(3);
    expect(plan.every((tx) => tx.toMemberId === "a")).toBe(true);
    assertSettlementsClearBalances(balances, plan);
  });

  // Case 7: Multiple creditors
  it("7. multiple creditors", () => {
    const balances: MemberBalance[] = [
      { memberId: "a", paidCents: 0, shareCents: 0, netCents: 150 },
      { memberId: "b", paidCents: 0, shareCents: 0, netCents: 50 },
      { memberId: "c", paidCents: 0, shareCents: 0, netCents: -100 },
      { memberId: "d", paidCents: 0, shareCents: 0, netCents: -100 },
    ];
    const plan = generateSettlements(balances);
    // Spec example shape: C→A 100, D→A 50, D→B 50 (or equivalent)
    assertSettlementsClearBalances(balances, plan);
    expect(plan.length).toBeLessThanOrEqual(3);
    const totalPaid = plan.reduce((s, tx) => s + tx.amountCents, 0);
    expect(totalPaid).toBe(200);
  });

  // Case 8: Multiple debtors (covered above) — large mismatch
  it("8. multiple debtors and creditors", () => {
    const balances: MemberBalance[] = [
      { memberId: "a", paidCents: 0, shareCents: 0, netCents: 80 },
      { memberId: "b", paidCents: 0, shareCents: 0, netCents: 40 },
      { memberId: "c", paidCents: 0, shareCents: 0, netCents: -50 },
      { memberId: "d", paidCents: 0, shareCents: 0, netCents: -30 },
      { memberId: "e", paidCents: 0, shareCents: 0, netCents: -40 },
    ];
    const plan = generateSettlements(balances);
    assertSettlementsClearBalances(balances, plan);
    expect(plan.length).toBeLessThanOrEqual(4);
  });

  // Case 9: Unequal expenses
  it("9. unequal split expenses", () => {
    const members = ["alice", "bob", "charlie"];
    const expenses: ExpenseInput[] = [
      {
        amountCents: dollarsToCents(100),
        paidByMemberId: "alice",
        participantIds: members,
        splitMethod: "UNEQUAL",
        splits: {
          alice: dollarsToCents(50),
          bob: dollarsToCents(25),
          charlie: dollarsToCents(25),
        },
      },
    ];
    const balances = calculateBalances(members, expenses);
    expect(nets(balances)).toEqual({
      alice: 5000,
      bob: -2500,
      charlie: -2500,
    });
    assertSettlementsClearBalances(balances, generateSettlements(balances));
  });

  // Case 10: Large groups
  it("10. large group still clears and stays ≤ n-1 transactions", () => {
    const n = 50;
    const members = Array.from({ length: n }, (_, i) => `m${i}`);
    const expenses = [equalExpense(1000, "m0", members)];
    const balances = calculateBalances(members, expenses);
    const plan = generateSettlements(balances);
    assertSettlementsClearBalances(balances, plan);
    const nonZero = balances.filter((b) => b.netCents !== 0).length;
    expect(plan.length).toBeLessThanOrEqual(nonZero - 1);
  });

  // Case 11: Decimal currency values
  it("11. decimal currency values stay exact in cents", () => {
    const members = ["alice", "bob"];
    const expenses = [equalExpense("10.01", "alice", members)];
    const balances = calculateBalances(members, expenses);
    // 1001 cents / 2 → [501, 500]
    expect(nets(balances)).toEqual({ alice: 500, bob: -500 });
    const plan = generateSettlements(balances);
    expect(plan[0].amountCents).toBe(500);
  });

  // Case 12: Invalid expense data
  it("12. invalid expense data is rejected", () => {
    expect(() =>
      calculateBalances(["a"], [
        {
          amountCents: -5,
          paidByMemberId: "a",
          participantIds: ["a"],
          splitMethod: "EQUAL",
        },
      ])
    ).toThrow();

    expect(() =>
      calculateBalances(["a"], [
        equalExpense(10, "outsider", ["a"]),
      ])
    ).toThrow(/not a group member/);

    expect(() =>
      generateSettlements([
        { memberId: "a", paidCents: 0, shareCents: 0, netCents: 10 },
        { memberId: "b", paidCents: 0, shareCents: 0, netCents: -5 },
      ])
    ).toThrow(SettlementError);
  });

  it("applies completed settlements before regenerating the plan", () => {
    const balances: MemberBalance[] = [
      { memberId: "a", paidCents: 100, shareCents: 0, netCents: 100 },
      { memberId: "b", paidCents: 0, shareCents: 60, netCents: -60 },
      { memberId: "c", paidCents: 0, shareCents: 40, netCents: -40 },
    ];
    const afterPartial = applyCompletedSettlements(balances, [
      { fromMemberId: "b", toMemberId: "a", amountCents: 60 },
    ]);
    expect(nets(afterPartial)).toEqual({ a: 40, b: 0, c: -40 });
    const remainingPlan = generateSettlements(afterPartial);
    expect(remainingPlan).toEqual([
      { fromMemberId: "c", toMemberId: "a", amountCents: 40 },
    ]);
  });
});
