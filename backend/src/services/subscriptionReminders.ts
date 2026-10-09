import { config } from "../config.js";
import { getPool } from "../db/pool.js";
import { centsToDollars } from "../domain/money.js";
import {
  currentPeriodKey,
  nextBillingDateIso,
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

function daysUntil(dateIso: string, now = new Date()): number {
  const target = new Date(`${dateIso}T00:00:00.000Z`);
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  );
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

async function sendEmail(opts: {
  to: string;
  subject: string;
  text: string;
}): Promise<boolean> {
  const apiKey = config.resendApiKey();
  const from = config.reminderFromEmail();
  if (!apiKey || !from) {
    return false;
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [opts.to],
      subject: opts.subject,
      text: opts.text,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error("Resend error:", res.status, body);
    return false;
  }
  return true;
}

/**
 * For each active subscription whose next billing date is within REMINDER_WINDOW_DAYS,
 * email members who have not marked paid for the current period.
 *
 * Designed to be hit daily by Render Cron (or any scheduler) with CRON_SECRET.
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
    const days = daysUntil(nextDate, now);
    if (days < 0 || days > REMINDER_WINDOW_DAYS) {
      continue;
    }

    const periodKey = currentPeriodKey(sub.billing_day, now);
    if (sub.last_reminded_period === periodKey) {
      result.details.push(`${sub.name}: already reminded for ${periodKey}`);
      continue;
    }

    // Sync happens implicitly when listing; ensure unpaid rows exist via a light query.
    const unpaid = await pool.query<{
      email: string;
      display_name: string;
      share_cents: number;
    }>(
      `SELECT u.email, u.display_name, COALESCE(p.share_cents, 0) AS share_cents
       FROM subscription_members sm
       INNER JOIN users u ON u.id = sm.user_id
       LEFT JOIN subscription_payments p
         ON p.subscription_id = sm.subscription_id
        AND p.user_id = sm.user_id
        AND p.period_key = $2
       WHERE sm.subscription_id = $1
         AND (p.status IS NULL OR p.status = 'PENDING')`,
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
      const text =
        `Hi ${person.display_name},\n\n` +
        `Reminder: "${sub.name}" ($${total}/mo) is due on ${nextDate}.\n` +
        `Your share this period (${periodKey}) is about $${share}.\n` +
        `Mark it paid in Smart Expense Settlement when you've paid.\n`;

      const ok = await sendEmail({
        to: person.email,
        subject: `Reminder: ${sub.name} due ${nextDate}`,
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
