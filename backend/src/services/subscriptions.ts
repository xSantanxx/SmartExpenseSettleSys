import { getPool } from "../db/pool.js";
import { centsToDollars, dollarsToCents, splitEvenly } from "../domain/money.js";
import { AppError, badRequest, forbidden, notFound } from "../errors/AppError.js";
import { assertGroupMember, assertUsersAreMembers } from "./membership.js";
import { notifyAddedToSubscription } from "./subscriptionNotify.js";

export interface SubscriptionMemberView {
  userId: string;
  displayName: string;
  email: string;
  shareCents: number;
  share: string;
  status: "PENDING" | "PAID" | "UPCOMING";
  paidAt: string | null;
  /** First period (YYYY-MM) this person owes a share. */
  effectiveFromPeriod: string;
}

export interface SubscriptionDetail {
  id: string;
  groupId: string;
  name: string;
  /** Price used for the current billing period. */
  amountCents: number;
  amount: string;
  /** Scheduled price change (applies from pendingFromPeriod / next billing cycle). */
  pendingAmountCents: number | null;
  pendingAmount: string | null;
  pendingFromPeriod: string | null;
  billingDay: number;
  periodKey: string;
  nextBillingDate: string;
  active: boolean;
  createdBy: string;
  createdAt: string;
  members: SubscriptionMemberView[];
  yourShareCents: number;
  yourShare: string;
  yourStatus: "PENDING" | "PAID" | "UPCOMING" | "NOT_MEMBER";
}

