// LOCAL ONLY: derive anon/service_role JWTs from the local JWT secret.
import { createHmac } from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const jwtSecretFile = fileURLToPath(new URL('../../.local-stack/jwt-secret', import.meta.url));
let secret = process.env.LOCAL_JWT_SECRET;
if (!secret && fs.existsSync(jwtSecretFile)) {
  secret = fs.readFileSync(jwtSecretFile, 'utf8').trim();
}

if (!secret || secret === 'local-dev-jwt-secret-change-me-at-least-32-chars') {
  console.error('ERROR: LOCAL_JWT_SECRET is unset or using insecure default. Run scripts/local-stack/setup.sh or set LOCAL_JWT_SECRET.');
  process.exit(1);
}

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const sign = (payload) => {
  const head = b64({ alg: 'HS256', typ: 'JWT' });
  const body = b64(payload);
  const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
};
const exp = Math.floor(Date.now() / 1000) + 10 * 365 * 24 * 3600;
console.log(`LOCAL_ANON_KEY=${sign({ role: 'anon', iss: 'supabase-local', exp })}`);
console.log(`LOCAL_SERVICE_ROLE_KEY=${sign({ role: 'service_role', iss: 'supabase-local', exp })}`);
