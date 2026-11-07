// Mint a TMP-style handoff token for local testing:
//   TMP_HANDOFF_SECRET=... npm run mint-token -- --role tutor --name "Mr Asiedu" --class jhs3
// Then open:  http://localhost:5173/auth/callback?handoff=<token>
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1]]] : acc), [])
);
const secret = process.env.TMP_HANDOFF_SECRET;
if (!secret) {
  console.error('Set TMP_HANDOFF_SECRET first (same value as the API).');
  process.exit(1);
}
const token = jwt.sign(
  {
    name: args.name || 'Test User',
    role: args.role || 'student',
    classIds: args.class ? String(args.class).split(',') : ['demo-class'],
  },
  secret,
  {
    algorithm: 'HS256',
    subject: args.sub || `test-${args.role || 'student'}`,
    issuer: process.env.TMP_TOKEN_ISSUER || 'themodernpedagogues.com',
    audience: process.env.TMP_TOKEN_AUDIENCE || 'tmp-graphing-studio',
    expiresIn: '5m',
    jwtid: crypto.randomUUID(),
  }
);
console.log(token);
