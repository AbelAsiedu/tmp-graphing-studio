# Authentication & permissions

The Studio **does not store passwords or run a second login system**. People sign in on TMP; TMP then hands the Studio a short-lived, signed proof of who they are; the Studio turns that into its own session cookie.

```
 Browser                 TMP site (existing)              Studio frontend            Studio API (Render)
    │  click "Graphing Studio"  │                                 │                          │
    │──────────────────────────▶│ (already signed in to TMP)      │                          │
    │                           │ mint handoff JWT (≤5 min, 1 use)│                          │
    │◀── 302 https://graphing…/auth/callback?handoff=<JWT> ───────│                          │
    │──────────────────────────────────────────────────────────────▶ strips token from URL   │
    │                                                              │ POST /api/auth/exchange ─▶ verify signature, iss, aud,
    │                                                              │                          │ age, jti (replay) → user
    │◀──────────────── Set-Cookie: session (httpOnly, Secure, SameSite=Lax) ─────────────────│
```

If the person is not signed in to TMP, TMP's launch route sends them to its normal login first and then continues the flow.

## What TMP must provide (pick one mode)

Set with `TMP_AUTH_MODE` on the API.

### `jwt-hs256` (simplest)
TMP and the Studio share a secret (`TMP_HANDOFF_SECRET`, ≥ 32 random chars, kept only in TMP's server environment and Render).

### `jwt-rs256` (recommended if more than one service will consume TMP identities)
TMP signs with a private key it never shares; the Studio holds only the public key (`TMP_HANDOFF_PUBLIC_KEY`).

### `introspect`
No token format to agree on: the Studio sends the opaque value it received as `Authorization: Bearer <value>` to `TMP_INTROSPECT_URL`, and TMP answers `200` with the user JSON (below), or any non-200 to reject.

### Claims / user JSON

| Claim | Required | Meaning |
|---|---|---|
| `sub` | yes | TMP's stable user id |
| `name` | no | display name (default "TMP user") |
| `email` | no | optional, only displayed/used for attribution |
| `role` | yes | TMP role name (mapped below) |
| `classIds` (or `classes`) | no | array of TMP class/group ids the user belongs to (max 50) |
| `iss` | JWT modes | must equal `TMP_TOKEN_ISSUER` |
| `aud` | JWT modes | must equal `TMP_TOKEN_AUDIENCE` |
| `exp` / `iat` | JWT modes | handoff lifetime; tokens older than `TMP_HANDOFF_MAX_AGE_SECONDS` (default 300 s) are refused |
| `jti` | JWT modes | unique id; each token is accepted **once** (replay cache) |

### Role mapping

| TMP role names (case-insensitive) | Studio role |
|---|---|
| admin, administrator, superadmin | `admin` |
| tutor, teacher, instructor, educator, facilitator | `tutor` |
| student, learner, pupil | `student` |
| anything else | `viewer` (read-only) — least privilege by default |

Override or extend with `TMP_ROLE_MAP`, e.g. `{"coach":"tutor","mentee":"student"}`.

## Permissions

| | Create / edit own boards | Publish to a class | Submit to tutor | Read others' boards | Delete |
|---|---|---|---|---|---|
| **student** | ✔ | ✘ | ✔ (own class) | published boards of own class (read-only) | own |
| **tutor** | ✔ | ✔ (own classes) | ✘ | published boards of own classes + students' **submitted** boards | own |
| **admin** | ✔ | ✔ | — | all | all |
| **viewer** | ✘ | ✘ | ✘ | published boards of own class (read-only) | ✘ |

Board visibility is `private` (owner only) → `class` (tutor-published, read-only for classmates) or `submitted` (student → tutors of that class). Users can never widen a board to a class they do not belong to. Opening someone else's board gives a read-only view with a **Make my copy** action. Concurrent saves use a `version` number: a stale save returns `409` and the UI offers to reload instead of silently overwriting.

Guests (not signed in) can use every drawing feature; their work lives in their own browser only.

## Security properties

- Session cookie: `httpOnly`, `Secure` (production), `SameSite=Lax`, signed with `SESSION_SECRET`, 8 h by default.
- Handoff token is removed from the address bar and browser history immediately on arrival.
- Handoff tokens: signature + issuer + audience + max-age + one-time `jti`.
- State-changing requests check the `Origin` header against `FRONTEND_ORIGINS` (CSRF defence in depth on top of SameSite).
- Rate limiting, `helmet` headers, strict CORS allowlist, request-size limit, zod validation of every body.
- Production start-up refuses weak/missing secrets and localhost origins.
- `/api/dev/login` exists only when `DEV_AUTH=true` and is never registered in production.

## Limits to be aware of

- Single-use `jti` tracking is in memory per API instance. With a **single** Render instance (the default) this is exact; if you scale to several instances, either keep the max-age short (it is 5 minutes) or move the cache to Postgres/Redis.
- Class membership comes from the handoff claims at sign-in time; changes in TMP apply the next time the person signs in (session length is 8 h).
- Logging out of the Studio does not log out of TMP (and vice-versa).
