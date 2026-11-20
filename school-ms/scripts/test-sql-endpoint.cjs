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

async function testEndpoints() {
  const url = env.VITE_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;

  // Test 1: POST /pg/query or /pg
  try {
    const res = await fetch(`${url}/pg`, {
      method: 'POST',
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query: 'SELECT 1;' })
    });
    console.log('/pg status:', res.status, await res.text().catch(e => e.message));
  } catch (e) {
    console.log('/pg error:', e.message);
  }

  // Test 2: POST /rest/v1/rpc/exec_sql
  try {
    const res = await fetch(`${url}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query: 'SELECT 1;' })
    });
    console.log('/rpc/exec_sql status:', res.status, await res.text().catch(e => e.message));
  } catch (e) {
    console.log('/rpc/exec_sql error:', e.message);
  }
}

testEndpoints();

