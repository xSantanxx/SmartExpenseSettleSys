# Authentication & Authorization (Stage 6)

## Two different questions

| Concept | Question | How we answer it |
|---------|----------|------------------|
| **Authentication (AuthN)** | Who are you? | bcrypt password + JWT `Authorization: Bearer …` |
| **Authorization (AuthZ)** | Are you allowed to touch this group? | `group_members` row check (`assertGroupMember`) |

A valid JWT is not enough to read someone else’s group. Guessing a group UUID
still returns **403** (or **404** if the group doesn’t exist).

## Password storage

```
plaintext password  →  bcrypt.hash(password, 10)  →  users.password_hash
```

- Never store plaintext passwords.
- Verify with `bcrypt.compare` (constant-time) — never `===` on hashes.
- Login failures use one message: `"Invalid email or password"` so attackers
  cannot tell whether the email exists.

## JWT access tokens

After register/login the API returns:

```json
{
  "user": { "id": "...", "email": "...", "displayName": "..." },
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

Clients send:

```
Authorization: Bearer <token>
```

Payload (signed, not encrypted):

```json
{ "sub": "<user-uuid>", "email": "alice@example.com", "iat": …, "exp": … }
```

`JWT_SECRET` must be a long random string in any real deploy. Dev/test may use
the fallback in `src/config.ts`.

**Why JWT (not sessions) for this project?** Stateless tokens keep the API
simple (no session table). Tradeoff: revocation is harder until token expiry —
fine for a portfolio app; refresh tokens / a denylist would be the next step.

## Endpoints

| Method | Path | Auth? |
|--------|------|-------|
| `POST` | `/auth/register` | No |
| `POST` | `/auth/login` | No |
| `GET` | `/auth/me` | Bearer JWT |
| `GET` | `/users/me` | Bearer JWT (alias) |

## Interview talking points

- Difference between authentication and authorization
- Why hash passwords (and why bcrypt specifically: salted, slow by design)
- Why group membership is checked on every group route
- What happens if JWT_SECRET leaks (forge tokens → rotate secret, force re-login)
