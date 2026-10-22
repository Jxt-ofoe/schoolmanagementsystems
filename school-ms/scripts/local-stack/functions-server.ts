// LOCAL ONLY: serve supabase/functions/* at /functions/v1/<name> (mimics the Edge runtime router).
import { handler as inviteUser } from '../../supabase/functions/invite-user/index.ts';

const routes: Record<string, (req: Request) => Promise<Response>> = { 'invite-user': inviteUser };

Deno.serve({ hostname: '127.0.0.1', port: 8000 }, (req) => {
  const name = new URL(req.url).pathname.replace(/^\/functions\/v1\//, '').split('/')[0];
  const fn = routes[name];
  return fn ? fn(req) : new Response(JSON.stringify({ error: 'Function not found' }), { status: 404 });
});
