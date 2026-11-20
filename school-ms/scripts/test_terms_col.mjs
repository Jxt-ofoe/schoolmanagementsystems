import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (set in .env.local)');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function check() {
  const { data, error } = await supabase.from('schools').select('id, name').limit(1);
  console.log('Schools select:', data, error);
}

check();
