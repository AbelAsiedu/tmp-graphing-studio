# Connecting the Studio to the existing TMP website

Nothing in the TMP application needs to be restructured. The integration is **two small, additive changes on the TMP side**:

1. a navigation link, and
2. one server route that issues the handoff token (only needed for single sign-on; without it the link still opens the Studio and people use it as guests).

> The TMP codebase was not available when the Studio was built, so the snippets below are stack-neutral templates. Adapt names/paths to TMP's framework.

## 1. Navigation link

Add one item to TMP's main navigation. It is a plain link to the launch route (SSO) — or straight to the subdomain if you skip SSO at first.

```html
<!-- with single sign-on -->
<a href="/graphing-studio/launch" class="nav-link" target="_blank" rel="noopener">Graphing Studio</a>

<!-- without SSO yet (guest mode) -->
<a href="https://graphing.themodernpedagogues.com" class="nav-link" target="_blank" rel="noopener">Graphing Studio</a>
```

Use TMP's existing nav-link class so it inherits TMP styling. Inside the Studio, the header's TMP logo links back to `VITE_TMP_HOME_URL`.

## 2. Handoff route (single sign-on)

`GET /graphing-studio/launch` on TMP:

1. If the visitor has no TMP session → redirect to TMP login with a return to this same route.
2. Otherwise build a JWT with the claims in [AUTH_INTEGRATION.md](AUTH_INTEGRATION.md) (`sub`, `name`, `role`, `classIds`, `iss`, `aud`, `jti`, 5-minute `exp`).
3. Redirect to `https://graphing.themodernpedagogues.com/auth/callback?handoff=<jwt>`.

### Example (Node / Express + `jsonwebtoken`)

```js
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';

app.get('/graphing-studio/launch', requireTmpLogin, (req, res) => {
  const u = req.user; // however TMP exposes the signed-in user
  const token = jwt.sign(
    {
      name: u.fullName,
      role: u.role,                       // TMP's own role name; the Studio maps it
      classIds: u.classes.map((c) => String(c.id)),
    },
    process.env.GRAPHING_HANDOFF_SECRET,  // same value as TMP_HANDOFF_SECRET on Render
    {
      algorithm: 'HS256',                 // or RS256 with a private key
      subject: String(u.id),
      issuer: 'themodernpedagogues.com',  // = TMP_TOKEN_ISSUER
      audience: 'tmp-graphing-studio',    // = TMP_TOKEN_AUDIENCE
      expiresIn: '5m',
      jwtid: crypto.randomUUID(),
    }
  );
  res.redirect(`https://graphing.themodernpedagogues.com/auth/callback?handoff=${encodeURIComponent(token)}`);
});
```

Rules that matter: the secret never leaves TMP's server env and Render's env; never put the token in a page TMP serves to the browser except as this redirect; one fresh `jti` per launch.

For PHP/Laravel, Django, Rails, etc. the contract is identical — any standard JWT library works (HS256 or RS256, claims above).

### Alternative: introspection
If TMP prefers not to mint tokens, set `TMP_AUTH_MODE=introspect` and expose `GET /api/auth/verify` that accepts `Authorization: Bearer <TMP session token>` and returns:

```json
{ "user": { "sub": "123", "name": "Ama Mensah", "role": "teacher", "classIds": ["jhs3-math"] } }
```

Then the launch route redirects with `?handoff=<that session token>`.

## 3. Class ids

`classIds` should be stable identifiers for TMP classes/groups (e.g. `jhs3-math-2026`). They are what tutors publish to and what students submit to, so tutor and student must carry the **same** id for the same class.

## 4. Branding

Match the Studio to the TMP site by editing the `--tmp-*` tokens in `frontend/src/theme.css`, replacing the logo in `App.tsx` and `public/favicon.svg`. No other file contains colours.

## 5. Rollout checklist

- [ ] DNS + Vercel domain live (DEPLOYMENT.md §4)
- [ ] Render API healthy, `TMP_HANDOFF_SECRET` set
- [ ] Same secret configured on TMP; launch route deployed
- [ ] Test with one tutor and one student account in the same class: tutor publishes, student sees it read-only; student submits, tutor sees it
- [ ] Add the nav link last, so nothing user-facing changes until everything above works

The TMP site's own deployment, database and auth are untouched throughout.
