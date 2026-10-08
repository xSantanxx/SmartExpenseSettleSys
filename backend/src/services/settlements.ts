import type { Pool, PoolClient } from "pg";
import { getPool } from "../db/pool.js";
import type { SettlementRow, SettlementStatus } from "../db/types.js";
import {
  applyCompletedSettlements,
  generateSettlements,
} from "../domain/settlement.js";
import type { MemberBalance } from "../domain/types.js";
import { badRequest, notFound } from "../errors/AppError.js";
import { assertGroupMember } from "./membership.js";

type Queryable = Pool | PoolClient;

export interface SettlementDetail {
  id: string;
  groupId: string;
  fromUserId: string;
  fromDisplayName: string;
  toUserId: string;
  toDisplayName: string;
  amountCents: number;
  amount: string;
  status: SettlementStatus;
  createdAt: string;
  completedAt: string | null;
}

function centsToDollarString(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = (abs % 100).toString().padStart(2, "0");
  return `${neg ? "-" : ""}${whole}.${frac}`;
}

/** Raw expense nets for every group member (before completed settlements). */
export async function fetchExpenseBalances(
  groupId: string,
  db: Queryable = getPool()
): Promise<MemberBalance[]> {
  const result = await db.query<{
    user_id: string;
    paid_cents: string | number;
    share_cents: string | number;
    net_cents: string | number;
  }>(
    `WITH members AS (
       SELECT user_id FROM group_members WHERE group_id = $1
     ),
     paid AS (
       SELECT e.paid_by AS user_id, COALESCE(SUM(e.amount_cents), 0)::bigint AS paid_cents
       FROM expenses e
       WHERE e.group_id = $1
       GROUP BY e.paid_by
     ),
     share AS (
       SELECT ep.user_id, COALESCE(SUM(ep.share_cents), 0)::bigint AS share_cents
       FROM expense_participants ep
       INNER JOIN expenses e ON e.id = ep.expense_id
       WHERE e.group_id = $1
       GROUP BY ep.user_id
     )
     SELECT
       m.user_id,
       COALESCE(p.paid_cents, 0) AS paid_cents,
       COALESCE(s.share_cents, 0) AS share_cents,
       COALESCE(p.paid_cents, 0) - COALESCE(s.share_cents, 0) AS net_cents
     FROM members m
     LEFT JOIN paid p ON p.user_id = m.user_id
     LEFT JOIN share s ON s.user_id = m.user_id`,
    [groupId]
  );

  return result.rows.map((r) => ({
    memberId: r.user_id,
    paidCents: Number(r.paid_cents),
    shareCents: Number(r.share_cents),
    netCents: Number(r.net_cents),
  }));
}

async function fetchCompletedTransactions(
  groupId: string,
  db: Queryable
): Promise<
  Array<{ fromMemberId: string; toMemberId: string; amountCents: number }>
> {
  const result = await db.query<SettlementRow>(
    `SELECT * FROM settlements
     WHERE group_id = $1 AND status = 'COMPLETED'`,
    [groupId]
  );
  return result.rows.map((r) => ({
    fromMemberId: r.from_user_id,
    toMemberId: r.to_user_id,
    amountCents: r.amount_cents,
  }));
}

/**
 * Rebuild PENDING settlements for a group.
 *
 * 1. Compute nets from expenses
 * 2. Subtract COMPLETED history (applyCompletedSettlements)
 * 3. Run greedy generateSettlements on what remains
 * 4. Replace all PENDING rows (COMPLETED rows are never deleted here)
 *
 * Call inside the same DB transaction as expense create/delete when possible.
 */
export async function regeneratePendingSettlements(
  groupId: string,
  db: Queryable = getPool()
): Promise<void> {
  const expenseBalances = await fetchExpenseBalances(groupId, db);
  const completed = await fetchCompletedTransactions(groupId, db);
  const remaining = applyCompletedSettlements(expenseBalances, completed);
  const plan = generateSettlements(remaining);

  await db.query(
    `DELETE FROM settlements WHERE group_id = $1 AND status = 'PENDING'`,
    [groupId]
  );

  for (const tx of plan) {
    await db.query(
      `INSERT INTO settlements (group_id, from_user_id, to_user_id, amount_cents, status)
       VALUES ($1, $2, $3, $4, 'PENDING')`,
      [groupId, tx.fromMemberId, tx.toMemberId, tx.amountCents]
    );
  }
}

export async function listSettlements(
  groupId: string,
  requesterId: string,
  status?: SettlementStatus
): Promise<SettlementDetail[]> {
  await assertGroupMember(groupId, requesterId);

  const params: unknown[] = [groupId];
  let sql = `
    SELECT s.*,
           fu.display_name AS from_display_name,
           tu.display_name AS to_display_name
    FROM settlements s
    INNER JOIN users fu ON fu.id = s.from_user_id
    INNER JOIN users tu ON tu.id = s.to_user_id
    WHERE s.group_id = $1`;

  if (status) {
    params.push(status);
    sql += ` AND s.status = $${params.length}`;
  }

  sql += ` ORDER BY
    CASE s.status WHEN 'PENDING' THEN 0 ELSE 1 END,
    s.amount_cents DESC,
    s.created_at ASC`;

  const result = await getPool().query<
    SettlementRow & { from_display_name: string; to_display_name: string }
  >(sql, params);

  return result.rows.map(mapSettlement);
}

