const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// 1. Load environment variables
const envFile = path.resolve(__dirname, '../.env.local');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const [k, ...v] = line.trim().split('=');
    if (k && v.length && !process.env[k]) process.env[k] = v.join('=').trim();
  }
}

// Allow CLI overrides
const args = process.argv.slice(2);
const getArg = (name) => {
  const prefix = `--${name}=`;
  const match = args.find(a => a.startsWith(prefix));
  return match ? match.slice(prefix.length) : null;
};

// Target can be a backup Supabase project or the current one
const TARGET_URL = getArg('target-url') || getArg('url') || process.env.VITE_SUPABASE_URL;
const TARGET_KEY = getArg('target-key') || getArg('key') || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!TARGET_URL || !TARGET_KEY) {
  console.error('Error: Target Supabase URL and Service Role Key must be specified.');
  console.error('Usage: node scripts/restore-db.cjs [--backup=path/to/backup] [--target-url=https://xyz.supabase.co --target-key=your_key]');
  process.exit(1);
}

// Determine backup folder
const baseBackupsDir = path.resolve(__dirname, '../backups');
let backupDir = getArg('backup');

if (!backupDir) {
  const latestTxt = path.join(baseBackupsDir, 'latest/latest_backup.txt');
  if (fs.existsSync(latestTxt)) {
    const latestFolder = fs.readFileSync(latestTxt, 'utf8').trim();
    backupDir = path.join(baseBackupsDir, latestFolder);
  } else {
    // Look for latest folder in backups/
    const all = fs.readdirSync(baseBackupsDir).filter(f => f.startsWith('backup-')).sort().reverse();
    if (all.length > 0) backupDir = path.join(baseBackupsDir, all[0]);
  }
} else if (!path.isAbsolute(backupDir)) {
  backupDir = path.resolve(baseBackupsDir, backupDir);
}

if (!backupDir || !fs.existsSync(backupDir)) {
  console.error(`Error: Backup directory not found: ${backupDir}`);
  process.exit(1);
}

const tablesDir = path.join(backupDir, 'tables');
if (!fs.existsSync(tablesDir)) {
  console.error(`Error: Tables folder missing in backup: ${tablesDir}`);
  process.exit(1);
}

const targetClient = createClient(TARGET_URL, TARGET_KEY, {
  auth: { persistSession: false },
});

// Dependency order for restoration
const TABLES = [
  'schools',
  'profiles',
  'school_settings',
  'school_memberships',
  'academic_years',
  'semesters',
  'classes',
  'subjects',
  'teacher_assignments',
  'grading_scales',
  'grading_scale_bands',
  'fee_categories',
  'fee_structures',
  'students',
  'student_enrollments',
  'assessments',
  'scores',
  'attendance_sessions',
  'attendance_records',
  'examinations',
  'exam_timetables',
  'subject_result_submissions',
  'terminal_reports',
  'student_fee_charges',
  'student_fee_payments',
  'student_promotions',
  'semester_billing',
  'payments',
  'audit_logs'
];

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function restoreTable(tableName) {
  const jsonPath = path.join(tablesDir, `${tableName}.json`);
  if (!fs.existsSync(jsonPath)) {
    return { count: 0, skipped: true };
  }

  const rows = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  if (!rows || rows.length === 0) {
    return { count: 0, skipped: false };
  }

  const CHUNK_SIZE = 250;
  let restored = 0;

  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);

    let retries = 3;
    let success = false;
    let lastError = null;

    while (retries > 0 && !success) {
      try {
        const { error } = await targetClient
          .from(tableName)
          .upsert(chunk, { ignoreDuplicates: false });

        if (error) {
          lastError = error;
          retries--;
          if (retries > 0) await sleep(1000);
        } else {
          success = true;
          restored += chunk.length;
        }
      } catch (err) {
        lastError = err;
        retries--;
        if (retries > 0) await sleep(1000);
      }
    }

    if (!success) {
      throw new Error(`Failed to restore chunk ${i}-${i + chunk.length} of ${tableName}: ${lastError ? (lastError.message || JSON.stringify(lastError)) : 'Unknown error'}`);
    }
  }

  return { count: restored, skipped: false };
}

async function runRestore() {
  const startTime = Date.now();

  console.log('=============================================================');
  console.log('   SCHOOL MANAGEMENT SYSTEM - DATABASE RESTORE UTILITY');
  console.log('=============================================================');
  console.log(`Source Backup Archive: ${backupDir}`);
  console.log(`Target Database:       ${TARGET_URL}`);
  console.log(`Started At:            ${new Date().toLocaleString()}\n`);

  let totalRestored = 0;
  let tablesRestored = 0;

  for (const table of TABLES) {
    process.stdout.write(`Restoring [${table}]... `);
    try {
      const res = await restoreTable(table);
      if (res.skipped) {
        console.log(`SKIPPED (no backup file)`);
      } else {
        console.log(`DONE (${res.count} rows)`);
        totalRestored += res.count;
        tablesRestored++;
      }
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
    }
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n=============================================================');
  console.log('   RESTORE OPERATION COMPLETED');
  console.log('=============================================================');
  console.log(`Tables Restored: ${tablesRestored}`);
  console.log(`Total Records Restored: ${totalRestored.toLocaleString()}`);
  console.log(`Duration: ${durationSec}s`);
  console.log('=============================================================\n');
}

runRestore().catch(err => {
  console.error('\nFatal restore error:', err);
  process.exit(1);
});
