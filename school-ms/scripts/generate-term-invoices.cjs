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
  console.error('Error: Supabase URL and Service Role Key required.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

async function main() {
  console.log('Generating Term 1 invoices for all active schools...');

  // Fetch all schools
  const { data: schools, error: sErr } = await supabase
    .from('schools')
    .select('id, name, code, status')
    .eq('status', 'active');

  if (sErr || !schools) {
    console.error('Error fetching schools:', sErr);
    process.exit(1);
  }

  let generated = 0;
  let skipped = 0;

  for (const school of schools) {
    // Get current semester
    const { data: sem } = await supabase
      .from('semesters')
      .select('id, name, starts_on, ends_on, academic_years(name)')
      .eq('school_id', school.id)
      .eq('is_current', true)
      .maybeSingle();

    if (!sem) {
      console.log(`- Skipping ${school.name}: No current semester found.`);
      skipped++;
      continue;
    }

    // Check if main invoice already exists
    const { data: existingInv } = await supabase
      .from('semester_billing')
      .select('id, invoice_number')
      .eq('school_id', school.id)
      .eq('semester_id', sem.id)
      .maybeSingle();

    if (existingInv) {
      console.log(`- ${school.name}: Term invoice already exists (${existingInv.invoice_number})`);
      continue;
    }

    // Get active student count
    const { count: studentCount } = await supabase
      .from('students')
      .select('*', { count: 'exact', head: true })
      .eq('school_id', school.id)
      .eq('enrollment_status', 'active');

    const effectiveStudents = studentCount || 0;
    const pricePerStudent = 3.00;
    const subtotal = effectiveStudents * pricePerStudent;
    const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const graceEnd = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const invNumber = 'INV-' + new Date().toISOString().slice(2, 7).replace('-', '') + '-' + Math.random().toString(36).substring(2, 8).toUpperCase();
    const periodLabel = `${sem.name} · ${sem.academic_years?.name || '2026/2027'}`;

    // Note: amount_due and balance are GENERATED ALWAYS AS columns in postgres, so they must be omitted
    const { error: invErr } = await supabase.from('semester_billing').insert({
      school_id: school.id,
      semester_id: sem.id,
      student_count: effectiveStudents,
      price_per_student: pricePerStudent,
      currency: 'GHS',
      amount_paid: 0.00,
      due_date: dueDate,
      grace_period_end: graceEnd,
      invoice_number: invNumber,
      subscription_status: 'awaiting_payment',
      billing_frequency: 'semester',
      period_label: periodLabel,
      discount_amount: 0.00,
      fee_markup_amount: 0.00,
      total_payable: subtotal,
      notes: `Term 1 billing snapshot (${effectiveStudents} active students @ GHS ${pricePerStudent.toFixed(2)})`,
      last_calculated_at: new Date().toISOString(),
    });

    if (invErr) {
      console.error(`Error creating invoice for ${school.name}:`, invErr);
    } else {
      console.log(`✓ Created invoice ${invNumber} for ${school.name}: ${effectiveStudents} students @ GHS 3.00 = GHS ${subtotal.toFixed(2)}`);
      generated++;
    }
  }

  console.log(`\nFinished: Generated ${generated} invoice(s), ${skipped} skipped.`);
}

main().catch(console.error);
