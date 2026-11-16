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
const supabase = createClient(env.VITE_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
async function check() {
  const { data: schools } = await supabase.from('schools').select('id, name, code');
  console.log('Total schools in DB:', schools.length);
  for (const s of schools) {
    const { count: studentCount } = await supabase.from('students').select('*', { count: 'exact', head: true }).eq('school_id', s.id);
    const { count: staffCount } = await supabase.from('school_memberships').select('*', { count: 'exact', head: true }).eq('school_id', s.id);
    console.log(` - ${s.name} (${s.code}): ${studentCount} students, ${staffCount} staff`);
  }
}
check();

