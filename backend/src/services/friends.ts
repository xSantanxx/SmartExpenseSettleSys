import { getPool } from "../db/pool.js";
import { badRequest, notFound } from "../errors/AppError.js";

export interface Friend {
  userId: string;
  email: string;
  displayName: string;
  addedAt: string;
}

export async function listFriends(userId: string): Promise<Friend[]> {
  const result = await getPool().query<{
    user_id: string;
    email: string;
    display_name: string;
    created_at: Date;
  }>(
    `SELECT u.id AS user_id, u.email, u.display_name, f.created_at
     FROM friendships f
     INNER JOIN users u ON u.id = f.friend_user_id
     WHERE f.user_id = $1
     ORDER BY u.display_name ASC`,
    [userId]
  );

  return result.rows.map((r) => ({
    userId: r.user_id,
    email: r.email,
    displayName: r.display_name,
    addedAt: r.created_at.toISOString(),
  }));
}

export async function isFriend(
  userId: string,
  friendUserId: string
): Promise<boolean> {
  const result = await getPool().query(
    `SELECT 1 FROM friendships WHERE user_id = $1 AND friend_user_id = $2`,
    [userId, friendUserId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function addFriendByEmail(
  userId: string,
  emailRaw: string
): Promise<Friend> {
  const email = emailRaw.trim().toLowerCase();
  if (!email) {
    throw badRequest("email is required");
  }

  const found = await getPool().query<{
    id: string;
    email: string;
    display_name: string;
  }>(`SELECT id, email, display_name FROM users WHERE email = $1`, [email]);

  if (found.rowCount === 0) {
    throw notFound("No account found with that email");
  }

  const friend = found.rows[0];
  if (friend.id === userId) {
    throw badRequest("You cannot add yourself as a friend");
  }

  await getPool().query(
    `INSERT INTO friendships (user_id, friend_user_id)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [userId, friend.id]
  );

  return {
    userId: friend.id,
    email: friend.email,
    displayName: friend.display_name,
    addedAt: new Date().toISOString(),
  };
}

export async function addFriendByUserId(
  userId: string,
  friendUserId: string
): Promise<Friend> {
  if (friendUserId === userId) {
    throw badRequest("You cannot add yourself as a friend");
  }

  const found = await getPool().query<{
    id: string;
    email: string;
    display_name: string;
  }>(`SELECT id, email, display_name FROM users WHERE id = $1`, [friendUserId]);

  if (found.rowCount === 0) {
    throw notFound("User not found");
  }

  await getPool().query(
    `INSERT INTO friendships (user_id, friend_user_id)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [userId, friendUserId]
  );

  const friend = found.rows[0];
  return {
    userId: friend.id,
    email: friend.email,
    displayName: friend.display_name,
    addedAt: new Date().toISOString(),
  };
}

export async function removeFriend(
  userId: string,
  friendUserId: string
): Promise<void> {
  const result = await getPool().query(
    `DELETE FROM friendships WHERE user_id = $1 AND friend_user_id = $2`,
    [userId, friendUserId]
  );
  if (result.rowCount === 0) {
    throw notFound("Friend not found");
  }
}