/** Current billing period YYYY-MM based on billing day. */
export function currentPeriodKey(billingDay: number, now = new Date()): string {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth(); // 0-11
  const d = now.getUTCDate();
  // Before billing day → still in previous month's cycle.
  if (d < billingDay) {
    const prev = new Date(Date.UTC(y, m - 1, 1));
    return `${prev.getUTCFullYear()}-${String(prev.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  return `${y}-${String(m + 1).padStart(2, "0")}`;
}

export function nextBillingDateIso(billingDay: number, now = new Date()): string {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const d = now.getUTCDate();
  if (d < billingDay) {
    return new Date(Date.UTC(y, m, billingDay)).toISOString().slice(0, 10);
  }
  return new Date(Date.UTC(y, m + 1, billingDay)).toISOString().slice(0, 10);
}

/**
 * Period key that begins on the next billing date — used for late joiners so
 * the current cycle keeps its split until that date passes.
 */
export function nextPeriodKey(billingDay: number, now = new Date()): string {
  const nextIso = nextBillingDateIso(billingDay, now);
  const [ys, ms, ds] = nextIso.split("-").map(Number);
  return currentPeriodKey(billingDay, new Date(Date.UTC(ys, ms - 1, ds)));
}

/** Resolve which price applies for a given period key. */
export function amountForPeriod(
  amountCents: number,
  pendingAmountCents: number | null,
  pendingFromPeriod: string | null,
  periodKey: string
): number {
  if (
    pendingAmountCents != null &&
    pendingFromPeriod != null &&
    periodKey >= pendingFromPeriod
  ) {
    return pendingAmountCents;
  }
  return amountCents;
}

/**
 * When the current period has reached a scheduled price change, promote it
 * into amount_cents so history stays simple.
 */
async function promotePendingAmountIfDue(
  subscriptionId: string,
  billingDay: number,
  now = new Date()
): Promise<void> {
  const periodKey = currentPeriodKey(billingDay, now);
  await getPool().query(
    `UPDATE subscriptions
     SET amount_cents = pending_amount_cents,
         pending_amount_cents = NULL,
         pending_from_period = NULL
     WHERE id = $1
       AND pending_amount_cents IS NOT NULL
       AND pending_from_period IS NOT NULL
       AND pending_from_period <= $2`,
    [subscriptionId, periodKey]
  );
}

/**
 * Ensure members effective for this period have payment rows.
 * Equal shares among those people only. Already-PAID rows keep their share.
 */
export async function syncPeriodPayments(
  subscriptionId: string,
  amountCents: number,
  periodKey: string
): Promise<void> {
  const pool = getPool();
  const members = await pool.query<{ user_id: string }>(
    `SELECT user_id FROM subscription_members
     WHERE subscription_id = $1
       AND effective_from_period <= $2
     ORDER BY joined_at`,
    [subscriptionId, periodKey]
  );
  if (members.rowCount === 0) return;

  const memberIds = members.rows.map((r) => r.user_id);
  const shares = splitEvenly(amountCents, memberIds.length);

  const existing = await pool.query<{
    user_id: string;
    status: string;
  }>(
    `SELECT user_id, status FROM subscription_payments
     WHERE subscription_id = $1 AND period_key = $2`,
    [subscriptionId, periodKey]
  );
  const statusByUser = new Map(existing.rows.map((r) => [r.user_id, r.status]));

  for (let i = 0; i < memberIds.length; i++) {
    const userId = memberIds[i];
    const shareCents = shares[i];
    const status = statusByUser.get(userId);

    if (status === "PAID") {
      continue; // leave paid history alone
    }
    if (status === "PENDING") {
      await pool.query(
        `UPDATE subscription_payments
         SET share_cents = $1
         WHERE subscription_id = $2 AND user_id = $3 AND period_key = $4 AND status = 'PENDING'`,
        [shareCents, subscriptionId, userId, periodKey]
      );
    } else {
      await pool.query(
        `INSERT INTO subscription_payments
           (subscription_id, user_id, period_key, share_cents, status)
         VALUES ($1, $2, $3, $4, 'PENDING')`,
        [subscriptionId, userId, periodKey, shareCents]
      );
    }
  }

  // Remove pending rows for people no longer on the subscription.
  await pool.query(
    `DELETE FROM subscription_payments
     WHERE subscription_id = $1
       AND period_key = $2
       AND status = 'PENDING'
       AND user_id <> ALL($3::uuid[])`,
    [subscriptionId, periodKey, memberIds]
  );
}

async function loadSubscriptionDetail(
  subscriptionId: string,
  requesterId: string
): Promise<SubscriptionDetail> {
  const pool = getPool();
  const first = await pool.query<{ billing_day: number; group_id: string }>(
    `SELECT billing_day, group_id FROM subscriptions WHERE id = $1`,
    [subscriptionId]
  );
  if (first.rowCount === 0) throw notFound("Subscription not found");
  await assertGroupMember(first.rows[0].group_id, requesterId);
  await promotePendingAmountIfDue(subscriptionId, first.rows[0].billing_day);

  const sub = await pool.query<{
    id: string;
    group_id: string;
    name: string;
    amount_cents: number;
    pending_amount_cents: number | null;
    pending_from_period: string | null;
    billing_day: number;
    created_by: string;
    created_at: Date;
    active: boolean;
  }>(`SELECT * FROM subscriptions WHERE id = $1`, [subscriptionId]);

  if (sub.rowCount === 0) throw notFound("Subscription not found");
  const row = sub.rows[0];

  const periodKey = currentPeriodKey(row.billing_day);
  const periodAmount = amountForPeriod(
    row.amount_cents,
    row.pending_amount_cents,
    row.pending_from_period,
    periodKey
  );
  await syncPeriodPayments(row.id, periodAmount, periodKey);

  const members = await pool.query<{
    user_id: string;
    display_name: string;
    email: string;
    share_cents: number | null;
    status: string | null;
    paid_at: Date | null;
    effective_from_period: string;
  }>(
    `SELECT u.id AS user_id, u.display_name, u.email,
            p.share_cents, p.status, p.paid_at,
            sm.effective_from_period
     FROM subscription_members sm
     INNER JOIN users u ON u.id = sm.user_id
     LEFT JOIN subscription_payments p
       ON p.subscription_id = sm.subscription_id
      AND p.user_id = sm.user_id
      AND p.period_key = $2
     WHERE sm.subscription_id = $1
     ORDER BY sm.joined_at ASC`,
    [subscriptionId, periodKey]
  );

  const nextKey = nextPeriodKey(row.billing_day);
  const nextAmount = amountForPeriod(
    row.amount_cents,
    row.pending_amount_cents,
    row.pending_from_period,
    nextKey
  );
  const projectedNextShares =
    members.rows.length > 0
      ? splitEvenly(nextAmount, members.rows.length)
      : [];

  const memberViews: SubscriptionMemberView[] = members.rows.map((m, index) => {
    const upcoming = m.effective_from_period > periodKey;
    if (upcoming) {
      const shareCents = projectedNextShares[index] ?? 0;
      return {
        userId: m.user_id,
        displayName: m.display_name,
        email: m.email,
        shareCents,
        share: centsToDollars(shareCents),
        status: "UPCOMING" as const,
        paidAt: null,
        effectiveFromPeriod: m.effective_from_period,
      };
    }
    const shareCents = Number(m.share_cents ?? 0);
    const status = (m.status as "PENDING" | "PAID") ?? "PENDING";
    return {
      userId: m.user_id,
      displayName: m.display_name,
      email: m.email,
      shareCents,
      share: centsToDollars(shareCents),
      status,
      paidAt: m.paid_at ? m.paid_at.toISOString() : null,
      effectiveFromPeriod: m.effective_from_period,
    };
  });

  const yours = memberViews.find((m) => m.userId === requesterId);

  return {
    id: row.id,
    groupId: row.group_id,
    name: row.name,
    amountCents: periodAmount,
    amount: centsToDollars(periodAmount),
    pendingAmountCents: row.pending_amount_cents,
    pendingAmount:
      row.pending_amount_cents != null
        ? centsToDollars(row.pending_amount_cents)
        : null,
    pendingFromPeriod: row.pending_from_period,
    billingDay: row.billing_day,
    periodKey,
    nextBillingDate: nextBillingDateIso(row.billing_day),
    active: row.active,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
    members: memberViews,
    yourShareCents: yours?.shareCents ?? 0,
    yourShare: yours ? yours.share : "0.00",
    yourStatus: yours ? yours.status : "NOT_MEMBER",
  };
}

/**
 * Schedule a new monthly price starting next billing period.
 * Current period shares stay on the old amount.
 */
export async function updateSubscriptionAmount(
  subscriptionId: string,
  requesterId: string,
  amountInput: string | number
): Promise<SubscriptionDetail> {
  const pool = getPool();
  const sub = await pool.query<{
    group_id: string;
    amount_cents: number;
    pending_amount_cents: number | null;
    pending_from_period: string | null;
    billing_day: number;
    active: boolean;
  }>(
    `SELECT group_id, amount_cents, pending_amount_cents, pending_from_period,
            billing_day, active
     FROM subscriptions WHERE id = $1`,
    [subscriptionId]
  );
  if (sub.rowCount === 0) throw notFound("Subscription not found");
  const row = sub.rows[0];
  if (!row.active) throw badRequest("Subscription is ended");
  await assertGroupMember(row.group_id, requesterId);

  const newCents = dollarsToCents(amountInput);
  const fromPeriod = nextPeriodKey(row.billing_day);
  const currentPeriod = currentPeriodKey(row.billing_day);

  // Cancel a pending change by setting the amount back to the current price.
  if (newCents === row.amount_cents && currentPeriod < fromPeriod) {
    await pool.query(
      `UPDATE subscriptions
       SET pending_amount_cents = NULL, pending_from_period = NULL
       WHERE id = $1`,
      [subscriptionId]
    );
    return loadSubscriptionDetail(subscriptionId, requesterId);
  }

  await pool.query(
    `UPDATE subscriptions
     SET pending_amount_cents = $1, pending_from_period = $2
     WHERE id = $3`,
    [newCents, fromPeriod, subscriptionId]
  );

  return loadSubscriptionDetail(subscriptionId, requesterId);
}

export async function listSubscriptions(
  groupId: string,
  requesterId: string
): Promise<SubscriptionDetail[]> {
  await assertGroupMember(groupId, requesterId);
  const result = await getPool().query<{ id: string }>(
    `SELECT id FROM subscriptions
     WHERE group_id = $1 AND active = TRUE
     ORDER BY created_at DESC`,
    [groupId]
  );
  const details: SubscriptionDetail[] = [];
  for (const row of result.rows) {
    details.push(await loadSubscriptionDetail(row.id, requesterId));
  }
  return details;
}

export async function createSubscription(
  groupId: string,
  requesterId: string,
  input: {
    name: string;
    amount: string | number;
    billingDay: number;
    memberIds: string[];
  }
): Promise<SubscriptionDetail> {
  await assertGroupMember(groupId, requesterId);

  const name = input.name?.trim();
  if (!name) throw badRequest("name is required");

  const billingDay = Number(input.billingDay);
  if (!Number.isInteger(billingDay) || billingDay < 1 || billingDay > 28) {
    throw badRequest("billingDay must be an integer from 1 to 28");
  }

  const amountCents = dollarsToCents(input.amount);
  const memberIds = [...new Set(input.memberIds ?? [])];
  if (memberIds.length === 0) {
    throw badRequest("Add at least one person to the subscription");
  }
  await assertUsersAreMembers(groupId, memberIds);

  const pool = getPool();
  const client = await pool.connect();
  let id: string;
  try {
    await client.query("BEGIN");
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO subscriptions (group_id, name, amount_cents, billing_day, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [groupId, name, amountCents, billingDay, requesterId]
    );
    id = inserted.rows[0].id;
    const startPeriod = currentPeriodKey(billingDay);
    for (const userId of memberIds) {
      await client.query(
        `INSERT INTO subscription_members
           (subscription_id, user_id, effective_from_period)
         VALUES ($1, $2, $3)`,
        [id, userId, startPeriod]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  const detail = await loadSubscriptionDetail(id, requesterId);
  const adder = await pool.query<{ display_name: string }>(
    `SELECT display_name FROM users WHERE id = $1`,
    [requesterId]
  );
  const addedByName = adder.rows[0]?.display_name ?? "A group member";
  for (const m of detail.members) {
    if (m.userId === requesterId) continue;
    void notifyAddedToSubscription({
      toEmail: m.email,
      toDisplayName: m.displayName,
      addedByName,
      subscriptionName: detail.name,
      totalAmountCents: detail.amountCents,
      shareCents: m.shareCents,
      nextBillingDate: detail.nextBillingDate,
      periodKey: detail.periodKey,
    }).catch((err) => console.error("Add-to-subscription email failed:", err));
  }
  return detail;
}

export async function addSubscriptionMember(
  subscriptionId: string,
  requesterId: string,
  input: { email?: string; userId?: string }
): Promise<SubscriptionDetail> {
  const pool = getPool();
  const sub = await pool.query<{ group_id: string; amount_cents: number; billing_day: number }>(
    `SELECT group_id, amount_cents, billing_day FROM subscriptions WHERE id = $1 AND active = TRUE`,
    [subscriptionId]
  );
  if (sub.rowCount === 0) throw notFound("Subscription not found");
  const { group_id: groupId, amount_cents: amountCents, billing_day: billingDay } =
    sub.rows[0];
  await assertGroupMember(groupId, requesterId);

  let userId = input.userId?.trim();
  if (input.email?.trim()) {
    const found = await pool.query<{ id: string }>(
      `SELECT id FROM users WHERE email = $1`,
      [input.email.trim().toLowerCase()]
    );
    if (found.rowCount === 0) {
      throw notFound(
        "No account with that email — they must register on the site before you can add them"
      );
    }
    userId = found.rows[0].id;
  }
  if (!userId) throw badRequest("Provide email or userId");

  try {
    await assertUsersAreMembers(groupId, [userId]);
  } catch (err) {
    if (err instanceof AppError && err.statusCode === 403) {
      throw forbidden(
        "That person must be a member of this group before you can add them to the subscription"
      );
    }
    throw err;
  }

  // Late joiners bill from the next cycle so this period's split stays as-is.
  const startsPeriod = nextPeriodKey(billingDay);
  const inserted = await pool.query<{ user_id: string }>(
    `INSERT INTO subscription_members
       (subscription_id, user_id, effective_from_period)
     VALUES ($1, $2, $3)
     ON CONFLICT DO NOTHING
     RETURNING user_id`,
    [subscriptionId, userId, startsPeriod]
  );
  const newlyAdded = (inserted.rowCount ?? 0) > 0;

  const periodKey = currentPeriodKey(billingDay);
  await syncPeriodPayments(subscriptionId, amountCents, periodKey);
  const detail = await loadSubscriptionDetail(subscriptionId, requesterId);

  if (newlyAdded && userId !== requesterId) {
    const member = detail.members.find((m) => m.userId === userId);
    const adder = await pool.query<{ display_name: string }>(
      `SELECT display_name FROM users WHERE id = $1`,
      [requesterId]
    );
    if (member) {
      void notifyAddedToSubscription({
        toEmail: member.email,
        toDisplayName: member.displayName,
        addedByName: adder.rows[0]?.display_name ?? "A group member",
        subscriptionName: detail.name,
        totalAmountCents: detail.amountCents,
        shareCents: member.shareCents,
        nextBillingDate: detail.nextBillingDate,
        periodKey: startsPeriod,
        startsNextCycle: true,
      }).catch((err) => console.error("Add-to-subscription email failed:", err));
    }
  }

  return detail;
}

export async function removeSubscriptionMember(
  subscriptionId: string,
  requesterId: string,
  memberId: string
): Promise<SubscriptionDetail> {
  const pool = getPool();
  const sub = await pool.query<{ group_id: string; amount_cents: number; billing_day: number }>(
    `SELECT group_id, amount_cents, billing_day FROM subscriptions WHERE id = $1 AND active = TRUE`,
    [subscriptionId]
  );
  if (sub.rowCount === 0) throw notFound("Subscription not found");
  await assertGroupMember(sub.rows[0].group_id, requesterId);

  const count = await pool.query(
    `SELECT 1 FROM subscription_members WHERE subscription_id = $1`,
    [subscriptionId]
  );
  if ((count.rowCount ?? 0) <= 1) {
    throw badRequest("A subscription must keep at least one member");
  }

  await pool.query(
    `DELETE FROM subscription_members WHERE subscription_id = $1 AND user_id = $2`,
    [subscriptionId, memberId]
  );

  const periodKey = currentPeriodKey(sub.rows[0].billing_day);
  await syncPeriodPayments(
    subscriptionId,
    sub.rows[0].amount_cents,
    periodKey
  );
  return loadSubscriptionDetail(subscriptionId, requesterId);
}

export async function markSubscriptionPaid(
  subscriptionId: string,
  requesterId: string
): Promise<SubscriptionDetail> {
  const detail = await loadSubscriptionDetail(subscriptionId, requesterId);
  if (detail.yourStatus === "NOT_MEMBER") {
    throw forbidden("You are not on this subscription");
  }
  if (detail.yourStatus === "UPCOMING") {
    throw badRequest(
      "Your share starts after the next billing date — nothing to mark paid yet"
    );
  }
  if (detail.yourStatus === "PAID") {
    return detail;
  }

  await getPool().query(
    `UPDATE subscription_payments
     SET status = 'PAID', paid_at = NOW()
     WHERE subscription_id = $1 AND user_id = $2 AND period_key = $3`,
    [subscriptionId, requesterId, detail.periodKey]
  );
  return loadSubscriptionDetail(subscriptionId, requesterId);
}

export async function deactivateSubscription(
  subscriptionId: string,
  requesterId: string
): Promise<void> {
  const pool = getPool();
  const sub = await pool.query<{ group_id: string; created_by: string }>(
    `SELECT group_id, created_by FROM subscriptions WHERE id = $1`,
    [subscriptionId]
  );
  if (sub.rowCount === 0) throw notFound("Subscription not found");
  await assertGroupMember(sub.rows[0].group_id, requesterId);

  await pool.query(`UPDATE subscriptions SET active = FALSE WHERE id = $1`, [
    subscriptionId,
  ]);
}
