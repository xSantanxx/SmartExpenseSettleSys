import { getPool } from "../db/pool.js";
import type {
  ExpenseParticipantRow,
  ExpenseRow,
  SplitMethod,
} from "../db/types.js";
import { computeExpenseShares } from "../domain/balances.js";
import { dollarsToCents } from "../domain/money.js";
import type { ExpenseInput } from "../domain/types.js";
import { badRequest, notFound } from "../errors/AppError.js";
import { assertGroupMember, assertUsersAreMembers } from "./membership.js";
import { regeneratePendingSettlements } from "./settlements.js";

export interface CreateExpenseInput {
  description: string;
  /** Dollar amount as string/number, converted to cents at the boundary. */
  amount: string | number;
  paidByUserId: string;
  expenseDate: string; // YYYY-MM-DD
  splitMethod: SplitMethod;
  participantIds: string[];
  /**
   * UNEQUAL: dollars per user (converted to cents).
   * PERCENTAGE: percent numbers that must sum to 100 (e.g. 50, 25, 25),
   *             stored internally as basis points.
   */
  splits?: Record<string, number | string>;
}

export interface ExpenseDetail {
  id: string;
  groupId: string;
  description: string;
  amountCents: number;
  amount: string;
  paidByUserId: string;
  expenseDate: string;
  splitMethod: SplitMethod;
  createdBy: string;
  createdAt: string;
  participants: Array<{
    userId: string;
    shareCents: number;
    share: string;
    splitInput: number | null;
  }>;
}

export interface ExpenseFilters {
  memberId?: string;
  fromDate?: string;
  toDate?: string;
  minAmountCents?: number;
  maxAmountCents?: number;
}

function centsToDollarString(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = (abs % 100).toString().padStart(2, "0");
  return `${neg ? "-" : ""}${whole}.${frac}`;
}

function mapExpense(
  expense: ExpenseRow,
  participants: ExpenseParticipantRow[]
): ExpenseDetail {
  return {
    id: expense.id,
    groupId: expense.group_id,
    description: expense.description,
    amountCents: expense.amount_cents,
    amount: centsToDollarString(expense.amount_cents),
    paidByUserId: expense.paid_by,
    expenseDate:
      typeof expense.expense_date === "string"
        ? expense.expense_date.slice(0, 10)
        : new Date(expense.expense_date).toISOString().slice(0, 10),
    splitMethod: expense.split_method,
    createdBy: expense.created_by,
    createdAt: expense.created_at.toISOString(),
    participants: participants.map((p) => ({
      userId: p.user_id,
      shareCents: p.share_cents,
      share: centsToDollarString(p.share_cents),
      splitInput: p.split_input,
    })),
  };
}

function buildDomainExpense(input: CreateExpenseInput): {
  domain: ExpenseInput;
  splitInputs: Record<string, number | null>;
} {
  const amountCents = dollarsToCents(input.amount);
  const description = input.description.trim();
  if (!description) {
    throw badRequest("description is required");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.expenseDate)) {
    throw badRequest("expenseDate must be YYYY-MM-DD");
  }
  if (!input.participantIds?.length) {
    throw badRequest("At least one participant is required");
  }

  const splitInputs: Record<string, number | null> = {};
  let splits: Record<string, number> | undefined;

  if (input.splitMethod === "EQUAL") {
    for (const id of input.participantIds) {
      splitInputs[id] = null;
    }
  } else if (input.splitMethod === "UNEQUAL") {
    if (!input.splits) {
      throw badRequest("splits are required for UNEQUAL expenses");
    }
    splits = {};
    for (const id of input.participantIds) {
      if (input.splits[id] === undefined) {
        throw badRequest(`Missing unequal split for participant ${id}`);
      }
      const cents = dollarsToCents(input.splits[id]);
      splits[id] = cents;
      splitInputs[id] = cents;
    }
  } else if (input.splitMethod === "PERCENTAGE") {
    if (!input.splits) {
      throw badRequest("splits are required for PERCENTAGE expenses");
    }
    splits = {};
    for (const id of input.participantIds) {
      if (input.splits[id] === undefined) {
        throw badRequest(`Missing percentage for participant ${id}`);
      }
      // Accept 50 meaning 50%, store as 5000 basis points.
      const percent = Number(input.splits[id]);
      if (!Number.isFinite(percent)) {
        throw badRequest(`Invalid percentage for participant ${id}`);
      }
      // Allow one decimal place of percent → integer basis points.
      const basisPoints = Math.round(percent * 100);
      splits[id] = basisPoints;
      splitInputs[id] = basisPoints;
    }
  } else {
    throw badRequest("splitMethod must be EQUAL, UNEQUAL, or PERCENTAGE");
  }

  const domain: ExpenseInput = {
    amountCents,
    paidByMemberId: input.paidByUserId,
    participantIds: input.participantIds,
    splitMethod: input.splitMethod,
    splits,
  };

  // Domain layer validates consistency (sums, positivity, etc.)
  computeExpenseShares(domain);

  return { domain, splitInputs };
}

/**
 * Atomically insert expense + participants.
 * Share cents are computed in the domain layer before the write so the DB
 * stores the final amounts and balance queries stay simple SUM aggregations.
 */
