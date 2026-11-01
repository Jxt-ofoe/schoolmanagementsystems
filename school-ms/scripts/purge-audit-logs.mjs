import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://simskpwdkbcudmgzjsib.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'sb_secret_WIQRhbLScCi4Z8y4dJ2klg_tJVgB3SI';
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
