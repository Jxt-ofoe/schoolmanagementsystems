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
  const { data: schools, error: sErr } = await supabase.from('schools').select('id, name, code, status');
  if (sErr) {
    console.error('Error fetching schools:', sErr);
    return;
  }
  console.log('Total schools:', schools.length);

  const { data: students, error: stuErr } = await supabase.from('students').select('school_id');
  if (stuErr) {
    console.error('Error fetching students:', stuErr);
    return;
  }
  console.log('Total existing students:', students.length);

  const studentCountMap = {};
  for (const stu of students) {
    studentCountMap[stu.school_id] = (studentCountMap[stu.school_id] || 0) + 1;
  }

  const schoolsWithStudents = [];
  for (const s of schools) {
    const c = studentCountMap[s.id] || 0;
    if (c > 0) {
      schoolsWithStudents.push({ name: s.name, code: s.code, count: c });
    }
  }

  console.log('Schools that currently have students:', schoolsWithStudents);
}

run();
