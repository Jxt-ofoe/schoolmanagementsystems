import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://simskpwdkbcudmgzjsib.supabase.co';
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_3awl3YZ_9dzYOyLGRv0EWw_0e2o3z_x';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'sb_secret_WIQRhbLScCi4Z8y4dJ2klg_tJVgB3SI';

export async function handleCreateStaff(body, authHeader) {
  const { email, password, full_name, role, school_id } = body;
  if (!email || !password || !full_name || !school_id || !role) {
    throw new Error('All fields are required (name, email, password, role, school)');
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

  // Verify caller is super_admin or headmaster
  const { data: sa } = await adminClient.from('platform_admins').select('user_id').eq('user_id', callerId).maybeSingle();
  const isSuperAdmin = !!sa;

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
    if (!m || m.role !== 'headmaster' || m.status !== 'active') {
      throw new Error('Unauthorized to add staff to this school');
    }
  }

  // 2. Create or update user in Supabase Auth
  const { data: listData } = await adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const existingUser = listData?.users?.find((u) => u.email?.toLowerCase() === email.trim().toLowerCase());
  let userId;

  if (!existingUser) {
    const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
      email: email.trim().toLowerCase(),
      password,
      email_confirm: true,
      user_metadata: { full_name: full_name.trim() },
    });
    if (createErr) throw createErr;
    userId = created.user.id;
  } else {
    userId = existingUser.id;
    const { error: updateErr } = await adminClient.auth.admin.updateUserById(userId, {
      password,
      email_confirm: true,
      user_metadata: { full_name: full_name.trim() },
    });
    if (updateErr) throw updateErr;
  }

  // 3. Upsert profile
  await adminClient.from('profiles').upsert({
    id: userId,
    email: email.trim().toLowerCase(),
    full_name: full_name.trim(),
  });

  // 4. Upsert membership
  const { data: existingMem } = await adminClient
    .from('school_memberships')
    .select('id, role, status')
    .eq('school_id', school_id)
    .eq('user_id', userId)
    .maybeSingle();

  if (existingMem) {
    await adminClient
      .from('school_memberships')
      .update({ role, status: 'active' })
      .eq('id', existingMem.id);
  } else {
    const { error: memErr } = await adminClient.from('school_memberships').insert({
      school_id,
      user_id: userId,
      role,
      status: 'active',
    });
    if (memErr) throw memErr;
  }

  // 5. Audit log
  await adminClient.from('audit_logs').insert({
    school_id,
    actor_id: callerId,
    actor_role: isSuperAdmin ? 'super_admin' : 'headmaster',
    action: `${role}.created`,
    entity_type: 'membership',
    entity_id: userId,
    metadata: { role, email: email.trim().toLowerCase(), full_name: full_name.trim(), outcome: existingUser ? 'updated' : 'created' },
  });

  return { success: true, user_id: userId, outcome: existingUser ? 'updated' : 'created' };
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
