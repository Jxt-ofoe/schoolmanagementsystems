import crypto from 'node:crypto';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

const paystackInitSchema = z.object({
  school_id: z.string().uuid('Invalid school ID format'),
  billing_id: z.string().uuid().or(z.literal('current')).optional(),
  email: z.string().email('Invalid email address').max(150).optional(),
  callback_url: z.string().url('Invalid callback URL').max(500).optional(),
});

export async function handlePaystackInit(rawBody, authHeader) {
  if (!SUPABASE_URL || !ANON_KEY) {
    throw new Error('Server configuration error: SUPABASE_URL and ANON_KEY must be configured in environment');
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    throw new Error('Server configuration error: SUPABASE_SERVICE_ROLE_KEY is not configured');
  }

  // 1. Zod input validation
  const parseResult = paystackInitSchema.safeParse(rawBody);
  if (!parseResult.success) {
    const errorMsg = parseResult.error.issues.map((i) => i.message).join('; ');
    throw new Error(`Invalid input: ${errorMsg}`);
  }

  const { school_id, billing_id, email, callback_url } = parseResult.data;

  // 2. Verify caller authentication
  const token = (authHeader || '').replace(/^Bearer\s+/i, '');
  if (!token) {
    throw new Error('Unauthorized: missing token');
  }

  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await callerClient.auth.getUser(token);
  if (userErr || !userData?.user) {
    throw new Error('Unauthorized: invalid session');
  }
  const callerId = userData.user.id;
  const callerEmail = userData.user.email || email;

  const adminClient = createClient(SUPABASE_URL, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Verify caller is super admin OR headmaster of the school
  const { data: sa } = await adminClient.from('platform_admins').select('user_id').eq('user_id', callerId).maybeSingle();
  const isSuperAdmin = !!sa;

  if (!isSuperAdmin) {
    const { data: membership } = await adminClient
      .from('school_memberships')
      .select('role, status')
      .eq('school_id', school_id)
      .eq('user_id', callerId)
      .eq('status', 'active')
      .maybeSingle();

    if (!membership || membership.role !== 'headmaster') {
      throw new Error('Unauthorized: only the headmaster or platform super administrator can initiate payments');
    }
  }

  // 3. Fetch School and Billing Record
  const { data: school, error: sErr } = await adminClient
    .from('schools')
    .select('id, name, code, email, phone')
    .eq('id', school_id)
    .single();

  if (sErr || !school) {
    throw new Error('School not found');
  }

  let bill = null;
  if (billing_id && billing_id !== 'current') {
    const { data: b, error: bErr } = await adminClient
      .from('semester_billing')
      .select('*')
      .eq('id', billing_id)
      .eq('school_id', school_id)
      .single();

    if (bErr || !b) {
      throw new Error('Billing invoice not found');
    }
    bill = b;
  } else {
    // Current term invoice requested
    const { data: currentSem } = await adminClient
      .from('semesters')
      .select('id, name, starts_on, academic_year_id, academic_years(name)')
      .eq('school_id', school_id)
      .eq('is_current', true)
      .maybeSingle();

    if (!currentSem) {
      throw new Error('No active term/semester found for this school');
    }

    const { data: existingBill } = await adminClient
      .from('semester_billing')
      .select('*')
      .eq('school_id', school_id)
      .eq('semester_id', currentSem.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingBill) {
      bill = existingBill;
    } else {
      // 30-day grace period active: school is paying early. Generate the term invoice on-demand.
      const { count: studentCount } = await adminClient
        .from('students')
        .select('*', { count: 'exact', head: true })
        .eq('school_id', school_id)
        .eq('enrollment_status', 'active');

      const count = Math.max(1, studentCount || 0);

      const { data: pSettings } = await adminClient
        .from('platform_settings')
        .select('price_per_student')
        .eq('id', true)
        .maybeSingle();
      const defaultPrice = Number(pSettings?.price_per_student ?? 3.0);

      const { data: cfg } = await adminClient
        .from('school_billing_configs')
        .select('*')
        .eq('school_id', school_id)
        .maybeSingle();

      const price = Number(cfg?.price_per_student ?? defaultPrice);
      const subtotal = count * price;
      let discount = 0;
      if (cfg?.discount_type === 'percentage' && Number(cfg.discount_value) > 0) {
        discount = Math.round(subtotal * (Number(cfg.discount_value) / 100) * 100) / 100;
      } else if (cfg?.discount_type === 'fixed' && Number(cfg.discount_value) > 0) {
        discount = Math.min(subtotal, Number(cfg.discount_value));
      }
      const passMarkup = cfg ? cfg.pass_fee_markup !== false : true;
      const markupPercent = cfg ? Number(cfg.fee_markup_percent ?? 3.0) : 3.0;
      const feeMarkup = passMarkup ? Math.round((subtotal - discount) * (markupPercent / 100) * 100) / 100 : 0;
      const total = subtotal - discount + feeMarkup;

      const now = new Date();
      const issueDate = now.toISOString().slice(0, 10);
      const dueDateObj = new Date(now);
      dueDateObj.setDate(dueDateObj.getDate() + 7);
      const dueDate = dueDateObj.toISOString().slice(0, 10);
      const invNumber = 'INV-' + issueDate.replace(/-/g, '').slice(2, 6) + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();
      const periodLabel = currentSem.name + (currentSem.academic_years?.name ? ' · ' + currentSem.academic_years.name : '');

      const { data: newBill, error: createErr } = await adminClient
        .from('semester_billing')
        .insert({
          school_id,
          semester_id: currentSem.id,
          billing_frequency: 'semester',
          period_label: periodLabel,
          student_count: count,
          price_per_student: price,
          currency: 'GHS',
          discount_amount: discount,
          fee_markup_amount: feeMarkup,
          total_payable: total,
          due_date: dueDate,
          grace_period_end: dueDate,
          invoice_number: invNumber,
          subscription_status: 'awaiting_payment',
          last_calculated_at: now.toISOString(),
        })
        .select()
        .single();

      if (createErr || !newBill) {
        throw new Error('Failed to generate term invoice');
      }
      bill = newBill;
    }
  }

  // Fetch school billing configuration for discount & markup rules
  let config = null;
  try {
    const { data: cfg, error: cfgErr } = await adminClient
      .from('school_billing_configs')
      .select('*')
      .eq('school_id', school_id)
      .maybeSingle();
    if (!cfgErr) config = cfg;
  } catch (_e) {
    // Migration fallback
  }

  // 4. Transparent Calculation Breakdown
  const subtotal = Number(bill.student_count) * Number(bill.price_per_student);
  let discount = Number(bill.discount_amount || 0);

  if (discount === 0 && config) {
    if (config.discount_type === 'percentage' && Number(config.discount_value) > 0) {
      discount = Math.round(subtotal * (Number(config.discount_value) / 100) * 100) / 100;
    } else if (config.discount_type === 'fixed' && Number(config.discount_value) > 0) {
      discount = Math.min(subtotal, Number(config.discount_value));
    }
  }

  const netSubtotal = Math.max(0, subtotal - discount);
  const passMarkup = config ? config.pass_fee_markup !== false : true;
  const markupPercent = config ? Number(config.fee_markup_percent ?? 3.0) : 3.0;
  const feeMarkup = passMarkup ? Math.round(netSubtotal * (markupPercent / 100) * 100) / 100 : 0;

  const totalPayable = Math.max(1.0, Math.round((netSubtotal + feeMarkup) * 100) / 100);
  const amountInPesewas = Math.round(totalPayable * 100);

  // Update total_payable and discount on invoice if not yet saved
  await adminClient
    .from('semester_billing')
    .update({
      discount_amount: discount,
      fee_markup_amount: feeMarkup,
      total_payable: totalPayable,
    })
    .eq('id', bill.id);

  // 5. Cryptographically secure Paystack Reference & Metadata
  const randSuffix = crypto.randomBytes(4).toString('hex').toUpperCase();
  const cleanCode = (school.code || 'SCH').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8);
  const reference = `PSTK_${cleanCode}_${Date.now()}_${randSuffix}`;
  const customerEmail = email || school.email || callerEmail || 'billing@schoolms.org';

  const metadata = {
    school_id,
    school_name: school.name,
    billing_id: bill.id,
    period_label: bill.period_label || `${bill.student_count} Students`,
    student_count: bill.student_count,
    price_per_student: bill.price_per_student,
    breakdown: {
      subtotal,
      discount,
      net_subtotal: netSubtotal,
      fee_markup: feeMarkup,
      markup_percent: markupPercent,
      total_payable: totalPayable,
      currency: 'GHS',
    },
    custom_fields: [
      { display_name: 'School', variable_name: 'school_name', value: school.name },
      { display_name: 'Period', variable_name: 'billing_period', value: bill.period_label || 'Current Period' },
      { display_name: 'Students Count', variable_name: 'student_count', value: String(bill.student_count) },
      { display_name: 'Processing Fee (3%)', variable_name: 'fee_markup', value: `GH₵ ${feeMarkup.toFixed(2)}` },
    ],
  };

  // 6. Initialize with Paystack API
  const paystackSecret = process.env.PAYSTACK_SECRET_KEY;
  const paystackPublic = process.env.VITE_PAYSTACK_PUBLIC_KEY || process.env.PAYSTACK_PUBLIC_KEY;

  let authUrl = null;
  let accessCode = null;

  if (paystackSecret && !paystackSecret.includes('placeholder') && !paystackSecret.includes('xxxx')) {
    const paystackRes = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${paystackSecret}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: customerEmail,
        amount: amountInPesewas,
        currency: 'GHS',
        reference,
        callback_url: callback_url || undefined,
        channels: ['card', 'mobile_money'],
        metadata,
      }),
    });

    const pstkData = await paystackRes.json();
    if (!paystackRes.ok || !pstkData.status) {
      throw new Error(pstkData.message || 'Failed to initialize Paystack checkout');
    }

    authUrl = pstkData.data.authorization_url;
    accessCode = pstkData.data.access_code;
  } else {
    // Development mode fallback
    accessCode = `test_acc_${Date.now()}`;
    authUrl = `https://checkout.paystack.com/${accessCode}`;
  }

  // 7. Record transaction attempt in paystack_transactions
  await adminClient.from('paystack_transactions').insert({
    school_id,
    billing_id: bill.id,
    reference,
    event_type: 'checkout_init',
    amount: totalPayable,
    currency: 'GHS',
    status: 'pending',
    customer_email: customerEmail,
    metadata,
  });

  return {
    status: 'success',
    data: {
      authorization_url: authUrl,
      access_code: accessCode,
      reference,
      public_key: paystackPublic || '',
      customer_email: customerEmail,
      amount_in_pesewas: amountInPesewas,
      breakdown: {
        subtotal,
        discount,
        net_subtotal: netSubtotal,
        fee_markup: feeMarkup,
        total_payable: totalPayable,
        currency: 'GHS',
      },
    },
  };
}

export default async function handler(req, res) {
  if (req.method === 'POST') {
    try {
      const authHeader = req.headers.authorization;
      const result = await handlePaystackInit(req.body, authHeader);
      res.status(200).json(result);
    } catch (err) {
      console.error('Paystack init error:', err);
      res.status(400).json({ error: err.message || 'Failed to initialize Paystack checkout' });
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}
