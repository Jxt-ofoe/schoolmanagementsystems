import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://simskpwdkbcudmgzjsib.supabase.co';
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_3awl3YZ_9dzYOyLGRv0EWw_0e2o3z_x';

export async function handlePaystackInit(body, authHeader) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    throw new Error('Server configuration error: SUPABASE_SERVICE_ROLE_KEY is not configured');
  }

  const { school_id, billing_id, email, callback_url } = body || {};
  if (!school_id) {
    throw new Error('School ID is required');
  }
  if (!billing_id) {
    throw new Error('Billing invoice ID is required');
  }

  // 1. Verify caller authentication
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

  // 2. Fetch School and Billing Record
  const { data: school, error: sErr } = await adminClient
    .from('schools')
    .select('id, name, code, email, phone')
    .eq('id', school_id)
    .single();

  if (sErr || !school) {
    throw new Error('School not found');
  }

  const { data: bill, error: bErr } = await adminClient
    .from('semester_billing')
    .select('*')
    .eq('id', billing_id)
    .eq('school_id', school_id)
    .single();

  if (bErr || !bill) {
    throw new Error('Billing invoice not found');
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
    // Migration not yet applied, fallback gracefully
  }

  // 3. Transparent Calculation Breakdown
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

  // Fee markup: 3% standard markup if pass_fee_markup is true
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
    .eq('id', billing_id);

  // 4. Paystack Reference & Metadata
  const reference = `PSTK_${school.code ? school.code.slice(0, 10) : 'SCH'}_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const customerEmail = email || school.email || callerEmail || 'billing@schoolms.org';

  const metadata = {
    school_id,
    school_name: school.name,
    billing_id,
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

  // 5. Initialize with Paystack API
  const paystackSecret = process.env.PAYSTACK_SECRET_KEY;
  const paystackPublic = process.env.VITE_PAYSTACK_PUBLIC_KEY || process.env.PAYSTACK_PUBLIC_KEY;

  let authUrl = null;
  let accessCode = null;

  if (paystackSecret && !paystackSecret.includes('placeholder')) {
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
    // Development / Test mode fallback
    accessCode = `test_acc_${Date.now()}`;
    authUrl = `https://checkout.paystack.com/${accessCode}`;
  }

  // 6. Record transaction attempt in paystack_transactions
  await adminClient.from('paystack_transactions').insert({
    school_id,
    billing_id,
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
      public_key: paystackPublic || 'pk_test_sample_schoolms',
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
      res.status(400).json({ error: err.message || 'Failed to initialize Paystack checkout' });
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}
