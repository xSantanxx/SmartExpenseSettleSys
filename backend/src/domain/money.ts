/**
 * Money helpers — all financial math uses integer cents.
 *
 * Why: JavaScript numbers are IEEE-754 doubles. Expressions like
 * `0.1 + 0.2 === 0.3` are false. For currency that causes off-by-one-cent bugs
 * that compound across many expenses. Storing and computing in cents avoids that.
 */

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoneyError";
  }
}

/** Parse a decimal dollar string/number into integer cents. Rejects invalid input. */
export function dollarsToCents(amount: string | number): number {
  const normalized =
    typeof amount === "number" ? amount.toFixed(2) : amount.trim();

  if (!/^-?\d+(\.\d{1,2})?$/.test(normalized)) {
    throw new MoneyError(
      `Invalid money amount "${amount}". Use up to 2 decimal places (e.g. 12.34).`
    );
  }

  const negative = normalized.startsWith("-");
  const [wholePart, fractionPart = ""] = normalized.replace("-", "").split(".");
  const cents =
    Number(wholePart) * 100 + Number((fractionPart + "00").slice(0, 2));

  return negative ? -cents : cents;
}

/** Format integer cents as a dollar string with exactly 2 decimals. */
export function centsToDollars(cents: number): string {
  if (!Number.isInteger(cents)) {
    throw new MoneyError(`cents must be an integer, got ${cents}`);
  }

  const negative = cents < 0;
  const absolute = Math.abs(cents);
  const dollars = Math.floor(absolute / 100);
  const remainder = absolute % 100;
  const formatted = `${dollars}.${remainder.toString().padStart(2, "0")}`;
  return negative ? `-${formatted}` : formatted;
}

/**
 * Distribute `totalCents` across `n` people as evenly as possible.
 * Remainder cents go to the first participants so the sum is exact.
 *
 * Example: 100 cents / 3 → [34, 33, 33]
 */
export function splitEvenly(totalCents: number, n: number): number[] {
  if (!Number.isInteger(totalCents) || totalCents < 0) {
    throw new MoneyError("totalCents must be a non-negative integer");
  }
  if (!Number.isInteger(n) || n <= 0) {
    throw new MoneyError("n must be a positive integer");
  }

  const base = Math.floor(totalCents / n);
  const remainder = totalCents % n;
  return Array.from({ length: n }, (_, i) => base + (i < remainder ? 1 : 0));
}
