import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";
import { getTestDb, type TestDb } from "./test/harness.js";

type TestUser = {
  id: string;
  email: string;
  displayName: string;
  token: string;
};

/**
 * API integration tests against a real (embedded) PostgreSQL.
 * Covers auth (JWT), authorization, expenses, balances, and settlements.
 */
describe("API integration", () => {
  let db: TestDb;
  const app = createApp();

  beforeAll(async () => {
    db = await getTestDb();
  }, 120_000);

  afterAll(async () => {
    if (db) await db.stop();
  });

  beforeEach(async () => {
    await db.resetData();
  });

  async function registerUser(
    email: string,
    displayName: string
  ): Promise<TestUser> {
    const res = await request(app).post("/auth/register").send({
      email,
      displayName,
      password: "password123",
    });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    return {
      id: res.body.user.id as string,
      email: res.body.user.email as string,
      displayName: res.body.user.displayName as string,
      token: res.body.token as string,
    };
  }

  function auth(token: string) {
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  }

  /** Look up the token for whoever owes a settlement payment. */
  function tokenFor(
    users: TestUser[],
    userId: string
  ): string {
    const user = users.find((u) => u.id === userId);
    if (!user) throw new Error(`No token for user ${userId}`);
    return user.token;
  }

  it("registers and logs in with JWT", async () => {
    const registered = await registerUser("alice@example.com", "Alice");

    const login = await request(app).post("/auth/login").send({
      email: "alice@example.com",
      password: "password123",
    });
    expect(login.status).toBe(200);
    expect(login.body.user.id).toBe(registered.id);
    expect(login.body.token).toBeTruthy();

    const me = await request(app)
      .get("/auth/me")
      .set(auth(login.body.token));
    expect(me.status).toBe(200);
    expect(me.body.email).toBe("alice@example.com");
  });

  it("rejects bad login credentials with a generic 401", async () => {
    await registerUser("alice@example.com", "Alice");
    const res = await request(app).post("/auth/login").send({
      email: "alice@example.com",
      password: "wrong-password",
    });
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe("Invalid email or password");
  });

  it("rejects duplicate emails", async () => {
    await registerUser("alice@example.com", "Alice");
    const dup = await request(app).post("/auth/register").send({
      email: "Alice@example.com",
      displayName: "Alice 2",
      password: "password123",
    });
    expect(dup.status).toBe(409);
  });

  it("creates a group with the creator as the only member", async () => {
    const alice = await registerUser("alice@example.com", "Alice");
    const res = await request(app)
      .post("/groups")
      .set(auth(alice.token))
      .send({ name: "NYC Trip" });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe("NYC Trip");
    expect(res.body.members).toHaveLength(1);
    expect(res.body.members[0].userId).toBe(alice.id);
  });

  it("manages a friends list and uses it when adding members", async () => {
    const alice = await registerUser("alice@example.com", "Alice");
    const bob = await registerUser("bob@example.com", "Bob");

    const added = await request(app)
      .post("/friends")
      .set(auth(alice.token))
      .send({ email: "bob@example.com" });
    expect(added.status).toBe(201);
    expect(added.body.userId).toBe(bob.id);

    const list = await request(app).get("/friends").set(auth(alice.token));
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);

    const group = await request(app)
      .post("/groups")
      .set(auth(alice.token))
      .send({ name: "Friends Trip" });

    const member = await request(app)
      .post(`/groups/${group.body.id}/members`)
      .set(auth(alice.token))
      .send({ email: bob.email });
    expect(member.status).toBe(201);

    await request(app)
      .delete(`/friends/${bob.id}`)
      .set(auth(alice.token))
      .expect(204);
  });

  it("adds a member by email", async () => {
    const alice = await registerUser("alice@example.com", "Alice");
    const bob = await registerUser("bob@example.com", "Bob");
    const group = await request(app)
      .post("/groups")
      .set(auth(alice.token))
      .send({ name: "Roommates" });

    const added = await request(app)
      .post(`/groups/${group.body.id}/members`)
      .set(auth(alice.token))
      .send({ email: "Bob@example.com" }); // citext / case-insensitive

    expect(added.status).toBe(201);
    expect(added.body.members.map((m: { userId: string }) => m.userId)).toEqual(
      expect.arrayContaining([alice.id, bob.id])
    );

    const missing = await request(app)
      .post(`/groups/${group.body.id}/members`)
      .set(auth(alice.token))
      .send({ email: "nobody@example.com" });
    expect(missing.status).toBe(404);
  });

  it("forbids non-members from reading a group (authorization)", async () => {
    const alice = await registerUser("alice@example.com", "Alice");
    const bob = await registerUser("bob@example.com", "Bob");

    const group = await request(app)
      .post("/groups")
      .set(auth(alice.token))
      .send({ name: "Secret Trip" });

    const denied = await request(app)
      .get(`/groups/${group.body.id}`)
      .set(auth(bob.token));

    expect(denied.status).toBe(403);
    expect(denied.body.error.code).toBe("FORBIDDEN");
  });

  it("returns 404 for unknown groups instead of leaking existence to outsiders", async () => {
    const bob = await registerUser("bob@example.com", "Bob");
    const res = await request(app)
      .get("/groups/00000000-0000-4000-8000-000000000099")
      .set(auth(bob.token));
    expect(res.status).toBe(404);
  });

  it("records an equal-split expense and computes balances", async () => {
    const alice = await registerUser("alice@example.com", "Alice");
    const bob = await registerUser("bob@example.com", "Bob");

    const group = await request(app)
      .post("/groups")
      .set(auth(alice.token))
      .send({ name: "Dinner" });
    const groupId = group.body.id as string;

    await request(app)
      .post(`/groups/${groupId}/members`)
      .set(auth(alice.token))
      .send({ email: bob.email });

    const expense = await request(app)
      .post(`/groups/${groupId}/expenses`)
      .set(auth(alice.token))
      .send({
        description: "Pizza",
        amount: "100.00",
        paidByUserId: alice.id,
        expenseDate: "2026-10-01",
        splitMethod: "EQUAL",
        participantIds: [alice.id, bob.id],
      });

    expect(expense.status).toBe(201);
    expect(expense.body.amountCents).toBe(10000);

    const balances = await request(app)
      .get(`/groups/${groupId}/balances`)
      .set(auth(alice.token));

    const byId = Object.fromEntries(
      balances.body.map((b: { userId: string; netCents: number }) => [
        b.userId,
        b.netCents,
      ])
    );
    expect(byId[alice.id]).toBe(5000);
    expect(byId[bob.id]).toBe(-5000);
  });

  it("rejects unequal splits that do not sum to the expense amount", async () => {
    const alice = await registerUser("alice@example.com", "Alice");
    const bob = await registerUser("bob@example.com", "Bob");
    const group = await request(app)
      .post("/groups")
      .set(auth(alice.token))
      .send({ name: "Bad Split" });
    await request(app)
      .post(`/groups/${group.body.id}/members`)
      .set(auth(alice.token))
      .send({ email: bob.email });

    const res = await request(app)
      .post(`/groups/${group.body.id}/expenses`)
      .set(auth(alice.token))
      .send({
        description: "Broken",
        amount: "100.00",
        paidByUserId: alice.id,
        expenseDate: "2026-10-01",
        splitMethod: "UNEQUAL",
        participantIds: [alice.id, bob.id],
        splits: { [alice.id]: "60.00", [bob.id]: "30.00" },
      });

    expect(res.status).toBe(400);
  });

  it("rejects expenses that include a non-member participant", async () => {
    const alice = await registerUser("alice@example.com", "Alice");
    const outsider = await registerUser("eve@example.com", "Eve");
    const group = await request(app)
      .post("/groups")
      .set(auth(alice.token))
      .send({ name: "Closed" });

    const res = await request(app)
      .post(`/groups/${group.body.id}/expenses`)
      .set(auth(alice.token))
      .send({
        description: "Nope",
        amount: "20.00",
        paidByUserId: alice.id,
        expenseDate: "2026-10-01",
        splitMethod: "EQUAL",
        participantIds: [alice.id, outsider.id],
      });

    expect(res.status).toBe(403);
  });

  it("generates a settlement plan and marks a payment completed", async () => {
    const alice = await registerUser("alice@example.com", "Alice");
    const bob = await registerUser("bob@example.com", "Bob");
    const charlie = await registerUser("charlie@example.com", "Charlie");
    const users = [alice, bob, charlie];

    const group = await request(app)
      .post("/groups")
      .set(auth(alice.token))
      .send({ name: "Trip" });
    const groupId = group.body.id as string;

    for (const user of [bob, charlie]) {
      await request(app)
        .post(`/groups/${groupId}/members`)
        .set(auth(alice.token))
        .send({ email: user.email });
    }

    await request(app)
      .post(`/groups/${groupId}/expenses`)
      .set(auth(alice.token))
      .send({
        description: "Hotel",
        amount: "90.00",
        paidByUserId: alice.id,
        expenseDate: "2026-10-02",
        splitMethod: "EQUAL",
        participantIds: [alice.id, bob.id, charlie.id],
      });

    const settlements = await request(app)
      .get(`/groups/${groupId}/settlements`)
      .set(auth(alice.token));

    expect(settlements.status).toBe(200);
    expect(settlements.body.length).toBeGreaterThanOrEqual(2);

    const totalPending = settlements.body.reduce(
      (s: number, tx: { amountCents: number }) => s + tx.amountCents,
      0
    );
    expect(totalPending).toBe(6000);

    const first = settlements.body[0];
    const completed = await request(app)
      .patch(`/settlements/${first.id}`)
      .set(auth(tokenFor(users, first.fromUserId)))
      .send({ status: "COMPLETED" });

    expect(completed.status).toBe(200);
    expect(completed.body.status).toBe("COMPLETED");

    const after = await request(app)
      .get(`/groups/${groupId}/settlements`)
      .set(auth(alice.token));

    const pending = after.body.filter(
      (s: { status: string }) => s.status === "PENDING"
    );
    const done = after.body.filter(
      (s: { status: string }) => s.status === "COMPLETED"
    );

    expect(done).toHaveLength(1);
    expect(
      pending.reduce(
        (s: number, t: { amountCents: number }) => s + t.amountCents,
        0
      )
    ).toBe(6000 - first.amountCents);
  });

  it("summary endpoint includes totals, members, and settlements", async () => {
    const alice = await registerUser("alice@example.com", "Alice");
    const bob = await registerUser("bob@example.com", "Bob");
    const group = await request(app)
      .post("/groups")
      .set(auth(alice.token))
      .send({ name: "Summary" });
    await request(app)
      .post(`/groups/${group.body.id}/members`)
      .set(auth(alice.token))
      .send({ email: bob.email });

    await request(app)
      .post(`/groups/${group.body.id}/expenses`)
      .set(auth(alice.token))
      .send({
        description: "Taxi",
        amount: "40.00",
        paidByUserId: alice.id,
        expenseDate: "2026-10-03",
        splitMethod: "EQUAL",
        participantIds: [alice.id, bob.id],
      });

    const summary = await request(app)
      .get(`/groups/${group.body.id}/summary`)
      .set(auth(alice.token));

    expect(summary.status).toBe(200);
    expect(summary.body.totalSpentCents).toBe(4000);
    expect(summary.body.members).toHaveLength(2);
    expect(summary.body.settlements.length).toBeGreaterThanOrEqual(1);
  });

  it("filters expenses by member", async () => {
    const alice = await registerUser("alice@example.com", "Alice");
    const bob = await registerUser("bob@example.com", "Bob");
    const group = await request(app)
      .post("/groups")
      .set(auth(alice.token))
      .send({ name: "Filter" });
    await request(app)
      .post(`/groups/${group.body.id}/members`)
      .set(auth(alice.token))
      .send({ email: bob.email });

    await request(app)
      .post(`/groups/${group.body.id}/expenses`)
      .set(auth(alice.token))
      .send({
        description: "Alice only lunch",
        amount: "12.00",
        paidByUserId: alice.id,
        expenseDate: "2026-10-04",
        splitMethod: "EQUAL",
        participantIds: [alice.id],
      });

    await request(app)
      .post(`/groups/${group.body.id}/expenses`)
      .set(auth(alice.token))
      .send({
        description: "Shared",
        amount: "30.00",
        paidByUserId: bob.id,
        expenseDate: "2026-10-04",
        splitMethod: "EQUAL",
        participantIds: [alice.id, bob.id],
      });

    const bobOnly = await request(app)
      .get(`/groups/${group.body.id}/expenses`)
      .query({ memberId: bob.id })
      .set(auth(alice.token));

    expect(bobOnly.status).toBe(200);
    expect(bobOnly.body).toHaveLength(1);
    expect(bobOnly.body[0].description).toBe("Shared");
  });

  it("regenerates settlements after deleting an expense", async () => {
    const alice = await registerUser("alice@example.com", "Alice");
    const bob = await registerUser("bob@example.com", "Bob");
    const group = await request(app)
      .post("/groups")
      .set(auth(alice.token))
      .send({ name: "Delete expense" });
    await request(app)
      .post(`/groups/${group.body.id}/members`)
      .set(auth(alice.token))
      .send({ email: bob.email });

    const expense = await request(app)
      .post(`/groups/${group.body.id}/expenses`)
      .set(auth(alice.token))
      .send({
        description: "Temp",
        amount: "50.00",
        paidByUserId: alice.id,
        expenseDate: "2026-10-05",
        splitMethod: "EQUAL",
        participantIds: [alice.id, bob.id],
      });

    const before = await request(app)
      .get(`/groups/${group.body.id}/settlements`)
      .set(auth(alice.token));
    expect(before.body.length).toBe(1);

    await request(app)
      .delete(`/groups/${group.body.id}/expenses/${expense.body.id}`)
      .set(auth(alice.token));

    const after = await request(app)
      .get(`/groups/${group.body.id}/settlements`)
      .set(auth(alice.token));
    expect(after.body).toEqual([]);
  });
});
