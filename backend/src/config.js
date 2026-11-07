// Central, validated configuration. All secrets come from environment variables.
// Nothing in this repository contains a real secret.

const csv = (v) =>
  String(v || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export function loadConfig(env = process.env) {
  const isProd = env.NODE_ENV === 'production';

  const cfg = {
    isProd,
    port: Number(env.PORT || 8787),

    // Origins allowed to call this API from a browser (CORS + CSRF origin check).
    // With the Vercel rewrite proxy (/api -> Render) the browser Origin is the Studio origin.
    allowedOrigins: csv(env.FRONTEND_ORIGINS || 'http://localhost:5173'),

    // Our own session (issued after a successful TMP handoff).
    sessionSecret: env.SESSION_SECRET || '',
    sessionTtlSeconds: Number(env.SESSION_TTL_SECONDS || 8 * 3600),
    // How many reverse proxies sit in front of the API (Vercel rewrite + Render's load balancer = 2 in production).
    // Needed so req.ip is the visitor's real address, not Vercel's.
    trustProxyHops: Number(env.TRUST_PROXY_HOPS ?? (isProd ? 2 : 0)),
    cookieName: env.SESSION_COOKIE_NAME || 'tmpgs_session',
    // Set to ".themodernpedagogues.com" ONLY if the API is on a sibling subdomain
    // instead of being proxied through the frontend origin.
    cookieDomain: env.SESSION_COOKIE_DOMAIN || undefined,

    // ---- TMP authentication integration -------------------------------------------------
    // jwt-hs256   : TMP signs a short-lived handoff JWT with a shared secret (simplest)
    // jwt-rs256   : TMP signs with a private key; we hold only the public key (recommended)
    // introspect  : we call a TMP endpoint with the bearer token and trust its JSON answer
    tmpAuthMode: env.TMP_AUTH_MODE || 'jwt-hs256',
    tmpHandoffSecret: env.TMP_HANDOFF_SECRET || '',
    tmpHandoffPublicKey: (env.TMP_HANDOFF_PUBLIC_KEY || '').replace(/\\n/g, '\n'),
    tmpIntrospectUrl: env.TMP_INTROSPECT_URL || '',
    tmpIssuer: env.TMP_TOKEN_ISSUER || 'themodernpedagogues.com',
    tmpAudience: env.TMP_TOKEN_AUDIENCE || 'tmp-graphing-studio',
    tmpHandoffMaxAgeSeconds: Number(env.TMP_HANDOFF_MAX_AGE_SECONDS || 300),
    // JSON object mapping TMP role names to Studio roles, e.g. {"teacher":"tutor","pupil":"student"}
    roleMap: safeJson(env.TMP_ROLE_MAP, {}),

    // ---- Persistence ---------------------------------------------------------------------
    databaseUrl: env.DATABASE_URL || '',
    dataFile: env.DATA_FILE || './data/boards.json',
    maxBoardBytes: Number(env.MAX_BOARD_BYTES || 1_500_000),

    // Development only: POST /api/dev/login. Never enabled in production.
    devAuth: !isProd && env.DEV_AUTH === 'true',
  };

  validateConfig(cfg);
  return cfg;
}

function safeJson(v, fallback) {
  if (!v) return fallback;
  try {
    const parsed = JSON.parse(v);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch {
    throw new Error('TMP_ROLE_MAP must be valid JSON');
  }
}

export function validateConfig(cfg) {
  const problems = [];
  if (cfg.isProd) {
    if (cfg.sessionSecret.length < 32) problems.push('SESSION_SECRET must be at least 32 characters in production');
    if (cfg.allowedOrigins.some((o) => o.includes('localhost'))) problems.push('FRONTEND_ORIGINS must not contain localhost in production');
  }
  if (cfg.tmpAuthMode === 'jwt-hs256' && cfg.isProd && cfg.tmpHandoffSecret.length < 32)
    problems.push('TMP_HANDOFF_SECRET must be at least 32 characters in production (jwt-hs256)');
  if (cfg.tmpAuthMode === 'jwt-rs256' && cfg.isProd && !cfg.tmpHandoffPublicKey)
    problems.push('TMP_HANDOFF_PUBLIC_KEY is required (jwt-rs256)');
  if (cfg.tmpAuthMode === 'introspect' && !cfg.tmpIntrospectUrl)
    problems.push('TMP_INTROSPECT_URL is required (introspect)');
  if (!['jwt-hs256', 'jwt-rs256', 'introspect'].includes(cfg.tmpAuthMode))
    problems.push(`Unknown TMP_AUTH_MODE "${cfg.tmpAuthMode}"`);
  if (problems.length) throw new Error('Invalid configuration:\n - ' + problems.join('\n - '));
}
