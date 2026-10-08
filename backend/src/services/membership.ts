import type { Pool, PoolClient } from "pg";
import { forbidden, notFound } from "../errors/AppError.js";
import { getPool } from "../db/pool.js";

type Queryable = Pool | PoolClient;

/**
 * Authorization helper: the caller must belong to the group.
 * Returns quietly on success; throws 403/404 otherwise.
 *
 * We use 404 when the group does not exist (don't leak whether IDs are real
 * to outsiders), and 403 when the group exists but the user is not a member.
 */
export async function assertGroupMember(
  groupId: string,
  userId: string,
  db: Queryable = getPool()
): Promise<void> {
  const group = await db.query(`SELECT id FROM groups WHERE id = $1`, [groupId]);
  if (group.rowCount === 0) {
    throw notFound("Group not found");
  }

  const membership = await db.query(
    `SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2`,
    [groupId, userId]
  );
  if (membership.rowCount === 0) {
    throw forbidden("You are not a member of this group");
  }
}

export async function assertUsersAreMembers(
  groupId: string,
  userIds: string[],
  db: Queryable = getPool()
): Promise<void> {
  if (userIds.length === 0) return;

  const unique = [...new Set(userIds)];
  const result = await db.query<{ user_id: string }>(
    `SELECT user_id FROM group_members
     WHERE group_id = $1 AND user_id = ANY($2::uuid[])`,
    [groupId, unique]
  );

  if (result.rowCount !== unique.length) {
    const found = new Set(result.rows.map((r) => r.user_id));
    const missing = unique.filter((id) => !found.has(id));
    throw forbidden(
      `Users are not members of this group: ${missing.join(", ")}`
    );
  }
}
