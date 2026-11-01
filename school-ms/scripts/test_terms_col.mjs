import { createClient } from '@supabase/supabase-js';

const url = 'https://simskpwdkbcudmgzjsib.supabase.co';
const serviceKey = 'sb_secret_WIQRhbLScCi4Z8y4dJ2klg_tJVgB3SI';

const supabase = createClient(url, serviceKey);

async function check() {
  const { data, error } = await supabase.from('schools').select('id, name').limit(1);
  console.log('Schools select:', data, error);
}

check();
