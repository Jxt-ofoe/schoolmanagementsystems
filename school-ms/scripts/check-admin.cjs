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

async function checkAdmin() {
  const { data: { user } } = await adminSupabase.auth.admin.getUserById('f8f4eaf9-e5ff-4227-a6b8-b322921dfab5');
  console.log('Super admin details:', user ? user.email : 'not found');

  // Generate link to sign in
  const { data: linkData } = await adminSupabase.auth.admin.generateLink({
    type: 'magiclink',
    email: user.email,
  });
  const anon = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
  await anon.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: 'magiclink',
  });

  console.log('Signed in as super admin. Calling platform_dashboard...');
  const t0 = Date.now();
  const { data: pd, error: pdErr } = await anon.rpc('platform_dashboard');
  const d0 = Date.now() - t0;
  if (pdErr) {
    console.error(`platform_dashboard FAILED (${d0}ms):`, pdErr.message);
  } else {
    console.log(`platform_dashboard OK (${d0}ms):`, pd);
  }

  console.log('Calling platform_school_summaries...');
  const t1 = Date.now();
  const { data: pss, error: pssErr } = await anon.rpc('platform_school_summaries');
  const d1 = Date.now() - t1;
  if (pssErr) {
    console.error(`platform_school_summaries FAILED (${d1}ms):`, pssErr.message);
  } else {
    console.log(`platform_school_summaries OK (${d1}ms): ${pss.length} schools`);
  }
}
checkAdmin();
