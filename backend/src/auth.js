import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';

export const ROLES = ['admin', 'tutor', 'student', 'viewer'];

/** Map whatever role name TMP uses to a Studio role. Unknown roles get the least privilege. */
export function normalizeRole(raw, roleMap = {}) {
  const r = String(raw || '').toLowerCase().trim();
  if (roleMap[r] && ROLES.includes(roleMap[r])) return roleMap[r];
  if (['admin', 'administrator', 'superadmin'].includes(r)) return 'admin';
  if (['tutor', 'teacher', 'instructor', 'educator', 'facilitator'].includes(r)) return 'tutor';
  if (['student', 'learner', 'pupil'].includes(r)) return 'student';
  return 'viewer';
}

function toUser(claims, cfg) {
  if (!claims || !claims.sub) throw new AuthError('Token has no subject');
  const classIds = Array.isArray(claims.classIds || claims.classes)
    ? (claims.classIds || claims.classes).map(String).slice(0, 50)
    : [];
  return {
    id: String(claims.sub),
    name: String(claims.name || 'TMP user').slice(0, 120),
    email: claims.email ? String(claims.email).slice(0, 200) : undefined,
    role: normalizeRole(claims.role, cfg.roleMap),
    classIds,
  };
}

export class AuthError extends Error {
  constructor(message, status = 401) {
    super(message);
    this.status = status;
  }
}

/** Replay protection for handoff tokens (single instance; use Redis if you scale horizontally). */
export class JtiCache {
  constructor() {
    this.seen = new Map();
  }
  /** Returns true if first use. */
  use(jti, ttlSeconds) {
    const now = Date.now();
    for (const [k, exp] of this.seen) if (exp < now) this.seen.delete(k);
    if (this.seen.has(jti)) return false;
    this.seen.set(jti, now + ttlSeconds * 1000);
    return true;
  }
}

/**
 * Verify the credential TMP gave the browser and return a normalized user.
 * `token` is the handoff JWT (jwt modes) or an opaque TMP session/bearer token (introspect mode).
 */
export async function verifyTmpCredential(token, cfg, jti = new JtiCache(), fetchImpl = fetch) {
  if (!token || typeof token !== 'string' || token.length > 8000) throw new AuthError('Missing or oversized token');

  if (cfg.tmpAuthMode === 'introspect') {
    const res = await fetchImpl(cfg.tmpIntrospectUrl, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (!res.ok) throw new AuthError('TMP rejected the credential');
    const body = await res.json();
    return toUser(body.user || body, cfg);
  }

  const key = cfg.tmpAuthMode === 'jwt-rs256' ? cfg.tmpHandoffPublicKey : cfg.tmpHandoffSecret;
  const algorithms = cfg.tmpAuthMode === 'jwt-rs256' ? ['RS256'] : ['HS256'];
  let claims;
  try {
    claims = jwt.verify(token, key, {
      algorithms,
      issuer: cfg.tmpIssuer,
      audience: cfg.tmpAudience,
      maxAge: `${cfg.tmpHandoffMaxAgeSeconds}s`,
    });
  } catch (e) {
    throw new AuthError(`Invalid handoff token (${e.name})`);
  }
  if (!claims.jti) throw new AuthError('Handoff token must contain a jti');
  if (!jti.use(String(claims.jti), cfg.tmpHandoffMaxAgeSeconds + 30)) throw new AuthError('Handoff token already used');
  return toUser(claims, cfg);
}

export function issueSession(user, cfg) {
  return jwt.sign({ ...user, sid: crypto.randomUUID() }, cfg.sessionSecret, {
    algorithm: 'HS256',
    subject: user.id,
    expiresIn: cfg.sessionTtlSeconds,
    issuer: 'tmp-graphing-studio',
  });
}

export function readSession(token, cfg) {
  try {
    const c = jwt.verify(token, cfg.sessionSecret, { algorithms: ['HS256'], issuer: 'tmp-graphing-studio' });
    return { id: c.id, name: c.name, email: c.email, role: c.role, classIds: c.classIds || [] };
  } catch {
    return null;
  }
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function cookieOptions(cfg) {
  return {
    httpOnly: true,
    secure: cfg.isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: cfg.sessionTtlSeconds * 1000,
    ...(cfg.cookieDomain ? { domain: cfg.cookieDomain } : {}),
  };
}

/** Attaches req.user when a valid session cookie / bearer token is present. */
export function sessionMiddleware(cfg) {
  return (req, _res, next) => {
    const bearer = (req.headers.authorization || '').match(/^Bearer (.+)$/i)?.[1];
    const token = bearer || parseCookies(req.headers.cookie)[cfg.cookieName];
    req.user = token ? readSession(token, cfg) : null;
    next();
  };
}

export function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Sign in with your TMP account to use this feature.' });
  next();
}
