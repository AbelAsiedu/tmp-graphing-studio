# TMP Graphing Studio

An independent web application for **The Modern Pedagogues (TMP)**: traditional drawing instruments, graph papers, equation plotting, statistical charts, geometric constructions, annotation, export and classroom presentation tools — on a canvas that works on phones, tablets and desktops.

It is deployed separately from the main TMP website (own repo, own pipeline, own subdomain `graphing.themodernpedagogues.com`) and signs people in through their existing TMP account — it does **not** keep its own passwords.

```
tmp-graphing-studio/
├── frontend/   Vite + React 19 + TypeScript, Canvas 2D drawing engine   → Vercel
├── backend/    Node 22 + Express 5 API (auth handoff, boards, permissions) → Render (+ Postgres)
├── docs/       DEPLOYMENT.md · AUTH_INTEGRATION.md · TMP_INTEGRATION.md
├── render.yaml Render Blueprint (API + database)
└── .github/    CI (frontend and backend run independently, path-filtered)
```

## Features

| Area | What is there |
|---|---|
| Papers | Cartesian, millimetre, polar, semi-log (x or y), log-log, isometric, dot, blank; white / cream / blue / board tones; custom window |
| Instruments | Ruler, protractor, 45° and 30-60-90 set squares — drag, rotate (15° magnetic snap), draw along their edges, read angles on the protractor; compass (free or fixed radius) |
| Equations | Textbook syntax (`ax^2+bx+c`, `sinx`, `sin^2(x)`), cartesian, `x = g(y)`, polar `r = f(theta)`, parametric `(f(t), g(t))`, implicit (`x^2+y^2=25`), inequalities (shaded); degree/radian modes; slider for every free letter; roots, intercepts, turning points and intersections; table of values; draw-on animation |
| Charts | Bar, pie, line, histogram, frequency polygon, ogive (median/quartiles), scatter + least-squares line, box plot, summary statistics |
| Constructions | Midpoint, perpendicular bisector, angle bisector, perpendicular from a point, parallel through a point, circumcircle, incircle, regular polygon, angle of given size, triangle from three sides — with the compass arcs shown |
| Annotation | Pencil, highlighter, **eraser (rubs out just the part under an adjustable circle — cuts strokes, lines, circles and outlines cleanly; or removes whole strokes)**, lines, arrows, circles, rectangles, points, text, angle measure, trace, select/move, undo/redo |
| Teaching | Pages as slides, presentation mode (fullscreen), laser pointer, spotlight |
| Export | PNG, JPEG, PDF (this page / all pages), save/open `.json` |
| Starter tour | A 10-step guided tour (spotlights the real controls; works with keyboard and on phones) is offered once to new visitors and never to people who already have work on screen. The **?** button in the header replays it; add `?tour=1` to the address to force it, `?tour=0` to suppress it |
| Cloud | Boards saved per account; tutors publish to a class (read-only for classmates), students submit to their tutor |

## Run it locally

```bash
# 1. API
cd backend
cp .env.example .env          # defaults are fine for local work (DEV_AUTH=true)
npm install
npm run dev                   # http://localhost:8787

# 2. Frontend (new terminal)
cd frontend
cp .env.example .env
npm install
npm run dev                   # http://localhost:5173  (proxies /api to :8787)
```

With `DEV_AUTH=true`, the dev build shows **Dev: tutor / Dev: student** buttons so you can try the cloud and sharing flows without TMP. To test the real handoff locally:

```bash
cd backend
TMP_HANDOFF_SECRET=<same as .env> npm run mint-token -- --role tutor --name "Mr Asiedu" --class jhs3
# open http://localhost:5173/auth/callback?handoff=<printed token>
```

Without any backend the app still works fully as a guest: everything is autosaved in the browser and can be exported or saved as a file.

## Tests

```bash
cd frontend && npm run typecheck && npm test   # drawing-engine tests (parser, plotting, stats, constructions, export)
cd backend  && npm test                        # API tests (handoff, replay, CSRF, CRUD, permissions, prod config)
```

## Documentation

- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — GitHub, Vercel, Render, environment variables, DNS for `graphing.themodernpedagogues.com`
- [docs/AUTH_INTEGRATION.md](docs/AUTH_INTEGRATION.md) — how TMP accounts, roles and permissions connect
- [docs/TMP_INTEGRATION.md](docs/TMP_INTEGRATION.md) — the nav link and the handoff endpoint to add to the TMP site

## Branding

Colours and font are in `frontend/src/theme.css` (`--tmp-*` tokens, sampled from the live TMP site). The monogram is `frontend/src/assets/tmp-mark.svg` (traced from a screenshot with `frontend/tools/trace_logo.py` — swap in TMP's official SVG if you have it). The sign-in button points at TMP's login page; see `docs/TMP_INTEGRATION.md`.
