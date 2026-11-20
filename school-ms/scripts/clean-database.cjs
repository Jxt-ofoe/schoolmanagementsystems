const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// 1. Load environment variables
const envFile = path.resolve(__dirname, '../.env.local');
const env = {};
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const [k, ...v] = line.trim().split('=');
    if (k && v.length) env[k] = v.join('=').trim();
  }
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (set in .env.local)');
  process.exit(1);
}

console.log('Target SUPABASE_URL:', SUPABASE_URL);

// Guard: refuse to run unless --confirm <project-ref> is passed AND ALLOW_DESTRUCTIVE=1 is set
const args = process.argv.slice(2);
const confirmIdx = args.indexOf('--confirm');
const confirmRef = confirmIdx !== -1 ? args[confirmIdx + 1] : null;

let expectedRef = '';
try {
  expectedRef = new URL(SUPABASE_URL).hostname.split('.')[0];
} catch {
  expectedRef = 'unknown';
}

if (process.env.ALLOW_DESTRUCTIVE !== '1' || !confirmRef || confirmRef !== expectedRef) {
  console.error('Refusing to run destructive script:');
  console.error(`Requires ALLOW_DESTRUCTIVE=1 environment variable AND --confirm ${expectedRef}`);
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

// Identify Platform Super Admin user ID
const SUPER_ADMIN_EMAIL = 'eofoe02@mail.com';

async function cleanDatabase() {
  console.log('====================================================');
  console.log('STARTING COMPLETE DATABASE CLEAN SLATE RESET');
  console.log('====================================================');

  // 1. Find Super Admin ID
  const { data: { users }, error: usersErr } = await supabase.auth.admin.listUsers();
  if (usersErr) {
    console.error('Failed to list auth users:', usersErr);
    process.exit(1);
  }

  const superAdmin = users.find(u => u.email?.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase());
  const superAdminId = superAdmin ? superAdmin.id : 'f8f4eaf9-e5ff-4227-a6b8-b322921dfab5';
  console.log(`Preserving Super Admin: ${SUPER_ADMIN_EMAIL} (${superAdminId})`);

  // 2. Child-to-parent deletion order
  const tablesToWipe = [
    'audit_logs',
    'billing_reminders',
    'paystack_transactions',
    'payments',
    'semester_billing',
    'school_billing_configs',
    'student_fee_payments',
    'student_fee_charges',
    'fee_structures',
    'fee_categories',
    'terminal_reports',
    'subject_result_submissions',
    'scores',
    'assessments',
    'attendance_records',
    'attendance_sessions',
    'exam_timetables',
    'examinations',
    'student_promotions',
    'student_enrollments',
    'students',
    'teacher_assignments',
    'classes',
    'subjects',
    'grading_scale_bands',
    'grading_scales',
    'semesters',
    'academic_years',
    'communication_logs',
    'communication_batches',
    'communication_templates',
    'communication_settings',
    'payment_authorizations',
    'school_settings',
    'school_memberships',
    'schools',
  ];

  for (const table of tablesToWipe) {
    try {
      // Check count first
      const { count } = await supabase.from(table).select('*', { count: 'exact', head: true });
      if (count && count > 0) {
        // Delete rows
        let delRes;
        if (table === 'audit_logs') {
          delRes = await supabase.from(table).delete().gt('id', 0);
        } else {
          // Attempt delete with uuid filter or not null
          delRes = await supabase.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000');
        }
        if (delRes.error) {
          console.warn(`Warning deleting ${table}:`, delRes.error.message);
        } else {
          console.log(`✓ Cleaned ${table}: wiped ${count} records`);
        }
      } else {
        console.log(`- ${table}: already empty`);
      }
    } catch (e) {
      console.warn(`Exception checking ${table}:`, e.message);
    }
  }

  // 3. Clean up non-admin profiles
  console.log('Cleaning non-admin profiles...');
  const { error: profErr } = await supabase
    .from('profiles')
    .delete()
    .neq('id', superAdminId);
  if (profErr) console.warn('Warning cleaning profiles:', profErr.message);
  else console.log('✓ Cleaned profiles (kept super admin profile)');

  // Ensure super admin profile exists
  await supabase.from('profiles').upsert({
    id: superAdminId,
    email: SUPER_ADMIN_EMAIL,
    full_name: 'Super Admin',
  });

  // Ensure super admin in platform_admins
  await supabase.from('platform_admins').upsert({
    user_id: superAdminId,
  });
  console.log('✓ Ensured super admin platform_admins entry');

  // 4. Delete non-admin auth users
  console.log('Cleaning non-admin auth users...');
  let deletedAuthUsers = 0;
  for (const user of users) {
    if (user.id !== superAdminId) {
      const { error: delUserErr } = await supabase.auth.admin.deleteUser(user.id);
      if (delUserErr) {
        console.warn(`Could not delete auth user ${user.email} (${user.id}):`, delUserErr.message);
      } else {
        deletedAuthUsers++;
      }
    }
  }
  console.log(`✓ Deleted ${deletedAuthUsers} non-admin auth user(s)`);

  // 5. Reset platform_settings
  console.log('Resetting platform settings...');
  const { error: setErr } = await supabase.from('platform_settings').upsert({
    id: true,
    price_per_student: 3.00,
    currency: 'GHS',
    billing_due_days: 7,
    void_grace_days: 14,
    updated_at: new Date().toISOString(),
  });
  if (setErr) console.warn('Warning updating platform_settings:', setErr.message);
  else console.log('✓ Reset platform_settings (GHS 3.00 per student per term)');

  // 6. Final wipe of audit_logs triggered by cascade deletions
  console.log('Final purge of audit_logs...');
  await supabase.from('audit_logs').delete().gt('id', 0);
  console.log('✓ Purged all residual audit_logs');

  // 7. Verify final database state
  console.log('\n====================================================');
  console.log('FINAL DATABASE VERIFICATION:');
  console.log('====================================================');
  const verifyTables = [
    'schools',
    'profiles',
    'platform_admins',
    'platform_settings',
    'students',
    'classes',
    'academic_years',
    'semesters',
    'audit_logs',
    'semester_billing',
    'payments',
    'fee_structures',
    'student_fee_payments',
  ];

  for (const t of verifyTables) {
    const { count } = await supabase.from(t).select('*', { count: 'exact', head: true });
    console.log(`  * ${t.padEnd(25)}: ${count} rows`);
  }

  console.log('\nDatabase is completely fresh and ready.');
}

cleanDatabase().catch(err => {
  console.error('Fatal error during cleanDatabase:', err);
  process.exit(1);
});
