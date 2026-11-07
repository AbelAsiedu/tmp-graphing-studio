import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { loadConfig } from '../src/config.js';
import { MemoryStore } from '../src/store.js';
import { createApp } from '../src/app.js';
import { normalizeRole } from '../src/auth.js';

const ENV = {
  NODE_ENV: 'test',
  SESSION_SECRET: 's'.repeat(40),
  TMP_HANDOFF_SECRET: 'h'.repeat(40),
  FRONTEND_ORIGINS: 'http://studio.test',
  DEV_AUTH: 'false',
};

async function boot(env = {}, fetchImpl) {
  const cfg = loadConfig({ ...ENV, ...env });
  const app = createApp({ cfg, store: new MemoryStore(), fetchImpl });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const close = () => new Promise((r) => server.close(r));
  return { cfg, base, close };
}

function handoff(cfg, { sub, ...claims } = {}, opts = {}) {
  return jwt.sign(
    { name: 'Test', role: 'student', classIds: ['c1'], ...claims },
    cfg.tmpHandoffSecret,
    { algorithm: 'HS256', subject: sub || 'u1', issuer: cfg.tmpIssuer, audience: cfg.tmpAudience, expiresIn: '5m', jwtid: crypto.randomUUID(), ...opts }
  );
}

async function login(ctx, claims) {
  const res = await fetch(`${ctx.base}/api/auth/exchange`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://studio.test' },
    body: JSON.stringify({ token: handoff(ctx.cfg, claims) }),
  });
  assert.equal(res.status, 200);
  const cookie = res.headers.get('set-cookie').split(';')[0];
  return (path, init = {}) =>
    fetch(ctx.base + path, {
      ...init,
      headers: { 'content-type': 'application/json', origin: 'http://studio.test', cookie, ...(init.headers || {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
}

const boardData = { pages: [{ id: 'p1', objects: [] }] };

test('role normalisation: unknown roles get least privilege', () => {
  assert.equal(normalizeRole('Teacher'), 'tutor');
  assert.equal(normalizeRole('learner'), 'student');
  assert.equal(normalizeRole('parent'), 'viewer');
  assert.equal(normalizeRole('mystery'), 'viewer');
  assert.equal(normalizeRole('pupil', { pupil: 'student' }), 'student');
});

test('handoff: valid token creates an httpOnly session; /me works; replay is rejected', async () => {
  const ctx = await boot();
  try {
    const token = handoff(ctx.cfg, { sub: 'abc', role: 'teacher', name: 'Mr A' });
    const post = () =>
      fetch(`${ctx.base}/api/auth/exchange`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://studio.test' },
        body: JSON.stringify({ token }),
      });
    const first = await post();
    assert.equal(first.status, 200);
    const setCookie = first.headers.get('set-cookie');
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
    assert.equal((await first.json()).user.role, 'tutor');
    const me = await fetch(`${ctx.base}/api/auth/me`, { headers: { cookie: setCookie.split(';')[0] } });
    assert.equal((await me.json()).user.id, 'abc');
    assert.equal((await post()).status, 401, 'replayed token must be rejected');
  } finally {
    await ctx.close();
  }
});

test('handoff: wrong secret, wrong audience, expired and missing jti are rejected', async () => {
  const ctx = await boot();
  try {
    const bad = [
      jwt.sign({ role: 'tutor' }, 'x'.repeat(40), { subject: 'u', issuer: ctx.cfg.tmpIssuer, audience: ctx.cfg.tmpAudience, jwtid: '1', expiresIn: '5m' }),
      jwt.sign({ role: 'tutor' }, ctx.cfg.tmpHandoffSecret, { subject: 'u', issuer: ctx.cfg.tmpIssuer, audience: 'other', jwtid: '2', expiresIn: '5m' }),
      jwt.sign({ role: 'tutor' }, ctx.cfg.tmpHandoffSecret, { subject: 'u', issuer: ctx.cfg.tmpIssuer, audience: ctx.cfg.tmpAudience, jwtid: '3', expiresIn: -10 }),
      jwt.sign({ role: 'tutor' }, ctx.cfg.tmpHandoffSecret, { subject: 'u', issuer: ctx.cfg.tmpIssuer, audience: ctx.cfg.tmpAudience, expiresIn: '5m' }),
      jwt.sign({ role: 'tutor' }, '', { algorithm: 'none', subject: 'u', issuer: ctx.cfg.tmpIssuer, audience: ctx.cfg.tmpAudience, jwtid: '4' }),
    ];
    for (const token of bad) {
      const r = await fetch(`${ctx.base}/api/auth/exchange`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://studio.test' },
        body: JSON.stringify({ token }),
      });
      assert.equal(r.status, 401);
    }
  } finally {
    await ctx.close();
  }
});

test('introspect mode trusts TMP answer via fetch', async () => {
  const stub = async (url, init) => {
    assert.equal(url, 'https://tmp.test/verify');
    assert.equal(init.headers.Authorization, 'Bearer opaque');
    return { ok: true, json: async () => ({ user: { sub: 'z9', name: 'Zed', role: 'student', classIds: ['c1'] } }) };
  };
  const ctx = await boot({ TMP_AUTH_MODE: 'introspect', TMP_INTROSPECT_URL: 'https://tmp.test/verify' }, stub);
  try {
    const r = await fetch(`${ctx.base}/api/auth/exchange`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://studio.test' },
      body: JSON.stringify({ token: 'opaque' }),
    });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).user.id, 'z9');
  } finally {
    await ctx.close();
  }
});

