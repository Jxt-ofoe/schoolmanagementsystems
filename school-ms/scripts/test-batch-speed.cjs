const { createClient } = require('@supabase/supabase-js');

const fs = require('fs');
const path = require('path');
const envFile = path.resolve(__dirname, '../.env.local');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const [k, ...v] = line.trim().split('=');
    if (k && v.length && !process.env[k]) process.env[k] = v.join('=').trim();
  }
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (set in .env.local)');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function run() {
  // Find a school
  const { data: schools } = await supabase.from('schools').select('id, name, code').limit(1);
  const school = schools[0];
  console.log('Testing with school:', school.name, school.id);

  // Measure 1 batch of 1,000 students
  const sampleStudents = [];
  const startNum = 90000;
  for (let i = 0; i < 1000; i++) {
    const num = startNum + i;
    sampleStudents.push({
      school_id: school.id,
      admission_number: `TEST/${num}`,
      first_name: `TestFirst${i % 100}`,
      last_name: `TestLast${Math.floor(i / 100)}`,
      gender: i % 2 === 0 ? 'male' : 'female',
      date_of_birth: `2012-01-01`, // wait! Notice identity constraint: first_name, last_name, date_of_birth!
      admission_date: '2026-09-01',
      enrollment_status: 'active',
      guardian_name: `Guardian Test ${i}`,
      guardian_phone: '0241234567',
    });
  }

  // Adjust dates of birth so (first_name, last_name, date_of_birth) is unique!
  for (let i = 0; i < 1000; i++) {
    const day = (i % 28) + 1;
    const month = ((Math.floor(i / 28)) % 12) + 1;
    const year = 2005 + Math.floor(i / (28 * 12));
    sampleStudents[i].date_of_birth = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  console.log('Inserting 1000 students in 2 batches of 500...');
  const t0 = Date.now();
  const { error: err1 } = await supabase.from('students').insert(sampleStudents.slice(0, 500));
  if (err1) {
    console.error('Batch 1 error:', err1);
    return;
  }
  const t1 = Date.now();
  console.log(`Batch 1 (500 rows) took ${t1 - t0}ms`);

  const { error: err2 } = await supabase.from('students').insert(sampleStudents.slice(500, 1000));
  if (err2) {
    console.error('Batch 2 error:', err2);
    return;
  }
  const t2 = Date.now();
  console.log(`Batch 2 (500 rows) took ${t2 - t1}ms. Total: ${t2 - t0}ms`);

  // Clean up test students
  console.log('Cleaning up test students...');
  const { error: delErr } = await supabase.from('students').delete().ilike('admission_number', 'TEST/%');
  if (delErr) console.error('Delete error:', delErr);
  else console.log('Cleaned up test students.');
}

run();
