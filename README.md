# Smart Expense Settlement System

A portfolio web app that helps groups settle shared expenses with an optimized
payment plan — not just another expense CRUD tracker.

**Core idea:** record who paid and who benefited, compute each person’s net
balance in integer cents, then generate a short list of “X pays Y $Z”
transactions so the group is fully settled.

## Current status

**Stages 7–8 complete** — React UI connected to the API via Vite proxy.

| Stage | Status |
|-------|--------|
| 1. Settlement algorithm | Done |
| 2. Database schema | Done |
| 3. Backend + expenses | Done |
| 4. Wire settlements into API | Done |
| 5. Broader tests | Done |
| 6. Auth / authorization | Done |
| 7–8. React frontend | Done |
| 9. Deploy / ops | Guide ready — see docs/DEPLOY.md |

## Quick start

```bash
# Terminal 1 — API
cd backend
npm install
cp .env.example .env   # if needed
npm run db:up && npm run db:migrate
npm run dev            # http://localhost:3001

# Terminal 2 — UI
cd frontend
npm install
npm run dev            # http://localhost:5173  (proxies /api → :3001)
```

See [docs/API.md](docs/API.md), [docs/AUTH.md](docs/AUTH.md), [docs/TESTING.md](docs/TESTING.md),
and [docs/DEPLOY.md](docs/DEPLOY.md) (Neon + Render + Vercel).

## Project layout

```
backend/                     # Express + Postgres API
frontend/                    # React (Vite) UI
docs/                        # Algorithm, schema, API, auth, testing
docker-compose.yml           # Local Postgres 16
```

**Layering:** React → `/api` proxy → Express routes → services → domain + SQL.
Auth is JWT + bcrypt; group access still goes through `group_members`.

## Stack (planned)

- **Backend:** Node.js, Express, TypeScript, PostgreSQL
- **Frontend:** React
- **Auth:** hashed passwords + token/session auth with group-level authorization

## Docs

- [Settlement algorithm](docs/SETTLEMENT_ALGORITHM.md) — how nets and settlements work, complexity, interview notes
