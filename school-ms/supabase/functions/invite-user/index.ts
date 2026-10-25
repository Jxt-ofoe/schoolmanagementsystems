/**
 * invite-user — create staff accounts safely.
 *
 *  - Super admin may invite a HEADMASTER or TEACHER to any school.
 *  - A headmaster may invite TEACHERS to their own (active) school only.
 *
 * The invited person receives an email from Supabase Auth with a link to set
 * their own password. No password is ever generated, returned or seen by the
 * inviter. The service-role key is used only here, server-side.
 */
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders, json } from '../_shared/cors.ts';

type Role = 'headmaster' | 'teacher';
interface InviteBody { email?: unknown; full_name?: unknown; role?: unknown; school_id?: unknown }

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validate(body: InviteBody): { email: string; full_name: string; role: Role; school_id: string } | string {
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const full_name = typeof body.full_name === 'string' ? body.full_name.trim() : '';
  const role = body.role;
  const school_id = typeof body.school_id === 'string' ? body.school_id : '';
  if (!EMAIL_RE.test(email) || email.includes('%') || email.includes('_') || email.length > 150) return 'A valid email address is required';
  if (full_name.length < 2 || full_name.length > 120) return 'Full name must be 2–120 characters';
  if (role !== 'headmaster' && role !== 'teacher') return 'Role must be headmaster or teacher';
  if (!UUID_RE.test(school_id)) return 'A valid school is required';
  return { email, full_name, role, school_id };
}

async function findUserIdByEmail(admin: SupabaseClient, email: string): Promise<string | null> {
  const { data } = await admin.from('profiles').select('id').eq('email', email).maybeSingle();
  return data?.id ?? null;
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  // The invitation link must point at OUR app. Never derive it from request headers (spoofable).
  const siteUrl = (Deno.env.get('SITE_URL') ?? '').replace(/\/+$/, '');
  if (!url || !anonKey || !serviceKey || !/^https?:\/\//.test(siteUrl)) {
    return json(req, { error: 'Server is not configured (SUPABASE_* or SITE_URL secret missing)' }, 500);
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json(req, { error: 'Not signed in' }, 401);

  // Identify the caller from their own JWT
  const caller = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } });
  const { data: userData, error: userErr } = await caller.auth.getUser(authHeader.slice(7));
  if (userErr || !userData.user) return json(req, { error: 'Not signed in' }, 401);
  const callerId = userData.user.id;

  let body: InviteBody;
  try { body = await req.json(); } catch { return json(req, { error: 'Invalid JSON body' }, 400); }
  const input = validate(body);
  if (typeof input === 'string') return json(req, { error: input }, 400);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // ---- authorization (server-side, never trust the client) ----
  const { data: sa } = await admin.from('platform_admins').select('user_id').eq('user_id', callerId).maybeSingle();
  const isSuperAdmin = !!sa;
  const { data: school } = await admin.from('schools').select('id, name, status').eq('id', input.school_id).maybeSingle();
  if (!school) return json(req, { error: 'School not found' }, 404);

  if (!isSuperAdmin) {
    if (input.role !== 'teacher') return json(req, { error: 'Only the platform super admin can invite headmasters' }, 403);
    const { data: m } = await admin.from('school_memberships').select('role, status')
      .eq('school_id', input.school_id).eq('user_id', callerId).maybeSingle();
    if (!m || m.role !== 'headmaster' || m.status !== 'active' || school.status !== 'active') {
      return json(req, { error: 'You can only invite teachers to your own active school' }, 403);
    }
  }

  // ---- create or reuse the auth user ----
  let userId = await findUserIdByEmail(admin, input.email);
  let outcome: 'invited' | 'added_existing' = 'added_existing';
  if (!userId) {
    const { data, error } = await admin.auth.admin.inviteUserByEmail(input.email, {
      data: { full_name: input.full_name },
      redirectTo: siteUrl ? `${siteUrl.replace(/\/$/, '')}/set-password` : undefined,
    });
    if (error || !data.user) {
      return json(req, { error: `Could not send invitation: ${error?.message ?? 'unknown error'}` }, 502);
    }
    userId = data.user.id;
    outcome = 'invited';
    await admin.from('profiles').update({ full_name: input.full_name }).eq('id', userId);
  } else {
    // Security check: cannot invite or attach a platform administrator
    const { data: targetAdmin } = await admin.from('platform_admins').select('user_id').eq('user_id', userId).maybeSingle();
    if (targetAdmin) return json(req, { error: 'Platform Super Admins cannot be added as school staff' }, 403);

    // Non-super-admins cannot attach an active headmaster from another school
    if (!isSuperAdmin) {
      const { data: hm } = await admin.from('school_memberships').select('school_id')
        .eq('user_id', userId).eq('role', 'headmaster').eq('status', 'active').maybeSingle();
      if (hm && hm.school_id !== input.school_id) {
        return json(req, { error: 'Cannot attach an active Headmaster from another school' }, 403);
      }
    }
  }

  const { data: existing } = await admin.from('school_memberships').select('id, role, status')
    .eq('school_id', input.school_id).eq('user_id', userId).maybeSingle();
  if (existing) {
    return json(req, { error: `This person is already a ${existing.role} at ${school.name} (${existing.status})` }, 409);
  }

  const { error: memErr } = await admin.from('school_memberships')
    .insert({ school_id: input.school_id, user_id: userId, role: input.role });
  if (memErr) return json(req, { error: 'Could not add membership' }, 500);

  // Explicit audit entry attributing the invitation to the caller (no secrets)
  await admin.from('audit_logs').insert({
    school_id: input.school_id,
    actor_id: callerId,
    actor_role: isSuperAdmin ? 'super_admin' : 'headmaster',
    action: `${input.role}.invited`,
    entity_type: 'membership',
    entity_id: userId,
    metadata: { role: input.role, email: input.email, outcome },
  });

  return json(req, { user_id: userId, outcome });
}

if (import.meta.main) Deno.serve(handler);
