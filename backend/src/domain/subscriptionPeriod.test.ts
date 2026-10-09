import { describe, expect, it } from "vitest";
import { daysUntilBilling } from "../services/subscriptionReminders.js";
import {
  amountForPeriod,
  currentPeriodKey,
  nextBillingDateIso,
  nextPeriodKey,
} from "../services/subscriptions.js";

describe("subscription billing period helpers", () => {
  it("uses previous month before billing day", () => {
    // March 5, billing day 15 → still February cycle
    const now = new Date(Date.UTC(2026, 2, 5));
    expect(currentPeriodKey(15, now)).toBe("2026-02");
    expect(nextBillingDateIso(15, now)).toBe("2026-03-15");
  });

  it("uses current month on/after billing day", () => {
    const now = new Date(Date.UTC(2026, 2, 15));
    expect(currentPeriodKey(15, now)).toBe("2026-03");
    expect(nextBillingDateIso(15, now)).toBe("2026-04-15");
  });

  it("counts days until billing for reminder window", () => {
    const now = new Date(Date.UTC(2026, 2, 13));
    expect(daysUntilBilling("2026-03-15", now)).toBe(2);
    expect(daysUntilBilling("2026-03-13", now)).toBe(0);
  });

  it("late joiners start on the period that begins at next billing date", () => {
    // March 5, billing day 15 → next bill March 15 → period 2026-03
    const midCycle = new Date(Date.UTC(2026, 2, 5));
    expect(nextPeriodKey(15, midCycle)).toBe("2026-03");
    // March 20 → next bill April 15 → period 2026-04
    const afterBill = new Date(Date.UTC(2026, 2, 20));
    expect(nextPeriodKey(15, afterBill)).toBe("2026-04");
  });

  it("pending price applies only from its effective period", () => {
    expect(amountForPeriod(2299, 2499, "2026-04", "2026-03")).toBe(2299);
    expect(amountForPeriod(2299, 2499, "2026-04", "2026-04")).toBe(2499);
    expect(amountForPeriod(2299, null, null, "2026-04")).toBe(2299);
  });
});
