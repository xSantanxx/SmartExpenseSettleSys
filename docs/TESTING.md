# Testing

## What we test and why

| Layer | Tooling | Purpose |
|-------|---------|---------|
| Domain (`money`, `balances`, `settlement`, subscription period) | Vitest unit tests | Algorithm correctness without I/O — interview-friendly |
| HTTP wiring | Supertest against `createApp()` | 401/404 paths that need no DB |
| API + Postgres | Supertest + **embedded PostgreSQL** | AuthZ, validation, transactions, settlement regeneration |

Domain tests stay independent of Express and the database so you can answer:
“How did you test the settlement logic?” without spinning up infrastructure.

## Commands

```bash
cd backend
npm test                 # unit + integration
npm run test:unit        # fast, no Postgres boot
npm run test:integration # embedded Postgres (no Docker required)
```

Integration tests download/start a real Postgres binary via `embedded-postgres`,
apply the same SQL migrations as production, then truncate tables between cases.

## Integration coverage (Stage 5)

- Duplicate email rejected (`citext` uniqueness)
- Group creator is auto-member
- Non-member gets **403** on group access
- Unknown group id → **404** (no existence leak)
- Equal-split expense → correct balances in cents
- Unequal split that doesn’t sum → **400**
- Non-member participant → **403**
- Settlement plan generated; mark **COMPLETED**; pending remainder updates
- Group summary payload
- Expense filter by member
- Delete expense regenerates (clears) settlements

## Interview talking points

- **Why embedded Postgres instead of mocks?** Mocks don’t exercise FKs,
  triggers, or transactions. We want the same integrity rules as production.
- **Why not only Docker Compose for tests?** Embedded Postgres works offline
  and in CI without a daemon. Compose remains the local *dev* database.
- **What about flaky concurrency tests?** We use `FOR UPDATE` when completing
  a settlement; true race-condition tests are optional hardening later.
