const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const envFile = path.resolve(__dirname, '../.env.local');
const env = {};
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const [k, ...v] = line.trim().split('=');
    if (k && v.length) env[k] = v.join('=').trim();
  }
}

const adminSupabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

async function testAsUser(email, label) {
  console.log(`\n========================================`);
  console.log(`Testing as ${label} (${email})`);
  console.log(`========================================`);

  // Sign in or get token
  let client;
  // Let's create session using admin.generateLink or sign in with password
  // Try signing in with common passwords or generate link
  let sessionToken = null;
  const passwordsToTry = ['SchoolHead2026!', 'TeacherPass2026!', 'Password123!', 'admin123456', 'superadmin2026'];
  for (const pwd of passwordsToTry) {
    const anon = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
    const { data, error } = await anon.auth.signInWithPassword({ email, password: pwd });
    if (!error && data.session) {
      sessionToken = data.session.access_token;
      client = anon;
      console.log(`Signed in successfully with password.`);
      break;
    }
  }

  if (!sessionToken) {
    console.log(`Could not password sign-in, creating client with service role impersonation via jwt or rpc...`);
    // We can test RPCs directly if we know the user ID
    const { data: { users } } = await adminSupabase.auth.admin.listUsers();
    const u = users.find(x => x.email === email);
    if (!u) {
      console.error(`User not found: ${email}`);
      return;
    }
    // We can set user session by generating magiclink and extracting token or verifyOtp
    const { data: linkData, error: lErr } = await adminSupabase.auth.admin.generateLink({
      type: 'magiclink',
      email: email,
    });
    if (lErr) {
      console.error('generateLink error:', lErr);
      return;
    }
    const token_hash = linkData.properties.hashed_token;
    const anon = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
    const { data: verifyData, error: vErr } = await anon.auth.verifyOtp({
      token_hash,
      type: 'magiclink',
    });
    if (vErr) {
      console.error('verifyOtp error:', vErr);
      return;
    }
    client = anon;
    console.log(`Signed in via OTP token for ${email}.`);
  }

  // 1. Test my_context
  console.log('--> Calling rpc("my_context")...');
  const t0 = Date.now();
  const { data: ctx, error: ctxErr } = await client.rpc('my_context');
  const d0 = Date.now() - t0;
  if (ctxErr) console.error(`my_context FAILED (${d0}ms):`, ctxErr.message);
  else console.log(`my_context OK (${d0}ms), is_super:`, ctx?.is_super_admin, 'memberships:', ctx?.memberships?.length);

  // 2. If super admin, test platform_dashboard
  if (ctx?.is_super_admin) {
    console.log('--> Calling rpc("platform_dashboard")...');
    const t1 = Date.now();
    const { data: pd, error: pdErr } = await client.rpc('platform_dashboard');
    const d1 = Date.now() - t1;
    if (pdErr) console.error(`platform_dashboard FAILED (${d1}ms):`, pdErr.message, pdErr.details || '');
    else console.log(`platform_dashboard OK (${d1}ms):`, pd);

    console.log('--> Calling rpc("platform_school_summaries")...');
    const t2 = Date.now();
    const { data: pss, error: pssErr } = await client.rpc('platform_school_summaries');
    const d2 = Date.now() - t2;
    if (pssErr) console.error(`platform_school_summaries FAILED (${d2}ms):`, pssErr.message, pssErr.details || '');
    else console.log(`platform_school_summaries OK (${d2}ms), rows:`, pss?.length);
  }

  // 3. If school member (headmaster or teacher)
  if (ctx?.memberships?.length) {
    for (const m of ctx.memberships.slice(0, 2)) {
      const schoolId = m.school_id;
      const today = new Date().toISOString().split('T')[0];

      if (m.role === 'headmaster') {
        console.log(`--> Calling rpc("headmaster_dashboard") for school ${m.school_name}...`);
        const t3 = Date.now();
        const { data: hd, error: hdErr } = await client.rpc('headmaster_dashboard', {
          p_school_id: schoolId,
          p_date: today,
        });
        const d3 = Date.now() - t3;
        if (hdErr) console.error(`headmaster_dashboard FAILED (${d3}ms):`, hdErr.message, hdErr.details || '');
        else console.log(`headmaster_dashboard OK (${d3}ms):`, hd);

        // Also test the fees query in SchoolDashboard
        const currentSem = hd?.current_semester?.id;
        if (currentSem) {
          console.log(`--> Calling fee queries for semester ${currentSem}...`);
          const t4 = Date.now();
          const p1 = client.from('student_fee_charges').select('amount, discount_amount').eq('school_id', schoolId).eq('semester_id', currentSem);
          const p2 = client.from('student_fee_payments').select('amount').eq('school_id', schoolId).eq('semester_id', currentSem).eq('status', 'valid');
          const [r1, r2] = await Promise.all([p1, p2]);
          const d4 = Date.now() - t4;
          if (r1.error) console.error(`fee_charges query FAILED (${d4}ms):`, r1.error.message);
          if (r2.error) console.error(`fee_payments query FAILED (${d4}ms):`, r2.error.message);
          if (!r1.error && !r2.error) console.log(`fee queries OK (${d4}ms)`);
        }
      }

      if (m.role === 'teacher') {
        console.log(`--> Calling rpc("teacher_dashboard") for school ${m.school_name}...`);
        const t5 = Date.now();
        const { data: td, error: tdErr } = await client.rpc('teacher_dashboard', {
          p_school_id: schoolId,
          p_date: today,
        });
        const d5 = Date.now() - t5;
        if (tdErr) console.error(`teacher_dashboard FAILED (${d5}ms):`, tdErr.message, tdErr.details || '');
        else console.log(`teacher_dashboard OK (${d5}ms):`, td);
      }
    }
  }
}

async function main() {
  // Find super admin email
  const { data: admins } = await adminSupabase.from('platform_admins').select('user_id');
  let superEmail = 'eofoe02@mail.com';
  if (admins && admins.length) {
    const { data: { user } } = await adminSupabase.auth.admin.getUserById(admins[0].user_id);
    if (user) superEmail = user.email;
  }

  // 1. Test Super Admin
  await testAsUser(superEmail, 'Super Admin');

  // 2. Test Headmaster of Achimota Model
  await testAsUser('headmaster@achimota-model.edu.gh', 'Headmaster Achimota');

  // 3. Test Teacher of Achimota Model
  await testAsUser('teacher01@achimota-model.edu.gh', 'Teacher Achimota');
}

main();
