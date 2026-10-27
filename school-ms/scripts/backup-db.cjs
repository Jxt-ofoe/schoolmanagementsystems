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
const hasFlag = (name) => args.includes(`--${name}`);

const SUPABASE_URL = getArg('url') || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = getArg('key') || process.env.SUPABASE_SERVICE_ROLE_KEY;
const TARGET_SCHOOL_ID = getArg('school');
const ALL_AUDIT_LOGS = hasFlag('all-audit-logs');

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Error: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env.local or passed via CLI.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

// Tables ordered by foreign key dependencies
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Fetch all rows for a table with pagination, retry, and streaming to disk
async function backupTable(tableName, tablesDir) {
  const PAGE_SIZE = 1000;
  let offset = 0;
  let hasMore = true;
  let totalRows = 0;

  // Check table existence and count
  let query = supabase.from(tableName).select('id', { count: 'exact', head: true });
  if (TARGET_SCHOOL_ID && tableName !== 'schools' && tableName !== 'profiles') {
    // If table has school_id, filter
    try {
      const { count } = await supabase.from(tableName).select('id', { count: 'exact', head: true }).eq('school_id', TARGET_SCHOOL_ID);
      if (count !== null) query = query.eq('school_id', TARGET_SCHOOL_ID);
    } catch {}
  }

  const headRes = await query;
  if (headRes.error) {
    const err = headRes.error;
    if (err.code === '42P01' || err.message?.includes('schema cache') || err.message?.includes('does not exist')) {
      return { count: 0, exists: false };
    }
  }

  const expectedCount = headRes.count || 0;
  if (expectedCount === 0) {
    const jsonPath = path.join(tablesDir, `${tableName}.json`);
    fs.writeFileSync(jsonPath, '[]', 'utf8');
    return { count: 0, exists: true };
  }

  const jsonPath = path.join(tablesDir, `${tableName}.json`);
  const jsonStream = fs.createWriteStream(jsonPath, { encoding: 'utf8' });
  jsonStream.write('[\n');

  let isFirstRow = true;
  const maxRowsToFetch = (tableName === 'audit_logs' && !ALL_AUDIT_LOGS) ? Math.min(expectedCount, 5000) : expectedCount;

  while (hasMore && offset < maxRowsToFetch) {
    let retries = 5;
    let success = false;
    let data = null;
    let error = null;

    while (retries > 0 && !success) {
      try {
        let q = supabase.from(tableName).select('*');
        if (TARGET_SCHOOL_ID && tableName !== 'schools' && tableName !== 'profiles') {
          q = q.eq('school_id', TARGET_SCHOOL_ID);
        }
        if (tableName === 'audit_logs') {
          q = q.order('created_at', { ascending: false });
        } else {
          q = q.order('id');
        }

        const res = await q.range(offset, Math.min(offset + PAGE_SIZE - 1, maxRowsToFetch - 1));
        data = res.data;
        error = res.error;

        if (!error && Array.isArray(data)) {
          success = true;
        } else {
          retries--;
          const delay = Math.min(1500 * (6 - retries), 10000);
          if (retries > 0) await sleep(delay);
        }
      } catch (err) {
        error = err;
        retries--;
        const delay = Math.min(1500 * (6 - retries), 10000);
        if (retries > 0) await sleep(delay);
      }
    }

    if (!success) {
      jsonStream.end(']\n');
      throw new Error(`Failed to fetch ${tableName} at offset ${offset}: ${error ? (error.message || JSON.stringify(error)) : 'Network timeout'}`);
    }

    if (!data || data.length === 0) {
      hasMore = false;
    } else {
      totalRows += data.length;

      for (const row of data) {
        if (!isFirstRow) jsonStream.write(',\n');
        jsonStream.write('  ' + JSON.stringify(row));
        isFirstRow = false;
      }

      const pct = maxRowsToFetch > 0 ? Math.round((totalRows / maxRowsToFetch) * 100) : 100;
      process.stdout.write(`\rFetching [${tableName}]... ${totalRows.toLocaleString()}/${maxRowsToFetch.toLocaleString()} (${pct}%)`);

      if (data.length < PAGE_SIZE || totalRows >= maxRowsToFetch) {
        hasMore = false;
      } else {
        offset += PAGE_SIZE;
        await sleep(50);
      }
    }
  }

  jsonStream.write('\n]\n');
  jsonStream.end();

  return { count: totalRows, exists: true };
}

