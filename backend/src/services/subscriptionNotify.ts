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
}): Promise<boolean> {
  const total = centsToDollars(opts.totalAmountCents);
  const share = centsToDollars(opts.shareCents);
  const text =
    `Hi ${opts.toDisplayName},\n\n` +
    `${opts.addedByName} added you to the shared subscription "${opts.subscriptionName}" ` +
    `($${total}/month) on Smart Expense Settlement.\n\n` +
    `Your portion for period ${opts.periodKey} is $${share}.\n` +
    `Next billing date: ${opts.nextBillingDate}.\n\n` +
    `Open the group in the app to mark your share paid when you've paid.\n`;

  return sendEmail({
    to: opts.toEmail,
    subject: `Added to ${opts.subscriptionName} — $${share} due ${opts.nextBillingDate}`,
    text,
  });
}
