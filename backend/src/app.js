import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import crypto from 'node:crypto';
import { z } from 'zod';
import {
  AuthError,
  JtiCache,
  cookieOptions,
  issueSession,
  requireUser,
  sessionMiddleware,
  verifyTmpCredential,
} from './auth.js';
import { canCreate, canDelete, canRead, canWrite, checkVisibilityChange, summarize } from './permissions.js';

const boardBody = z.object({
  title: z.string().trim().min(1).max(120),
  data: z.object({ pages: z.array(z.any()).min(1).max(200) }).passthrough(),
  version: z.number().int().positive().optional(),
});
const visibilityBody = z.object({
  visibility: z.enum(['private', 'class', 'submitted']),
  classId: z.string().trim().min(1).max(100).nullish(),
});

export function createApp({ cfg, store, fetchImpl = fetch }) {
  const app = express();
  const jti = new JtiCache();

  app.set('trust proxy', cfg.trustProxyHops); // Vercel + Render sit in front of us (TRUST_PROXY_HOPS)
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || cfg.allowedOrigins.includes(origin)),
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      maxAge: 600,
    })
  );
  app.use(express.json({ limit: Math.ceil(cfg.maxBoardBytes * 1.1) }));
  app.use(sessionMiddleware(cfg));

  // CSRF defence in depth: cookies are SameSite=Lax, and state-changing requests must come from an allowed origin.
  app.use((req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.headers.origin;
    if (origin && !cfg.allowedOrigins.includes(origin)) return res.status(403).json({ error: 'Origin not allowed' });
    if (!origin && !req.headers.authorization && cfg.isProd) return res.status(403).json({ error: 'Origin header required' });
    next();
  });

  // Signed-in people are limited per account, so a whole class behind one school network (or one Vercel
  // address) never shares a budget. Only anonymous requests fall back to the visitor's IP address.
  const limiter = (max) =>
    rateLimit({
      windowMs: 60_000,
      limit: max,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      keyGenerator: (req) => (req.user?.id ? `u:${req.user.id}` : ipKeyGenerator(req.ip ?? '')),
    });
  app.use('/api/', limiter(300));

  app.get('/healthz', (_req, res) => res.json({ ok: true, service: 'tmp-graphing-studio-api' }));

  // ---------------------------------------------------------------- auth
  // Handoff tokens are signed, single-use and short-lived, so guessing is pointless; the limit only has to stop floods,
  // and must leave room for a whole class (often one shared network address) signing in at the start of a lesson.
  app.post('/api/auth/exchange', limiter(300), async (req, res) => {
    const token = req.body?.token;
    const user = await verifyTmpCredential(token, cfg, jti, fetchImpl);
    res.cookie(cfg.cookieName, issueSession(user, cfg), cookieOptions(cfg));
    res.json({ user });
  });

  app.get('/api/auth/me', (req, res) => {
    if (!req.user) return res.status(401).json({ user: null });
    res.json({ user: req.user });
  });

  app.post('/api/auth/logout', (_req, res) => {
    const { maxAge, ...opts } = cookieOptions(cfg);
    res.clearCookie(cfg.cookieName, opts);
    res.json({ ok: true });
  });

  if (cfg.devAuth) {
    // Local development only (disabled in production by config). Lets you try tutor/student flows without TMP.
    app.post('/api/dev/login', (req, res) => {
      const { role = 'student', name = 'Dev User', classIds = ['demo-class'] } = req.body || {};
      const user = { id: `dev-${role}`, name: String(name), role, classIds: classIds.map(String) };
      res.cookie(cfg.cookieName, issueSession(user, cfg), cookieOptions(cfg));
      res.json({ user });
    });
  }

  // ---------------------------------------------------------------- boards
  app.get('/api/boards', requireUser, async (req, res) => {
    const scope = req.query.scope === 'shared' ? 'shared' : 'mine';
    const boards = await store.list((b) =>
      scope === 'mine' ? b.ownerId === req.user.id : b.ownerId !== req.user.id && canRead(req.user, b)
    );
    res.json({ boards: boards.map(summarize) });
  });

  app.post('/api/boards', requireUser, async (req, res) => {
    if (!canCreate(req.user)) return res.status(403).json({ error: 'Your account has read-only access.' });
    const body = boardBody.parse(req.body);
    assertSize(body.data, cfg);
    const now = new Date().toISOString();
    const board = {
      id: crypto.randomUUID(),
      ownerId: req.user.id,
      ownerName: req.user.name,
      ownerRole: req.user.role,
      title: body.title,
      visibility: 'private',
      classId: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
      data: body.data,
    };
    await store.insert(board);
    res.status(201).json({ board });
  });

  app.get('/api/boards/:id', requireUser, async (req, res) => {
    const board = await store.get(req.params.id);
    if (!board || !canRead(req.user, board)) return res.status(404).json({ error: 'Board not found' });
    res.json({ board, permissions: { write: canWrite(req.user, board), delete: canDelete(req.user, board) } });
  });

  app.put('/api/boards/:id', requireUser, async (req, res) => {
    const board = await store.get(req.params.id);
    if (!board || !canRead(req.user, board)) return res.status(404).json({ error: 'Board not found' });
    if (!canWrite(req.user, board)) return res.status(403).json({ error: 'This board is read-only for you. Duplicate it to edit your own copy.' });
    const body = boardBody.parse(req.body);
    assertSize(body.data, cfg);
    const updated = await store.update(board.id, { title: body.title, data: body.data }, body.version);
    res.json({ board: updated });
  });

  app.patch('/api/boards/:id/visibility', requireUser, async (req, res) => {
    const board = await store.get(req.params.id);
    if (!board || !canRead(req.user, board)) return res.status(404).json({ error: 'Board not found' });
    const { visibility, classId } = visibilityBody.parse(req.body);
    const problem = checkVisibilityChange(req.user, board, visibility, classId);
    if (problem) return res.status(403).json({ error: problem });
    const updated = await store.update(board.id, { visibility, classId: visibility === 'private' ? null : classId });
    res.json({ board: summarize(updated) });
  });

  app.post('/api/boards/:id/duplicate', requireUser, async (req, res) => {
    if (!canCreate(req.user)) return res.status(403).json({ error: 'Your account has read-only access.' });
    const src = await store.get(req.params.id);
    if (!src || !canRead(req.user, src)) return res.status(404).json({ error: 'Board not found' });
    const now = new Date().toISOString();
    const copy = {
      ...src,
      id: crypto.randomUUID(),
      ownerId: req.user.id,
      ownerName: req.user.name,
      ownerRole: req.user.role,
      title: `${src.title} (copy)`.slice(0, 120),
      visibility: 'private',
      classId: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    await store.insert(copy);
    res.status(201).json({ board: copy });
  });

  app.delete('/api/boards/:id', requireUser, async (req, res) => {
    const board = await store.get(req.params.id);
    if (!board || !canRead(req.user, board)) return res.status(404).json({ error: 'Board not found' });
    if (!canDelete(req.user, board)) return res.status(403).json({ error: 'Not allowed' });
    await store.remove(board.id);
    res.json({ ok: true });
  });

  // ---------------------------------------------------------------- errors
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof AuthError) return res.status(err.status).json({ error: err.message });
    if (err instanceof z.ZodError) return res.status(400).json({ error: 'Invalid request', details: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`) });
    if (err?.status === 409) return res.status(409).json({ error: 'This board was changed elsewhere. Reload before saving.' });
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Board is too large' });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON' });
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

function assertSize(data, cfg) {
  if (Buffer.byteLength(JSON.stringify(data)) > cfg.maxBoardBytes) {
    const e = new Error('too large');
    e.type = 'entity.too.large';
    throw e;
  }
}
