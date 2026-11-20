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

async function inspectOpenAPI() {
  const res = await fetch(`${env.VITE_SUPABASE_URL}/rest/v1/`, {
    headers: {
      'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`
    }
  });
  const data = await res.json();
  const paths = Object.keys(data.paths || {});
  const rpcs = paths.filter(p => p.startsWith('/rpc/')).map(p => p.replace('/rpc/', ''));
  console.log('Available RPCs in public schema (' + rpcs.length + '):');
  console.log(rpcs.sort());
}

inspectOpenAPI();

