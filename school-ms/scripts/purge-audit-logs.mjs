import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
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

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function purge() {
  console.log('Starting audit logs purge...');
  let totalDeleted = 0;

  while (true) {
    const { data: batch, error: fetchErr } = await supabase
      .from('audit_logs')
      .select('id')
      .order('id', { ascending: true })
      .limit(15000);

    if (fetchErr) {
      console.error('Fetch error:', fetchErr);
      break;
    }
    if (!batch || batch.length === 0) {
      break;
    }

    const maxBatchId = batch[batch.length - 1].id;
    const { count, error: delErr } = await supabase
      .from('audit_logs')
      .delete({ count: 'exact' })
      .lte('id', maxBatchId);

    if (delErr) {
      console.error('Delete error:', delErr);
      break;
    }

    totalDeleted += (count ?? batch.length);
    console.log(`Deleted batch up to ID ${maxBatchId}. Total deleted so far: ${totalDeleted}`);
  }

  const { count: remaining } = await supabase.from('audit_logs').select('*', { count: 'exact', head: true });
  console.log(`Purge complete. Remaining audit logs: ${remaining}`);
}

purge();
