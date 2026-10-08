import { getPool } from "../db/pool.js";
import type { GroupRow } from "../db/types.js";
import { badRequest, forbidden, notFound } from "../errors/AppError.js";
import { assertGroupMember } from "./membership.js";

export interface GroupSummary {
  id: string;
  name: string;
  createdBy: string;
  createdAt: string;
  memberCount: number;
}

export interface GroupDetail extends GroupSummary {
  members: Array<{
    userId: string;
    displayName: string;
    email: string;
    joinedAt: string;
  }>;
}

function mapSummary(row: GroupRow & { member_count: string | number }): GroupSummary {
  return {
    id: row.id,
    name: row.name,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
    memberCount: Number(row.member_count),
  };
}

/** Create a group and add the creator as the first member (one transaction). */
export async function createGroup(
  name: string,
  createdBy: string
): Promise<GroupDetail> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw badRequest("Group name is required");
  }

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const groupResult = await client.query<GroupRow>(
      `INSERT INTO groups (name, created_by) VALUES ($1, $2) RETURNING *`,
      [trimmed, createdBy]
    );
    const group = groupResult.rows[0];

    await client.query(
      `INSERT INTO group_members (group_id, user_id) VALUES ($1, $2)`,
      [group.id, createdBy]
    );

    await client.query("COMMIT");
    return getGroup(group.id, createdBy);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function listGroupsForUser(userId: string): Promise<GroupSummary[]> {
  const result = await getPool().query<GroupRow & { member_count: string }>(
    `SELECT g.*, COUNT(gm2.user_id)::int AS member_count
     FROM groups g
     INNER JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = $1
     INNER JOIN group_members gm2 ON gm2.group_id = g.id
     GROUP BY g.id
     ORDER BY g.created_at DESC`,
    [userId]
  );
  return result.rows.map(mapSummary);
}

export async function getGroup(
  groupId: string,
  requesterId: string
): Promise<GroupDetail> {
  await assertGroupMember(groupId, requesterId);

  const pool = getPool();
  const groupResult = await pool.query<GroupRow & { member_count: string }>(
    `SELECT g.*, COUNT(gm.user_id)::int AS member_count
     FROM groups g
     INNER JOIN group_members gm ON gm.group_id = g.id
     WHERE g.id = $1
     GROUP BY g.id`,
    [groupId]
  );
  if (groupResult.rowCount === 0) {
    throw notFound("Group not found");
  }

  const members = await pool.query<{
    user_id: string;
    display_name: string;
    email: string;
    joined_at: Date;
  }>(
    `SELECT u.id AS user_id, u.display_name, u.email, gm.joined_at
     FROM group_members gm
     INNER JOIN users u ON u.id = gm.user_id
     WHERE gm.group_id = $1
     ORDER BY gm.joined_at ASC`,
    [groupId]
  );

  return {
    ...mapSummary(groupResult.rows[0]),
    members: members.rows.map((m) => ({
      userId: m.user_id,
      displayName: m.display_name,
      email: m.email,
      joinedAt: m.joined_at.toISOString(),
    })),
  };
}

export async function deleteGroup(
  groupId: string,
  requesterId: string
): Promise<void> {
  await assertGroupMember(groupId, requesterId);

  const result = await getPool().query(
    `DELETE FROM groups WHERE id = $1 AND created_by = $2`,
    [groupId, requesterId]
  );
  if (result.rowCount === 0) {
    // Member but not creator
    throw forbidden("Only the group creator can delete the group");
  }
}

export interface AddMemberInput {
  /** Preferred: look up an existing account by email. */
  email?: string;
  /** Optional fallback (API/scripts). */
  userId?: string;
}

/**
 * Add an existing user to the group.
 * Primary UX: `{ email }` — we resolve it to a user id server-side.
 */
export async function addMember(
  groupId: string,
  requesterId: string,
  input: AddMemberInput
): Promise<GroupDetail> {
  await assertGroupMember(groupId, requesterId);

  let newUserId = input.userId?.trim();

  if (input.email?.trim()) {
    const email = input.email.trim().toLowerCase();
    const byEmail = await getPool().query<{ id: string }>(
      `SELECT id FROM users WHERE email = $1`,
      [email]
    );
    if (byEmail.rowCount === 0) {
      throw notFound("No account found with that email");
    }
    newUserId = byEmail.rows[0].id;
  }

  if (!newUserId) {
    throw badRequest("Provide email (or userId) to add a member");
  }

  if (newUserId === requesterId) {
    // Already a member if they can call this — treat as success.
    return getGroup(groupId, requesterId);
  }

  const user = await getPool().query(`SELECT id FROM users WHERE id = $1`, [
    newUserId,
  ]);
  if (user.rowCount === 0) {
    throw notFound("User not found");
  }

  try {
    await getPool().query(
      `INSERT INTO group_members (group_id, user_id) VALUES ($1, $2)`,
      [groupId, newUserId]
    );
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "23505"
    ) {
      // already a member — idempotent success
    } else {
      throw err;
    }
  }

  return getGroup(groupId, requesterId);
}

export async function removeMember(
  groupId: string,
  requesterId: string,
  memberId: string
): Promise<void> {
  await assertGroupMember(groupId, requesterId);

  const group = await getPool().query<GroupRow>(
    `SELECT * FROM groups WHERE id = $1`,
    [groupId]
  );
  if (group.rows[0]?.created_by === memberId) {
    throw badRequest("Cannot remove the group creator");
  }

  const result = await getPool().query(
    `DELETE FROM group_members WHERE group_id = $1 AND user_id = $2`,
    [groupId, memberId]
  );
  if (result.rowCount === 0) {
    throw notFound("Member not found in this group");
  }
}