async function runBackup() {
  const startTime = Date.now();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const backupDirName = `backup-${timestamp}`;
  const baseBackupsDir = path.resolve(__dirname, '../backups');
  const backupDir = path.join(baseBackupsDir, backupDirName);
  const tablesDir = path.join(backupDir, 'tables');

  fs.mkdirSync(tablesDir, { recursive: true });

  console.log('=============================================================');
  console.log('   SCHOOL MANAGEMENT SYSTEM - DATABASE BACKUP UTILITY');
  console.log('=============================================================');
  console.log(`Source Database:  ${SUPABASE_URL}`);
  console.log(`Backup Directory: ${backupDir}`);
  if (TARGET_SCHOOL_ID) console.log(`Filter:           School ID ${TARGET_SCHOOL_ID}`);
  if (!ALL_AUDIT_LOGS) console.log(`Note:             Backing up latest 5,000 audit logs (use --all-audit-logs for complete history)`);
  console.log(`Started At:       ${new Date().toLocaleString()}\n`);

  const manifest = {
    timestamp: new Date().toISOString(),
    source_url: SUPABASE_URL,
    total_tables: 0,
    total_records: 0,
    tables: {},
  };

  for (const table of TABLES) {
    process.stdout.write(`Fetching [${table}]... `);
    try {
      const { count, exists } = await backupTable(table, tablesDir);
      if (!exists) {
        console.log(`SKIPPED (table not present)`);
        continue;
      }

      manifest.tables[table] = {
        count: count,
        json: `tables/${table}.json`
      };
      manifest.total_records += count;
      manifest.total_tables++;

      console.log(`\rFetching [${table}]... DONE (${count.toLocaleString()} rows)                `);
    } catch (err) {
      console.log(`\rFetching [${table}]... ERROR: ${err.message}                `);
    }
  }

  // Copy full schema backup into this backup archive
  const schemaFile = path.resolve(__dirname, '../supabase/full_schema_backup.sql');
  if (fs.existsSync(schemaFile)) {
    fs.copyFileSync(schemaFile, path.join(backupDir, 'schema.sql'));
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
  manifest.duration_seconds = Number(durationSec);

  // Write manifest
  fs.writeFileSync(path.join(backupDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  // Update latest reference folder
  const latestDir = path.join(baseBackupsDir, 'latest');
  fs.mkdirSync(latestDir, { recursive: true });
  fs.writeFileSync(path.join(latestDir, 'latest_backup.txt'), backupDirName, 'utf8');
  fs.copyFileSync(path.join(backupDir, 'manifest.json'), path.join(latestDir, 'manifest.json'));

  console.log('\n=============================================================');
  console.log('   BACKUP COMPLETED SUCCESSFULLY');
  console.log('=============================================================');
  console.log(`Total Tables Backed Up:  ${manifest.total_tables}`);
  console.log(`Total Records Backed Up: ${manifest.total_records.toLocaleString()}`);
  console.log(`Duration:                ${durationSec}s`);
  console.log(`Archive Location:        ${backupDir}`);
  console.log(`\nFiles Generated in Archive:`);
  console.log(` - schema.sql    (Complete Master Schema: tables, RLS, functions, triggers)`);
  console.log(` - tables/*.json (Individual JSON data archives for all tables)`);
  console.log(` - manifest.json (Metadata, row counts, and checksums)`);
  console.log('=============================================================\n');
}

runBackup().catch(err => {
  console.error('\nFatal backup error:', err);
  process.exit(1);
});
