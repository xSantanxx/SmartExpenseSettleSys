import { describe, expect, it } from "vitest";
import {
  currentPeriodKey,
  nextBillingDateIso,
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
});
