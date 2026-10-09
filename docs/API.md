# API (Stage 6)

Base URL: `http://localhost:3001`

## Authentication

Register or log in to receive a JWT, then send it on every protected request:

```
Authorization: Bearer <token>
```

```bash
curl -s -X POST localhost:3001/auth/register -H 'content-type: application/json' \
  -d '{"email":"alice@example.com","displayName":"Alice","password":"password123"}'
# → { "user": {...}, "token": "eyJ..." }
```

**Authorization is separate:** every group route still checks `group_members`.
A valid token is not enough to access a group you do not belong to.

See [AUTH.md](AUTH.md) for bcrypt/JWT details.

## Endpoints

### Health

`GET /health` → `{ "status": "ok" }`

### Auth

| Method | Path | Body |
|--------|------|------|
| `POST` | `/auth/register` | `{ "email", "displayName", "password" }` → `{ user, token }` |
| `POST` | `/auth/login` | `{ "email", "password" }` → `{ user, token }` |
| `GET` | `/auth/me` | Bearer token → current user |

`GET /users/me` is an alias for `/auth/me`.

### Friends (contacts)

Personal list for quickly adding people to groups. Directed: saving Bob does
not automatically save Alice on Bob’s side.

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/friends` | Your friends |
| `POST` | `/friends` | `{ "email" }` or `{ "userId" }` |
| `DELETE` | `/friends/:friendUserId` | Remove from your list |

### Groups

| Method | Path | Notes |
|--------|------|-------|
| `POST` | `/groups` | `{ "name": "NYC Trip" }` — creator becomes first member |
| `GET` | `/groups` | Groups you belong to |
| `GET` | `/groups/:groupId` | Detail + members |
| `DELETE` | `/groups/:groupId` | Creator only |
| `POST` | `/groups/:groupId/members` | `{ "email": "bob@example.com" }` (or `{ "userId" }`) |
| `DELETE` | `/groups/:groupId/members/:memberId` | Cannot remove creator |

### Expenses

`POST /groups/:groupId/expenses`

Equal split:

```json
{
  "description": "Dinner",
  "amount": "120.00",
  "paidByUserId": "<alice-uuid>",
  "expenseDate": "2026-10-01",
  "splitMethod": "EQUAL",
  "participantIds": ["<alice>", "<bob>", "<charlie>", "<david>"]
}
```

Unequal:

```json
{
  "description": "Groceries",
  "amount": "100.00",
  "paidByUserId": "<alice-uuid>",
  "expenseDate": "2026-10-02",
  "splitMethod": "UNEQUAL",
  "participantIds": ["<alice>", "<bob>", "<charlie>"],
  "splits": { "<alice>": "50.00", "<bob>": "25.00", "<charlie>": "25.00" }
}
```

Percentage (values are percents; must total 100):

```json
{
  "description": "Airbnb",
  "amount": "400.00",
  "paidByUserId": "<alice-uuid>",
  "expenseDate": "2026-10-03",
  "splitMethod": "PERCENTAGE",
  "participantIds": ["<alice>", "<bob>"],
  "splits": { "<alice>": 50, "<bob>": 50 }
}
```

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/groups/:groupId/expenses` | Filters: `memberId`, `fromDate`, `toDate`, `minAmount`, `maxAmount` |
| `GET` | `/groups/:groupId/expenses/:expenseId` | |
| `DELETE` | `/groups/:groupId/expenses/:expenseId` | Cascades participants |
| `GET` | `/groups/:groupId/balances` | paid / share / net per member |
| `GET` | `/groups/:groupId/settlements` | Regenerates PENDING, returns plan + history. Optional `?status=PENDING\|COMPLETED` |
| `GET` | `/groups/:groupId/summary` | Totals, per-member balances, settlements |

### Shared subscriptions (per group)

Even split of a recurring bill (Netflix, Spotify, etc.).

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/groups/:groupId/subscriptions` | Active subscriptions + current period |
| `POST` | `/groups/:groupId/subscriptions` | `{ name, amount, billingDay (1–28), memberIds[] }` |
| `POST` | `/groups/:groupId/subscriptions/:id/members` | `{ email }` or `{ userId }` — shares rebalance |
| `DELETE` | `/groups/:groupId/subscriptions/:id/members/:memberId` | Shares rebalance |
| `POST` | `/groups/:groupId/subscriptions/:id/pay` | Mark **your** share paid this period |
| `DELETE` | `/groups/:groupId/subscriptions/:id` | Soft-end (deactivate) |

Reminders (server cron):

`POST /cron/subscription-reminders` with header `X-Cron-Secret: <CRON_SECRET>`  
Emails unpaid members within 3 days of billing day when `RESEND_API_KEY` is set.

### Settlements

`PATCH /settlements/:settlementId`

```json
{ "status": "COMPLETED" }
```

Marks that payment done. The row stays as history (`COMPLETED`). Remaining
`PENDING` rows for the group are regenerated from updated outstanding nets.

Creating or deleting an expense also regenerates `PENDING` settlements inside
the same database transaction.

Example settlement response:

```json
{
  "id": "...",
  "fromUserId": "...",
  "fromDisplayName": "Bob",
  "toUserId": "...",
  "toDisplayName": "Alice",
  "amount": "45.50",
  "amountCents": 4550,
  "status": "PENDING",
  "completedAt": null
}
```

## Error shape

```json
{
  "error": {
    "message": "You are not a member of this group",
    "code": "FORBIDDEN"
  }
}
```

| Status | Meaning |
|--------|---------|
| 400 | Invalid input / failed domain validation |
| 401 | Missing/invalid Bearer JWT |
| 403 | Authenticated but not allowed |
| 404 | Missing resource (or hidden from non-members) |
| 409 | Conflict (e.g. duplicate email) |
| 500 | Unexpected server error (no internals leaked) |

## Manual smoke script

```bash
cd backend && ./scripts/smoke.sh
```

After creating expenses, call `GET /groups/:id/settlements` or `/summary`,
then `PATCH /settlements/:id` with `{ "status": "COMPLETED" }` as people pay.
