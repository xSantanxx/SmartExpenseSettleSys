import { centsToDollars } from "../domain/money.js";
import { sendEmail } from "./email.js";

/**
 * Email a user that they were added to a shared subscription.
 * No-op (returns false) when Resend is not configured.
 */
export async function notifyAddedToSubscription(opts: {
  toEmail: string;
  toDisplayName: string;
  addedByName: string;
  subscriptionName: string;
  totalAmountCents: number;
  shareCents: number;
  nextBillingDate: string;
  periodKey: string;
  /** True when they join mid-cycle and start after the next billing date. */
  startsNextCycle?: boolean;
}): Promise<boolean> {
  const total = centsToDollars(opts.totalAmountCents);
  const share = centsToDollars(opts.shareCents);
  const timing = opts.startsNextCycle
    ? `You are on the roster now, but your split starts after the next billing date (${opts.nextBillingDate}). ` +
      `From period ${opts.periodKey} onward your share will be about $${share}.\n`
    : `Your portion for period ${opts.periodKey} is $${share}.\n` +
      `Next billing date: ${opts.nextBillingDate}.\n`;

  const text =
    `Hi ${opts.toDisplayName},\n\n` +
    `${opts.addedByName} added you to the shared subscription "${opts.subscriptionName}" ` +
    `($${total}/month) on Smart Expense Settlement.\n\n` +
    timing +
    `\nOpen the group in the app when it's time to mark your share paid.\n`;

  return sendEmail({
    to: opts.toEmail,
    subject: opts.startsNextCycle
      ? `Added to ${opts.subscriptionName} — ~$${share} starting ${opts.nextBillingDate}`
      : `Added to ${opts.subscriptionName} — $${share} due ${opts.nextBillingDate}`,
    text,
  });
}
