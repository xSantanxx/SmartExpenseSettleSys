import { getPool } from "../db/pool.js";
import { centsToDollars, dollarsToCents, splitEvenly } from "../domain/money.js";
import { badRequest, forbidden, notFound } from "../errors/AppError.js";
import { assertGroupMember, assertUsersAreMembers } from "./membership.js";

export interface SubscriptionMemberView {
  userId: string;
  displayName: string;
  email: string;
  shareCents: number;
  share: string;
  status: "PENDING" | "PAID";
  paidAt: string | null;
}

export interface SubscriptionDetail {
  id: string;
  groupId: string;
  name: string;
  amountCents: number;
  amount: string;
  billingDay: number;
  periodKey: string;
  nextBillingDate: string;
  active: boolean;
  createdBy: string;
  createdAt: string;
  members: SubscriptionMemberView[];
  yourShareCents: number;
  yourShare: string;
  yourStatus: "PENDING" | "PAID" | "NOT_MEMBER";
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
 * Ensure every current member has a payment row for this period.
 * Equal shares are recomputed from amount_cents / member count.
 * Already-PAID rows keep their recorded share; pending rows are refreshed.
 */
async function syncPeriodPayments(
  subscriptionId: string,
  amountCents: number,
  periodKey: string
): Promise<void> {
  const pool = getPool();
  const members = await pool.query<{ user_id: string }>(
    `SELECT user_id FROM subscription_members WHERE subscription_id = $1 ORDER BY joined_at`,
    [subscriptionId]
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
  const sub = await pool.query<{
    id: string;
    group_id: string;
    name: string;
    amount_cents: number;
    billing_day: number;
    created_by: string;
    created_at: Date;
    active: boolean;
  }>(`SELECT * FROM subscriptions WHERE id = $1`, [subscriptionId]);

  if (sub.rowCount === 0) throw notFound("Subscription not found");
  const row = sub.rows[0];
  await assertGroupMember(row.group_id, requesterId);

  const periodKey = currentPeriodKey(row.billing_day);
  await syncPeriodPayments(row.id, row.amount_cents, periodKey);

  const members = await pool.query<{
    user_id: string;
    display_name: string;
    email: string;
    share_cents: number | null;
    status: string | null;
    paid_at: Date | null;
  }>(
    `SELECT u.id AS user_id, u.display_name, u.email,
            p.share_cents, p.status, p.paid_at
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

  const memberViews: SubscriptionMemberView[] = members.rows.map((m) => {
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
    };
  });

  const yours = memberViews.find((m) => m.userId === requesterId);

  return {
    id: row.id,
    groupId: row.group_id,
    name: row.name,
    amountCents: row.amount_cents,
    amount: centsToDollars(row.amount_cents),
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
  try {
    await client.query("BEGIN");
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO subscriptions (group_id, name, amount_cents, billing_day, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [groupId, name, amountCents, billingDay, requesterId]
    );
    const id = inserted.rows[0].id;
    for (const userId of memberIds) {
      await client.query(
        `INSERT INTO subscription_members (subscription_id, user_id) VALUES ($1, $2)`,
        [id, userId]
      );
    }
    await client.query("COMMIT");
    return loadSubscriptionDetail(id, requesterId);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
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
    if (found.rowCount === 0) throw notFound("No account found with that email");
    userId = found.rows[0].id;
  }
  if (!userId) throw badRequest("Provide email or userId");

  await assertUsersAreMembers(groupId, [userId]);

  await pool.query(
    `INSERT INTO subscription_members (subscription_id, user_id)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [subscriptionId, userId]
  );

  const periodKey = currentPeriodKey(billingDay);
  await syncPeriodPayments(subscriptionId, amountCents, periodKey);
  return loadSubscriptionDetail(subscriptionId, requesterId);
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
