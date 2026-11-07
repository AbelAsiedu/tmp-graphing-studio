# Deployment guide

Two independent deployments from one repository:

| Part | Host | Source | Pipeline |
|---|---|---|---|
| Frontend (static SPA) | Vercel | `frontend/` | Vercel Git integration (auto-deploys on push to `main`, preview per PR) |
| API + database | Render | `backend/` via `render.yaml` | Render auto-deploy on push to `main` |
| CI checks | GitHub Actions | both | `.github/workflows/ci.yml`, each side only when its folder changes |

Browsers only ever talk to `https://graphing.themodernpedagogues.com`. Vercel forwards `/api/*` to the Render service (a rewrite in `frontend/vercel.json`), so the session cookie is **first-party** and no cross-site cookie or CORS tricks are needed.

## 1. GitHub

```bash
cd tmp-graphing-studio
git init -b main && git add -A && git commit -m "TMP Graphing Studio"
gh repo create tmp-graphing-studio --private --source . --push
```

Protect `main` (require the CI checks) if the team grows.

## 2. Render (API + Postgres)

1. Render dashboard → **New → Blueprint** → choose the repo. It reads `render.yaml` and creates the web service `tmp-graphing-studio-api` and the Postgres database `tmp-graphing-studio-db`.
2. When prompted, set the one secret that is not generated: **`TMP_HANDOFF_SECRET`** (see [AUTH_INTEGRATION.md](AUTH_INTEGRATION.md)). `SESSION_SECRET` is generated for you.
3. Note the service URL, e.g. `https://tmp-graphing-studio-api.onrender.com`, and check `…/healthz` returns `{"ok":true}`.
4. Tables are created automatically on first start.

The server refuses to start in production with a weak `SESSION_SECRET` (< 32 chars), localhost origins, or missing TMP secrets — a failed deploy with a clear log line is the intended behaviour.

Use a paid plan for classroom use: the free web tier sleeps when idle and the first request after a pause is slow.

### API environment variables

| Variable | Required | Notes |
|---|---|---|
| `NODE_ENV` | yes | `production` |
| `FRONTEND_ORIGINS` | yes | `https://graphing.themodernpedagogues.com` (comma-separate extras, e.g. a Vercel preview) |
| `SESSION_SECRET` | yes | ≥ 32 random chars; rotating it signs everyone out |
| `SESSION_TTL_SECONDS` | no | default 28800 (8 h) |
| `SESSION_COOKIE_DOMAIN` | no | only if the API is on its own sibling subdomain instead of behind the Vercel rewrite (`.themodernpedagogues.com`) |
| `TMP_AUTH_MODE` | yes | `jwt-hs256`, `jwt-rs256` or `introspect` |
| `TMP_HANDOFF_SECRET` | hs256 | shared secret, ≥ 32 chars |
| `TMP_HANDOFF_PUBLIC_KEY` | rs256 | PEM public key (`\n` for newlines) |
| `TMP_INTROSPECT_URL` | introspect | TMP endpoint that validates a token |
| `TMP_TOKEN_ISSUER` / `TMP_TOKEN_AUDIENCE` | yes | default `themodernpedagogues.com` / `tmp-graphing-studio` |
| `TMP_HANDOFF_MAX_AGE_SECONDS` | no | default 300 |
| `TMP_ROLE_MAP` | no | JSON, e.g. `{"teacher":"tutor","pupil":"student"}` |
| `DATABASE_URL` | yes | provided by the Blueprint |
| `MAX_BOARD_BYTES` | no | default 1,500,000 |
| `DEV_AUTH` | **never in prod** | must be unset/false |

## 3. Vercel (frontend)

1. **Add New → Project** → import the repo → set **Root Directory** to `frontend`. Framework preset: Vite (build `npm run build`, output `dist` — already in `vercel.json`).
2. **Edit `frontend/vercel.json`**: replace the placeholder `https://tmp-graphing-studio-api.onrender.com` in the `/api` rewrite with your real Render URL, commit, push.
3. Environment variables (Project → Settings → Environment Variables, Production):

   | Variable | Value |
   |---|---|
   | `VITE_TMP_SIGNIN_URL` | optional — defaults to the TMP login page `https://themodernpedagogues-70f4f230adc2.herokuapp.com/login`. Set it to override (e.g. when TMP moves to `themodernpedagogues.com/login`) |
   | `VITE_TMP_HOME_URL` | optional — defaults to the TMP site `https://themodernpedagogues-70f4f230adc2.herokuapp.com` (set to the custom domain once it points at TMP) |
   | `VITE_API_BASE_URL` | leave **empty** (same-origin `/api`) |

   Only `VITE_*` values reach the browser; never put secrets there.

## 4. Subdomain `graphing.themodernpedagogues.com`

1. Vercel → Project → **Settings → Domains** → add `graphing.themodernpedagogues.com`. Vercel shows the DNS record it expects.
2. At the DNS host for `themodernpedagogues.com`, add: `CNAME  graphing  →  cname.vercel-dns.com` (use the exact value Vercel shows).
3. Wait for the certificate (usually minutes). Then set `FRONTEND_ORIGINS` on Render to `https://graphing.themodernpedagogues.com` if you haven't.
4. This does not touch the existing TMP site's records.

The CSP in `vercel.json` allows the Studio to be embedded only by the TMP site (`https://themodernpedagogues-70f4f230adc2.herokuapp.com`, `themodernpedagogues.com` and its subdomains) (`frame-ancestors`), in case TMP wants to show it in an iframe.

## 5. Verify a deployment

- `https://graphing.themodernpedagogues.com` loads and draws as a guest.
- `…/api/auth/me` returns `401` when signed out (not a 5xx or HTML page) — proves the rewrite reaches Render.
- Sign in through TMP → role badge appears → **Boards → Save to cloud** works → reload and it is listed.
- A student account cannot open a tutor's private board (404/403); a classmate sees a published board read-only.

## Rollback and operations

- Vercel: promote a previous deployment from the dashboard (instant).
- Render: redeploy a previous commit from the service's Deploys tab. Board data lives in Postgres and is not affected by code rollbacks.
- Back up Postgres using Render's built-in backups (paid plans).
