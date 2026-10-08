# Deploy guide

You need **three** hosted pieces:

```
Browser  →  React (static)  →  Express API  →  PostgreSQL
              Vercel             Render           Neon
```

This guide uses a free-tier combo that works well for a portfolio project.
Alternatives (Railway, Fly.io, Netlify, Supabase) are fine — same env vars.

---

## 1. Database (Neon)

1. Create a project at [https://neon.tech](https://neon.tech).
2. Copy the connection string (`postgresql://...`).
3. Keep it handy as `DATABASE_URL`.

You do **not** need Docker in production. Neon *is* your Postgres.

---

## 2. API (Render)

1. Push this repo to GitHub (if it isn’t already).
2. On [https://render.com](https://render.com) → **New → Web Service**.
3. Connect the repo.
4. Settings:

| Field | Value |
|-------|--------|
| Root directory | `backend` |
| Runtime | Node |
| Build command | `npm install` *(do not use `npm run build` / tsc)* |
| Start command | `npm start` |
| Instance | Free |

5. Environment variables:

| Name | Value |
|------|--------|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Neon connection string |
| `JWT_SECRET` | long random string (e.g. `openssl rand -hex 32`) |
| `FRONTEND_ORIGIN` | *(leave blank for now; set after Vercel URL exists)* |

6. Deploy. Note the API URL, e.g. `https://sess-api.onrender.com`.
7. Check `https://sess-api.onrender.com/health` → `{ "status": "ok" }`.

`npm start` runs migrations, then the server. Free Render services sleep when idle; the first request after sleep can take ~30s.

---

## 3. Frontend (Vercel)

1. On [https://vercel.com](https://vercel.com) → **Add New Project** → import the same repo.
2. Settings:

| Field | Value |
|-------|--------|
| Root directory | `frontend` |
| Framework | Vite |
| Build command | `npm run build` |
| Output | `dist` |

3. Environment variable (Production):

| Name | Value |
|------|--------|
| `VITE_API_BASE_URL` | `https://sess-api.onrender.com` *(your Render URL, no trailing slash)* |

4. Deploy. Note the site URL, e.g. `https://smart-expense.vercel.app`.

---

## 4. Connect CORS

Back on Render, set:

```
FRONTEND_ORIGIN=https://smart-expense.vercel.app
```

Redeploy the API (or restart). Then open the Vercel site, register a user, and try creating a group.

---

## Checklist

- [ ] Neon `DATABASE_URL` works
- [ ] Render `/health` returns ok
- [ ] Vercel loads the UI
- [ ] Register/login works (JWT)
- [ ] Creating a group works (proves API + CORS + DB)

---

## Interview talking points

- **Why split frontend and API?** Static hosting is cheap/CDN-friendly; the API needs a long-running Node process and DB secrets.
- **Why managed Postgres?** Backups, SSL, no ops. Same SQL schema as local Docker.
- **Secrets:** `JWT_SECRET` and `DATABASE_URL` never go in the frontend build — only on the API host.
- **CORS:** browsers block cross-origin API calls unless the API allowlists the frontend origin.

---

## Local vs production

| | Local | Production |
|--|-------|------------|
| DB | Docker Postgres | Neon |
| API | `npm run dev` on :3001 | Render |
| UI | Vite `:5173` + `/api` proxy | Vercel + `VITE_API_BASE_URL` |
