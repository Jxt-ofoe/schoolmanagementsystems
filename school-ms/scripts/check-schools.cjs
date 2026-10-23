const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://simskpwdkbcudmgzjsib.supabase.co';
const SERVICE_KEY = 'sb_secret_WIQRhbLScCi4Z8y4dJ2klg_tJVgB3SI';

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
