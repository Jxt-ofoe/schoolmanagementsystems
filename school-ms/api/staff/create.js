import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://simskpwdkbcudmgzjsib.supabase.co';
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_3awl3YZ_9dzYOyLGRv0EWw_0e2o3z_x';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function handleCreateStaff(body, authHeader) {
  if (!SERVICE_KEY) {
    throw new Error('Server configuration error: SUPABASE_SERVICE_ROLE_KEY environment variable is not configured');
  }

  const { email, password, full_name, role, school_id } = body;
  if (!email || !password || !full_name || !school_id || !role) {
    throw new Error('All fields are required (name, email, password, role, school)');
  }

  const normEmail = String(email).trim().toLowerCase();
  const normName = String(full_name).trim();

  // Validate email format and reject pattern wildcards (%, _)
  const EMAIL_RE = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
  if (!EMAIL_RE.test(normEmail) || normEmail.includes('%') || normEmail.includes('_') || normEmail.length > 150) {
    throw new Error('A valid email address is required');
  }
  if (normName.length < 2 || normName.length > 120) {
    throw new Error('Full name must be 2–120 characters');
  }
  if (role !== 'headmaster' && role !== 'teacher') {
    throw new Error('Role must be headmaster or teacher');
  }
  if (password.length < 8) {
    throw new Error('Password must be at least 8 characters long');
  }

  // 1. Verify caller is authorized
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

  // 2. Search for existing user safely
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

    // Security Note: Existing user accounts retain their established credentials.
    // Password is NOT overwritten to protect against account takeover.
  }

  // 3. Upsert profile (only create if new to avoid cross-tenant name tampering)
  if (outcome === 'created') {
    await adminClient.from('profiles').upsert({
      id: userId,
      email: normEmail,
      full_name: normName,
    });
  }

  // 4. Verify membership doesn't already exist in this school
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

  // 5. Audit log
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
  });
  req.on('end', async () => {
    try {
      const data = typeof body === 'string' && body ? JSON.parse(body) : req.body || {};
      const authHeader = req.headers['authorization'];
      const result = await handleCreateStaff(data, authHeader);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(result));
    } catch (err) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: err.message || 'Failed to create staff account' }));
    }
  });
}
