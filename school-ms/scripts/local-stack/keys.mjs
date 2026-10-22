// LOCAL ONLY: derive anon/service_role JWTs from the local JWT secret.
import { createHmac } from 'node:crypto';
const secret = process.env.LOCAL_JWT_SECRET ?? 'local-dev-jwt-secret-change-me-at-least-32-chars';
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
