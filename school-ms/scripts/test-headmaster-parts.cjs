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

async function testParts() {
  const email = process.env.SEED_HM_EMAIL || 'headmaster@achimota-model.edu.gh';
  const password = process.env.SEED_HM_PASSWORD;
  if (!password) {
    console.error('Missing SEED_HM_PASSWORD environment variable');
    process.exit(1);
  }
  const anon = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
  await anon.auth.signInWithPassword({
    email,
    password,
  });

  const { data: ctx } = await anon.rpc('my_context');
  const schoolId = ctx.memberships[0].school_id;
  console.log('Testing for schoolId:', schoolId);

  // 1. Current semester
  const { data: sem } = await anon.from('semesters').select('*').eq('school_id', schoolId).eq('is_current', true).single();
  console.log('Current semester:', sem?.id, sem?.name);

  // 2. Count active students
  let t = Date.now();
  const { count: sActive } = await anon.from('students').select('*', { count: 'exact', head: true }).eq('school_id', schoolId).eq('enrollment_status', 'active');
  console.log(`students_active: ${sActive} in ${Date.now() - t}ms`);

  // 3. Count total students
  t = Date.now();
  const { count: sTotal } = await anon.from('students').select('*', { count: 'exact', head: true }).eq('school_id', schoolId);
  console.log(`students_total: ${sTotal} in ${Date.now() - t}ms`);

  // 4. Count unplaced students
  t = Date.now();
  const { count: sUnplaced } = await anon.from('students').select('*', { count: 'exact', head: true }).eq('school_id', schoolId).eq('enrollment_status', 'active').is('current_class_id', null);
  console.log(`students_unplaced: ${sUnplaced} in ${Date.now() - t}ms`);

  // 5. Registered this semester
  t = Date.now();
  const { count: sReg } = await anon.from('student_enrollments').select('*', { count: 'exact', head: true }).eq('semester_id', sem.id).neq('status', 'voided');
  console.log(`registered_this_semester: ${sReg} in ${Date.now() - t}ms`);

  // 6. Grade entry status
  t = Date.now();
  console.log('Testing grade_entry_status rpc...');
  try {
    const { data: ges, error: gesErr } = await anon.rpc('grade_entry_status', {
      p_school_id: schoolId,
      p_semester_id: sem.id,
    });
    if (gesErr) {
      console.error(`grade_entry_status FAILED in ${Date.now() - t}ms:`, gesErr.message);
    } else {
      console.log(`grade_entry_status OK in ${Date.now() - t}ms, rows: ${ges.length}`);
    }
  } catch (err) {
    console.error(`grade_entry_status EXCEPTION in ${Date.now() - t}ms:`, err.message);
  }

  // 7. Attendance trend
  t = Date.now();
  console.log('Testing attendance_records for last 14 days...');
  const { count: attCount, error: attErr } = await anon.from('attendance_records').select('*', { count: 'exact', head: true }).eq('school_id', schoolId);
  console.log(`attendance count: ${attCount} in ${Date.now() - t}ms`, attErr?.message || '');
}

testParts();