/**
 * Ensure a plan exists by regenerating PENDING from expenses + completed history.
 * Idempotent — safe to call on every GET.
 */
export async function getOrRefreshSettlements(
  groupId: string,
  requesterId: string
): Promise<SettlementDetail[]> {
  await assertGroupMember(groupId, requesterId);

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await regeneratePendingSettlements(groupId, client);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return listSettlements(groupId, requesterId);
}

/**
 * Mark a settlement payment completed, then refresh the remaining PENDING plan.
 * History is preserved: the COMPLETED row stays; only PENDING rows are rebuilt.
 */
export async function markSettlementCompleted(
  settlementId: string,
  requesterId: string
): Promise<SettlementDetail> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const existing = await client.query<SettlementRow>(
      `SELECT * FROM settlements WHERE id = $1 FOR UPDATE`,
      [settlementId]
    );
    if (existing.rowCount === 0) {
      throw notFound("Settlement not found");
    }

    const row = existing.rows[0];
    await assertGroupMember(row.group_id, requesterId, client);

    if (row.status !== "COMPLETED") {
      await client.query(
        `UPDATE settlements
         SET status = 'COMPLETED', completed_at = NOW()
         WHERE id = $1`,
        [settlementId]
      );
      await regeneratePendingSettlements(row.group_id, client);
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return getSettlementDetail(settlementId, requesterId);
}

async function getSettlementDetail(
  settlementId: string,
  requesterId: string
): Promise<SettlementDetail> {
  const result = await getPool().query<
    SettlementRow & { from_display_name: string; to_display_name: string }
  >(
    `SELECT s.*,
            fu.display_name AS from_display_name,
            tu.display_name AS to_display_name
     FROM settlements s
     INNER JOIN users fu ON fu.id = s.from_user_id
     INNER JOIN users tu ON tu.id = s.to_user_id
     WHERE s.id = $1`,
    [settlementId]
  );
  if (result.rowCount === 0) {
    throw notFound("Settlement not found");
  }
  await assertGroupMember(result.rows[0].group_id, requesterId);
  return mapSettlement(result.rows[0]);
}

function mapSettlement(
  row: SettlementRow & { from_display_name: string; to_display_name: string }
): SettlementDetail {
  return {
    id: row.id,
    groupId: row.group_id,
    fromUserId: row.from_user_id,
    fromDisplayName: row.from_display_name,
    toUserId: row.to_user_id,
    toDisplayName: row.to_display_name,
    amountCents: row.amount_cents,
    amount: centsToDollarString(row.amount_cents),
    status: row.status,
    createdAt: row.created_at.toISOString(),
    completedAt: row.completed_at ? row.completed_at.toISOString() : null,
  };
}

/**
 * Group summary: balances + settlements in one response (Group Page payload).
 */
export async function getGroupSummary(groupId: string, requesterId: string) {
  await assertGroupMember(groupId, requesterId);

  const balances = await fetchExpenseBalances(groupId);
  const completed = await fetchCompletedTransactions(groupId, getPool());
  const outstandingNets = applyCompletedSettlements(balances, completed);

  const nameRows = await getPool().query<{
    id: string;
    display_name: string;
  }>(
    `SELECT u.id, u.display_name
     FROM group_members gm
     INNER JOIN users u ON u.id = gm.user_id
     WHERE gm.group_id = $1`,
    [groupId]
  );
  const names = new Map(nameRows.rows.map((r) => [r.id, r.display_name]));
  const totalSpentCents = balances.reduce((s, b) => s + b.paidCents, 0);

  const settlements = await getOrRefreshSettlements(groupId, requesterId);

  return {
    groupId,
    totalSpentCents,
    totalSpent: centsToDollarString(totalSpentCents),
    members: balances.map((b) => {
      const outstanding = outstandingNets.find(
        (o) => o.memberId === b.memberId
      )!;
      return {
        userId: b.memberId,
        displayName: names.get(b.memberId) ?? b.memberId,
        paidCents: b.paidCents,
        shareCents: b.shareCents,
        netCents: b.netCents,
        outstandingNetCents: outstanding.netCents,
        paid: centsToDollarString(b.paidCents),
        share: centsToDollarString(b.shareCents),
        net: centsToDollarString(b.netCents),
        outstandingNet: centsToDollarString(outstanding.netCents),
      };
    }),
    settlements,
  };
}

/** Validate PATCH body without pulling in a schema library yet. */
export function parseSettlementStatusPatch(body: unknown): SettlementStatus {
  if (
    typeof body !== "object" ||
    body === null ||
    !("status" in body) ||
    (body as { status: unknown }).status !== "COMPLETED"
  ) {
    throw badRequest('Body must be { "status": "COMPLETED" }');
  }
  return "COMPLETED";
}
