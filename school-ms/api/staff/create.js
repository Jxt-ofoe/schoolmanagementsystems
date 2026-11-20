import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const createStaffSchema = z.object({
  email: z.string().trim().toLowerCase().email('Invalid email address').max(150),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters long')
    .max(72, 'Password must be at most 72 characters')
    .regex(/[A-Za-z]/, 'Password must contain at least one letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
  full_name: z.string().trim().min(2, 'Full name must be at least 2 characters').max(120),
  role: z.enum(['headmaster', 'teacher'], { error: 'Role must be headmaster or teacher' }),
  school_id: z.string().uuid('Invalid school ID format'),
});

export async function handleCreateStaff(rawBody, authHeader) {
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
    throw new Error('Server configuration error: SUPABASE environment variables are not configured');
  }

  // 1. Zod input validation
  const parseResult = createStaffSchema.safeParse(rawBody);
  if (!parseResult.success) {
    const errorMsg = parseResult.error.issues.map((i) => i.message).join('; ');
    throw new Error(`Invalid input: ${errorMsg}`);
  }

  const { email: normEmail, password, full_name: normName, role, school_id } = parseResult.data;

  // Additional email hygiene: reject pattern wildcards
  if (normEmail.includes('%') || normEmail.includes('_')) {
    throw new Error('A valid email address is required');
  }

  // 2. Verify caller is authorized
  const token = (authHeader || '').replace(/^Bearer\s+/i, '');
  if (!token) {
    throw new Error('Unauthorized: please sign in again');
  }

  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await callerClient.auth.getUser(token);
  if (userErr || !userData?.user) {
    throw new Error('Unauthorized: please sign in again');
  }
  const callerId = userData.user.id;

  const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Verify caller is super_admin or headmaster of this school
  const { data: sa } = await adminClient.from('platform_admins').select('user_id').eq('user_id', callerId).maybeSingle();
  const isSuperAdmin = !!sa;

  const { data: school } = await adminClient.from('schools').select('id, name, status').eq('id', school_id).maybeSingle();
  if (!school) {
    throw new Error('School not found');
  }

  if (!isSuperAdmin) {
    if (role !== 'teacher') {
      throw new Error('Only Platform Super Admins can create Headmasters');
    }
    const { data: m } = await adminClient
      .from('school_memberships')
      .select('role, status')
      .eq('school_id', school_id)
      .eq('user_id', callerId)
      .maybeSingle();
    if (!m || m.role !== 'headmaster' || m.status !== 'active' || school.status !== 'active') {
      throw new Error('Unauthorized to add staff to this school');
    }
  }

  // 3. Search for existing user safely
  const { data: listData } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const existingUser = listData?.users?.find((u) => u.email?.toLowerCase() === normEmail);
  let userId;
  let outcome = 'created';

  if (!existingUser) {
    // Create new user account with initial password
    const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
      email: normEmail,
      password,
      email_confirm: true,
      user_metadata: { full_name: normName },
    });
    if (createErr) throw createErr;
    userId = created.user.id;
  } else {
    userId = existingUser.id;
    outcome = 'added_existing';

    // Security Check: Target user cannot be a platform administrator
    const { data: targetAdmin } = await adminClient.from('platform_admins').select('user_id').eq('user_id', userId).maybeSingle();
    if (targetAdmin) {
      throw new Error('Platform Super Admin accounts cannot be added or modified through staff creation');
    }

    // Security Check: Non-super-admins cannot reassign active headmasters from other schools
    if (!isSuperAdmin) {
      const { data: targetHeadmaster } = await adminClient
        .from('school_memberships')
        .select('school_id, role, status')
        .eq('user_id', userId)
        .eq('role', 'headmaster')
        .eq('status', 'active')
        .maybeSingle();
      if (targetHeadmaster && targetHeadmaster.school_id !== school_id) {
        throw new Error('Cannot add an active Headmaster from another school as a teacher');
      }
    }
  }

  // 4. Upsert profile (only create if new to avoid cross-tenant name tampering)
  if (outcome === 'created') {
    await adminClient.from('profiles').upsert({
      id: userId,
      email: normEmail,
      full_name: normName,
    });
  }

  // 5. Verify membership doesn't already exist in this school
  const { data: existingMem } = await adminClient
    .from('school_memberships')
    .select('id, role, status')
    .eq('school_id', school_id)
    .eq('user_id', userId)
    .maybeSingle();

  if (existingMem) {
    throw new Error(`This person is already a ${existingMem.role} at ${school.name} (${existingMem.status})`);
  }

  const { error: memErr } = await adminClient.from('school_memberships').insert({
    school_id,
    user_id: userId,
    role,
    status: 'active',
  });
  if (memErr) throw memErr;

  // 6. Audit log
  await adminClient.from('audit_logs').insert({
    school_id,
    actor_id: callerId,
    actor_role: isSuperAdmin ? 'super_admin' : 'headmaster',
    action: `${role}.created`,
    entity_type: 'membership',
    entity_id: userId,
    metadata: { role, email: normEmail, full_name: normName, outcome },
  });

  return { success: true, user_id: userId, outcome };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
    if (body.length > 50000) {
      req.destroy();
    }
  });
  req.on('end', async () => {
    try {
      const data = typeof body === 'string' && body ? JSON.parse(body) : req.body || {};
      const authHeader = req.headers['authorization'];
      const result = await handleCreateStaff(data, authHeader);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(result));
    } catch (err) {
      console.error('Create staff error:', err);
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: err.message || 'Failed to create staff account' }));
    }
  });
}
