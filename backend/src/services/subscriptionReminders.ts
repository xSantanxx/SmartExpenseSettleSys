import { getPool } from "../db/pool.js";
import { centsToDollars } from "../domain/money.js";
import { sendEmail } from "./email.js";
import {
  currentPeriodKey,
  nextBillingDateIso,
  syncPeriodPayments,
} from "./subscriptions.js";

export interface ReminderResult {
  checked: number;
  emailed: number;
  skippedNoEmailProvider: number;
  details: string[];
}

/**
 * Days before billing_day to send reminders (inclusive of billing day itself).
 */
const REMINDER_WINDOW_DAYS = 3;

export function daysUntilBilling(dateIso: string, now = new Date()): number {
  const target = new Date(`${dateIso}T00:00:00.000Z`);
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

/**
 * For each active subscription whose next billing date is within REMINDER_WINDOW_DAYS,
 * email members who have not marked paid for the current period.
 *
 * Hit daily by GitHub Actions (or any scheduler) with CRON_SECRET.
 */
export async function runSubscriptionReminders(
  now = new Date()
): Promise<ReminderResult> {
  const pool = getPool();
  const subs = await pool.query<{
    id: string;
    name: string;
    amount_cents: number;
    billing_day: number;
    last_reminded_period: string | null;
  }>(
    `SELECT id, name, amount_cents, billing_day, last_reminded_period
     FROM subscriptions
     WHERE active = TRUE`
  );

  const result: ReminderResult = {
    checked: subs.rowCount ?? 0,
    emailed: 0,
    skippedNoEmailProvider: 0,
    details: [],
  };

  for (const sub of subs.rows) {
    const nextDate = nextBillingDateIso(sub.billing_day, now);
    const days = daysUntilBilling(nextDate, now);
    if (days < 0 || days > REMINDER_WINDOW_DAYS) {
      continue;
    }

    const periodKey = currentPeriodKey(sub.billing_day, now);
    if (sub.last_reminded_period === periodKey) {
      result.details.push(`${sub.name}: already reminded for ${periodKey}`);
      continue;
    }

    await syncPeriodPayments(sub.id, sub.amount_cents, periodKey);

    const unpaid = await pool.query<{
      email: string;
      display_name: string;
      share_cents: number;
    }>(
      `SELECT u.email, u.display_name, p.share_cents
       FROM subscription_members sm
       INNER JOIN users u ON u.id = sm.user_id
       INNER JOIN subscription_payments p
         ON p.subscription_id = sm.subscription_id
        AND p.user_id = sm.user_id
        AND p.period_key = $2
       WHERE sm.subscription_id = $1
         AND p.status = 'PENDING'`,
      [sub.id, periodKey]
    );

    if ((unpaid.rowCount ?? 0) === 0) {
      result.details.push(`${sub.name}: everyone paid for ${periodKey}`);
      continue;
    }

    let sentAny = false;
    for (const person of unpaid.rows) {
      const share = centsToDollars(Number(person.share_cents));
      const total = centsToDollars(sub.amount_cents);
      const when =
        days === 0
          ? `today (${nextDate})`
          : days === 1
            ? `tomorrow (${nextDate})`
            : `in ${days} days (${nextDate})`;
      const text =
        `Hi ${person.display_name},\n\n` +
        `Reminder: "${sub.name}" ($${total}/month) is due ${when}.\n` +
        `Your share for period ${periodKey} is $${share}.\n\n` +
        `Open Smart Expense Settlement and mark your share paid once you've paid.\n`;

      const ok = await sendEmail({
        to: person.email,
        subject: `Reminder: ${sub.name} — $${share} due ${nextDate}`,
        text,
      });

      if (ok) {
        result.emailed += 1;
        sentAny = true;
      } else {
        result.skippedNoEmailProvider += 1;
      }
    }

    if (sentAny) {
      await pool.query(
        `UPDATE subscriptions SET last_reminded_period = $1 WHERE id = $2`,
        [periodKey, sub.id]
      );
      result.details.push(
        `${sub.name}: emailed unpaid members for ${periodKey}`
      );
    } else if (result.skippedNoEmailProvider > 0) {
      result.details.push(
        `${sub.name}: ${unpaid.rowCount} unpaid — set RESEND_API_KEY to email reminders`
      );
    }
  }

  return result;
}
