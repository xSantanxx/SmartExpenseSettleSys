import { describe, expect, it } from "vitest";
import {
  applyCompletedSettlements,
  generateSettlements,
} from "./settlement.js";
import type { MemberBalance } from "./types.js";

/**
 * Mirrors what regeneratePendingSettlements does without a database:
 * expense nets → subtract COMPLETED → greedy plan for remaining.
 */
describe("settlement regeneration pipeline", () => {
  const expenseNets: MemberBalance[] = [
    { memberId: "alice", paidCents: 20000, shareCents: 5000, netCents: 15000 },
    { memberId: "bob", paidCents: 0, shareCents: 5000, netCents: -5000 },
    { memberId: "charlie", paidCents: 0, shareCents: 5000, netCents: -5000 },
    { memberId: "david", paidCents: 0, shareCents: 5000, netCents: -5000 },
  ];

  it("builds an initial pending plan from expense nets", () => {
    const plan = generateSettlements(expenseNets);
    expect(plan.every((tx) => tx.toMemberId === "alice")).toBe(true);
    expect(plan.reduce((s, tx) => s + tx.amountCents, 0)).toBe(15000);
    expect(plan.length).toBe(3);
  });

  it("after one completed payment, regenerates a smaller pending plan", () => {
    const afterBobPaid = applyCompletedSettlements(expenseNets, [
      { fromMemberId: "bob", toMemberId: "alice", amountCents: 5000 },
    ]);

    expect(afterBobPaid.find((b) => b.memberId === "bob")!.netCents).toBe(0);
    expect(afterBobPaid.find((b) => b.memberId === "alice")!.netCents).toBe(
      10000
    );

    const remainingPlan = generateSettlements(afterBobPaid);
    expect(remainingPlan).toHaveLength(2);
    expect(remainingPlan.every((tx) => tx.fromMemberId !== "bob")).toBe(true);
    expect(remainingPlan.reduce((s, tx) => s + tx.amountCents, 0)).toBe(10000);
  });

  it("preserves the invariant that completed + pending clear original nets", () => {
    const completed = [
      { fromMemberId: "bob" as const, toMemberId: "alice" as const, amountCents: 5000 },
    ];
    const remaining = applyCompletedSettlements(expenseNets, completed);
    const pending = generateSettlements(remaining);

    const nets = new Map(expenseNets.map((b) => [b.memberId, b.netCents]));
    for (const tx of [...completed, ...pending]) {
      nets.set(tx.fromMemberId, nets.get(tx.fromMemberId)! + tx.amountCents);
      nets.set(tx.toMemberId, nets.get(tx.toMemberId)! - tx.amountCents);
    }
    for (const value of nets.values()) {
      expect(value).toBe(0);
    }
  });
});
