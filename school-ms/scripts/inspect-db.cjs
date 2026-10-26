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
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function inspect() {
  const tables = [
    'schools', 'profiles', 'school_memberships', 'classes', 'subjects',
    'teacher_assignments', 'students', 'student_enrollments', 'assessments',
    'scores', 'grading_scales', 'grading_scale_bands', 'attendance_sessions',
    'attendance_records', 'semester_billing', 'payments', 'audit_logs',
    'examinations', 'subject_result_submissions', 'terminal_reports',
    'fee_categories', 'fee_structures', 'student_fee_charges', 'student_fee_payments',
    'student_promotions'
  ];

  console.log('Checking tables existence...');
  for (const t of tables) {
    const { data, error } = await supabase.from(t).select('id').limit(1);
    if (error) {
      console.log(`[-] ${t}: Not found / Error (${error.code}: ${error.message})`);
    } else {
      console.log(`[+] ${t}: EXISTS (count sample: ${data.length})`);
    }
  }
}

inspect();