export async function createExpense(
  groupId: string,
  requesterId: string,
  input: CreateExpenseInput
): Promise<ExpenseDetail> {
  await assertGroupMember(groupId, requesterId);

  const { domain, splitInputs } = buildDomainExpense(input);
  const involved = [...new Set([input.paidByUserId, ...input.participantIds])];
  await assertUsersAreMembers(groupId, involved);

  const shares = computeExpenseShares(domain);

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const expenseResult = await client.query<ExpenseRow>(
      `INSERT INTO expenses (
         group_id, description, amount_cents, paid_by,
         expense_date, split_method, created_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        groupId,
        input.description.trim(),
        domain.amountCents,
        input.paidByUserId,
        input.expenseDate,
        input.splitMethod,
        requesterId,
      ]
    );
    const expense = expenseResult.rows[0];

    const participants: ExpenseParticipantRow[] = [];
    for (const userId of input.participantIds) {
      const row = await client.query<ExpenseParticipantRow>(
        `INSERT INTO expense_participants (expense_id, user_id, share_cents, split_input)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [expense.id, userId, shares[userId], splitInputs[userId]]
      );
      participants.push(row.rows[0]);
    }

    // Keep the settlement plan consistent with the new expense (same TX).
    await regeneratePendingSettlements(groupId, client);

    await client.query("COMMIT");
    return mapExpense(expense, participants);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function listExpenses(
  groupId: string,
  requesterId: string,
  filters: ExpenseFilters = {}
): Promise<ExpenseDetail[]> {
  await assertGroupMember(groupId, requesterId);

  const clauses = ["e.group_id = $1"];
  const params: unknown[] = [groupId];

  if (filters.memberId) {
    params.push(filters.memberId);
    clauses.push(
      `(e.paid_by = $${params.length} OR EXISTS (
          SELECT 1 FROM expense_participants ep2
          WHERE ep2.expense_id = e.id AND ep2.user_id = $${params.length}
        ))`
    );
  }
  if (filters.fromDate) {
    params.push(filters.fromDate);
    clauses.push(`e.expense_date >= $${params.length}`);
  }
  if (filters.toDate) {
    params.push(filters.toDate);
    clauses.push(`e.expense_date <= $${params.length}`);
  }
  if (filters.minAmountCents !== undefined) {
    params.push(filters.minAmountCents);
    clauses.push(`e.amount_cents >= $${params.length}`);
  }
  if (filters.maxAmountCents !== undefined) {
    params.push(filters.maxAmountCents);
    clauses.push(`e.amount_cents <= $${params.length}`);
  }

  const expenses = await getPool().query<ExpenseRow>(
    `SELECT e.* FROM expenses e
     WHERE ${clauses.join(" AND ")}
     ORDER BY e.expense_date DESC, e.created_at DESC`,
    params
  );

  return attachParticipants(expenses.rows);
}

export async function getExpense(
  groupId: string,
  expenseId: string,
  requesterId: string
): Promise<ExpenseDetail> {
  await assertGroupMember(groupId, requesterId);

  const result = await getPool().query<ExpenseRow>(
    `SELECT * FROM expenses WHERE id = $1 AND group_id = $2`,
    [expenseId, groupId]
  );
  if (result.rowCount === 0) {
    throw notFound("Expense not found");
  }
  const [detail] = await attachParticipants(result.rows);
  return detail;
}

export async function deleteExpense(
  groupId: string,
  expenseId: string,
  requesterId: string
): Promise<void> {
  await assertGroupMember(groupId, requesterId);

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const result = await client.query(
      `DELETE FROM expenses WHERE id = $1 AND group_id = $2`,
      [expenseId, groupId]
    );
    if (result.rowCount === 0) {
      throw notFound("Expense not found");
    }

    await regeneratePendingSettlements(groupId, client);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function attachParticipants(
  expenses: ExpenseRow[]
): Promise<ExpenseDetail[]> {
  if (expenses.length === 0) return [];

  const ids = expenses.map((e) => e.id);
  const participants = await getPool().query<ExpenseParticipantRow>(
    `SELECT * FROM expense_participants WHERE expense_id = ANY($1::uuid[])`,
    [ids]
  );

  const byExpense = new Map<string, ExpenseParticipantRow[]>();
  for (const p of participants.rows) {
    const list = byExpense.get(p.expense_id) ?? [];
    list.push(p);
    byExpense.set(p.expense_id, list);
  }

  return expenses.map((e) => mapExpense(e, byExpense.get(e.id) ?? []));
}

/**
 * Aggregate paid / share / net for every group member.
 * Uses persisted share_cents — no re-deriving split math in SQL.
 */
export async function getGroupBalances(
  groupId: string,
  requesterId: string
): Promise<
  Array<{
    userId: string;
    displayName: string;
    paidCents: number;
    shareCents: number;
    netCents: number;
    paid: string;
    share: string;
    net: string;
  }>
> {
  await assertGroupMember(groupId, requesterId);

  const result = await getPool().query<{
    user_id: string;
    display_name: string;
    paid_cents: string | number;
    share_cents: string | number;
    net_cents: string | number;
  }>(
    `WITH members AS (
       SELECT gm.user_id, u.display_name
       FROM group_members gm
       INNER JOIN users u ON u.id = gm.user_id
       WHERE gm.group_id = $1
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
       m.display_name,
       COALESCE(p.paid_cents, 0) AS paid_cents,
       COALESCE(s.share_cents, 0) AS share_cents,
       COALESCE(p.paid_cents, 0) - COALESCE(s.share_cents, 0) AS net_cents
     FROM members m
     LEFT JOIN paid p ON p.user_id = m.user_id
     LEFT JOIN share s ON s.user_id = m.user_id
     ORDER BY m.display_name ASC`,
    [groupId]
  );

  return result.rows.map((r) => {
    const paidCents = Number(r.paid_cents);
    const shareCents = Number(r.share_cents);
    const netCents = Number(r.net_cents);
    return {
      userId: r.user_id,
      displayName: r.display_name,
      paidCents,
      shareCents,
      netCents,
      paid: centsToDollarString(paidCents),
      share: centsToDollarString(shareCents),
      net: centsToDollarString(netCents),
    };
  });
}
