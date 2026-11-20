const { createClient } = require('@supabase/supabase-js');

const fs = require('fs');
const path = require('path');
const envFile = path.resolve(__dirname, '../.env.local');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const [k, ...v] = line.trim().split('=');
    if (k && v.length && !process.env[k]) process.env[k] = v.join('=').trim();
  }
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (set in .env.local)');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function updateBilling() {
  console.log('=== Updating Billing to 5 Cedis per Student ===');

  // 1. Update platform_settings
  const { data: updatedSettings, error: setErr } = await supabase
    .from('platform_settings')
    .update({ price_per_student: 5.00 })
    .eq('id', true)
    .select();

  if (setErr) {
    console.error('Error updating platform_settings:', setErr);
  } else {
    console.log('Updated platform_settings to 5.00 GHS:', updatedSettings);
  }

  // 2. Fetch all existing semester_billing rows
  const { data: bills, error: bErr } = await supabase
    .from('semester_billing')
    .select('*');

  if (bErr) {
    console.error('Error fetching semester_billing:', bErr);
    return;
  }

  console.log(`Found ${bills.length} semester_billing records to update.`);

  for (const bill of bills) {
    const wasFullyPaid = Number(bill.amount_paid) > 0 && Number(bill.amount_paid) >= Number(bill.amount_due);
    const newAmountDue = Number(bill.student_count) * 5.00;
    const newAmountPaid = wasFullyPaid ? newAmountDue : 0;

    const { error: uErr } = await supabase
      .from('semester_billing')
      .update({
        price_per_student: 5.00,
        amount_paid: newAmountPaid,
      })
      .eq('id', bill.id);

    if (uErr) {
      console.error(`Error updating bill ${bill.id}:`, uErr.message);
    }
  }

  // 3. Verify final records
  const { data: finalBills } = await supabase
    .from('semester_billing')
    .select('id, school_id, student_count, price_per_student, amount_due, amount_paid, balance');

  console.log('Updated billing records:');
  finalBills.forEach((b, i) => {
    console.log(`[${i + 1}] Students: ${b.student_count} × GH₵ ${b.price_per_student} = Due: GH₵ ${b.amount_due} | Paid: GH₵ ${b.amount_paid} | Balance: GH₵ ${b.balance}`);
  });

  console.log('Billing successfully updated to 5 cedis per student!');
}

updateBilling();