test('boards require sign-in; CSRF origin check blocks foreign origins', async () => {
  const ctx = await boot();
  try {
    assert.equal((await fetch(`${ctx.base}/api/boards`)).status, 401);
    const api = await login(ctx, { sub: 's1' });
    const evil = await api('/api/boards', { method: 'POST', headers: { origin: 'http://evil.test' }, body: { title: 'x', data: boardData } });
    assert.equal(evil.status, 403);
  } finally {
    await ctx.close();
  }
});

test('student CRUD, optimistic concurrency and validation', async () => {
  const ctx = await boot();
  try {
    const api = await login(ctx, { sub: 's1' });
    const created = await (await api('/api/boards', { method: 'POST', body: { title: 'Quadratics', data: boardData } })).json();
    const id = created.board.id;
    assert.equal(created.board.version, 1);
    const upd = await api(`/api/boards/${id}`, { method: 'PUT', body: { title: 'Quadratics 2', data: boardData, version: 1 } });
    assert.equal((await upd.json()).board.version, 2);
    const stale = await api(`/api/boards/${id}`, { method: 'PUT', body: { title: 'old', data: boardData, version: 1 } });
    assert.equal(stale.status, 409);
    assert.equal((await api('/api/boards', { method: 'POST', body: { title: '', data: boardData } })).status, 400);
    assert.equal((await api('/api/boards', { method: 'POST', body: { title: 'bad', data: { nope: 1 } } })).status, 400);
    const list = await (await api('/api/boards')).json();
    assert.equal(list.boards.length, 1);
    assert.equal(list.boards[0].data, undefined, 'list responses must not include board content');
    assert.equal((await api(`/api/boards/${id}`, { method: 'DELETE' })).status, 200);
  } finally {
    await ctx.close();
  }
});

test('tutor publishes to class; classmates read-only; outsiders see nothing; students cannot publish', async () => {
  const ctx = await boot();
  try {
    const tutor = await login(ctx, { sub: 't1', role: 'tutor', classIds: ['c1'] });
    const student = await login(ctx, { sub: 's1', role: 'student', classIds: ['c1'] });
    const outsider = await login(ctx, { sub: 's2', role: 'student', classIds: ['c2'] });

    const { board } = await (await tutor('/api/boards', { method: 'POST', body: { title: 'Lesson', data: boardData } })).json();
    assert.equal((await student(`/api/boards/${board.id}`)).status, 404, 'private board invisible');

    const pub = await tutor(`/api/boards/${board.id}/visibility`, { method: 'PATCH', body: { visibility: 'class', classId: 'c1' } });
    assert.equal(pub.status, 200);
    const read = await (await student(`/api/boards/${board.id}`)).json();
    assert.equal(read.permissions.write, false);
    assert.equal((await student(`/api/boards/${board.id}`, { method: 'PUT', body: { title: 'hack', data: boardData } })).status, 403);
    assert.equal((await student(`/api/boards/${board.id}`, { method: 'DELETE' })).status, 403);
    assert.equal((await outsider(`/api/boards/${board.id}`)).status, 404);

    const shared = await (await student('/api/boards?scope=shared')).json();
    assert.equal(shared.boards.length, 1);

    const copy = await (await student(`/api/boards/${board.id}/duplicate`, { method: 'POST' })).json();
    assert.equal(copy.board.ownerId, 's1');
    assert.equal(copy.board.visibility, 'private');

    const own = await student(`/api/boards/${copy.board.id}/visibility`, { method: 'PATCH', body: { visibility: 'class', classId: 'c1' } });
    assert.equal(own.status, 403, 'students cannot publish to the class');
    const sub = await student(`/api/boards/${copy.board.id}/visibility`, { method: 'PATCH', body: { visibility: 'submitted', classId: 'c1' } });
    assert.equal(sub.status, 200);
    assert.equal((await tutor(`/api/boards/${copy.board.id}`)).status, 200, 'tutor of the class can read submitted work');
    const otherClass = await login(ctx, { sub: 't2', role: 'tutor', classIds: ['c9'] });
    assert.equal((await otherClass(`/api/boards/${copy.board.id}`)).status, 404);
  } finally {
    await ctx.close();
  }
});

test('viewer role is read-only', async () => {
  const ctx = await boot();
  try {
    const viewer = await login(ctx, { sub: 'p1', role: 'parent' });
    const r = await viewer('/api/boards', { method: 'POST', body: { title: 'x', data: boardData } });
    assert.equal(r.status, 403);
  } finally {
    await ctx.close();
  }
});

test('production config refuses weak secrets', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'production', SESSION_SECRET: 'short', FRONTEND_ORIGINS: 'https://graphing.example.com', TMP_HANDOFF_SECRET: 'short' }), /SESSION_SECRET/);
});
