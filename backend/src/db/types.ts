/**
 * Row shapes that mirror the PostgreSQL schema.
 * These are persistence types — keep domain math in src/domain/.
 */

export type SplitMethod = "EQUAL" | "UNEQUAL" | "PERCENTAGE";
export type SettlementStatus = "PENDING" | "COMPLETED";

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  created_at: Date;
}

export interface GroupRow {
  id: string;
  name: string;
  created_by: string;
  created_at: Date;
}

export interface GroupMemberRow {
  group_id: string;
  user_id: string;
  joined_at: Date;
}

export interface ExpenseRow {
  id: string;
  group_id: string;
  description: string;
  amount_cents: number;
  paid_by: string;
  expense_date: string; // DATE → ISO date string from pg
  split_method: SplitMethod;
  created_by: string;
  created_at: Date;
}

export interface ExpenseParticipantRow {
  expense_id: string;
  user_id: string;
  share_cents: number;
  /** Unequal cents or percentage basis points; null for EQUAL. */
  split_input: number | null;
}

export interface SettlementRow {
  id: string;
  group_id: string;
  from_user_id: string;
  to_user_id: string;
  amount_cents: number;
  status: SettlementStatus;
  created_at: Date;
  completed_at: Date | null;
}

/**
 * Example balance aggregation query (implemented in Stage 3/4):
 *
 * paid  = SUM(expenses.amount_cents) GROUP BY paid_by
 * share = SUM(expense_participants.share_cents) GROUP BY user_id
 * net   = paid - share
 */
export interface GroupBalanceQueryRow {
  user_id: string;
  paid_cents: number;
  share_cents: number;
  net_cents: number;
}
