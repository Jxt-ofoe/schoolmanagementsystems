import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://simskpwdkbcudmgzjsib.supabase.co';
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_3awl3YZ_9dzYOyLGRv0EWw_0e2o3z_x';

export async function handlePaystackVerify(body, authHeader) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    throw new Error('Server configuration error: SUPABASE_SERVICE_ROLE_KEY is not configured');
  }

  const { reference } = body || {};
  if (!reference) {
    throw new Error('Transaction reference is required');
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

  const adminClient = createClient(SUPABASE_URL, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 2. Fetch existing transaction attempt
  const { data: tx, error: txErr } = await adminClient
    .from('paystack_transactions')
    .select('*')
    .eq('reference', reference)
    .maybeSingle();

  // Idempotency: If already credited, return early
  if (tx && tx.status === 'success') {
    return {
      status: 'success',
      already_verified: true,
      reference,
      amount: tx.amount,
      channel: tx.channel,
      message: 'Transaction has already been verified and credited',
    };
  }

  // 3. Verify server-side with Paystack API
  const paystackSecret = process.env.PAYSTACK_SECRET_KEY;
  let paystackData = null;

  if (paystackSecret && !paystackSecret.includes('placeholder') && !paystackSecret.includes('xxxx')) {
    const pstkRes = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${paystackSecret}`,
      },
    });

    const pstkJson = await pstkRes.json();
    if (!pstkRes.ok || !pstkJson.status || pstkJson.data.status !== 'success') {
      const errorMsg = pstkJson.data?.gateway_response || pstkJson.message || 'Payment verification failed at Paystack';
      // Record failure
      if (tx) {
        await adminClient.from('paystack_transactions').update({
          status: 'failed',
          gateway_response: errorMsg,
          raw_payload: pstkJson,
        }).eq('reference', reference);
      }
      throw new Error(errorMsg);
    }

    paystackData = pstkJson.data;
  } else {
    // Development / Test mode mock verification
    paystackData = {
      status: 'success',
      reference,
      amount: tx ? Math.round(Number(tx.amount) * 100) : 1500,
      currency: 'GHS',
      channel: 'card',
      paid_at: new Date().toISOString(),
      gateway_response: 'Successful test verification',
      customer: { email: tx?.customer_email || 'test@schoolms.org' },
      authorization: {
        authorization_code: `AUTH_test_${Date.now()}`,
        card_type: 'visa',
        last4: '4081',
        exp_month: '12',
        exp_year: '2030',
        bin: '408185',
        bank: 'Test Bank Ghana',
        signature: `SIG_test_${Date.now()}`,
        reusable: true,
      },
    };
  }

  // 4. Extract verified transaction details
  const schoolId = tx?.school_id || paystackData.metadata?.school_id;
  const billingId = tx?.billing_id || paystackData.metadata?.billing_id;
  const amountPaidGHS = Number(paystackData.amount) / 100.0;
  const channel = paystackData.channel === 'card' ? 'card' : 'mobile_money';
  const paidDate = paystackData.paid_at ? paystackData.paid_at.slice(0, 10) : new Date().toISOString().slice(0, 10);

  if (!schoolId || !billingId) {
    throw new Error('Transaction metadata is incomplete (missing school or invoice reference)');
  }

  // 5. Payment verified by Paystack API
  // Check if payment was already recorded (e.g. by webhook or previous verify call)
  const { data: existingPayment } = await adminClient
    .from('payments')
    .select('id, paid_on, amount, status')
    .eq('reference', reference)
    .maybeSingle();

  if (existingPayment) {
    return {
      status: 'success',
      paid: true,
      already_verified: true,
      reference,
      amount: existingPayment.amount,
      message: 'Payment verified and credited to invoice',
    };
  }

  // Record verified payment immediately into public.payments (triggers sync_amount_paid)
  const { data: newPayment, error: pmtErr } = await adminClient
    .from('payments')
    .insert({
      school_id: schoolId,
      billing_id: billingId,
      amount: amountPaidGHS,
      method: channel,
      reference,
      paid_on: paidDate,
      verification: 'provider_verified',
      provider: 'paystack',
      notes: `Verified Paystack payment via ${channel}`,
      status: 'valid',
    })
    .select('id, amount')
    .single();

  if (pmtErr && pmtErr.code !== '23505') { // Ignore unique constraint duplicate if raced
    throw new Error('Failed to record verified payment: ' + pmtErr.message);
  }

  // Update Paystack transaction record with success status
  await adminClient.from('paystack_transactions').upsert({
    reference,
    school_id: schoolId,
    billing_id: billingId,
    amount: amountPaidGHS,
    currency: paystackData.currency || 'GHS',
    channel: paystackData.channel,
    status: 'success',
    gateway_response: paystackData.gateway_response || 'Approved',
    paid_at: paystackData.paid_at,
    customer_email: paystackData.customer?.email,
    customer_code: paystackData.customer?.customer_code,
    authorization_code: paystackData.authorization?.authorization_code,
    metadata: paystackData.metadata || tx?.metadata || {},
    raw_payload: paystackData,
    webhook_received_at: new Date().toISOString(),
  }, { onConflict: 'reference' });

  // Update invoice status
  await adminClient
    .from('semester_billing')
    .update({ subscription_status: 'paid' })
    .eq('id', billingId);

  // Restore school to active if suspended
  await adminClient
    .from('schools')
    .update({ status: 'active', updated_at: new Date().toISOString() })
    .eq('id', schoolId)
    .eq('status', 'suspended');

  // Advance next billing date if needed
  const { data: config } = await adminClient
    .from('school_billing_configs')
    .select('*')
    .eq('school_id', schoolId)
    .maybeSingle();

  const freq = config?.billing_frequency || 'semester';
  const nextDate = new Date();
  if (freq === 'monthly') {
    nextDate.setMonth(nextDate.getMonth() + 1);
  } else {
    nextDate.setMonth(nextDate.getMonth() + 4);
  }
  const nextBillingISO = nextDate.toISOString().slice(0, 10);

  await adminClient
    .from('school_billing_configs')
    .update({
      status: 'active',
      next_billing_date: nextBillingISO,
      grace_period_end: null,
      updated_at: new Date().toISOString(),
    })
    .eq('school_id', schoolId);

  return {
    status: 'success',
    paid: true,
    reference,
    amount: amountPaidGHS,
    channel: paystackData.channel,
    message: 'Payment verified and credited to invoice',
  };
}

export default async function handler(req, res) {
  if (req.method === 'POST') {
    try {
      const authHeader = req.headers.authorization;
      const result = await handlePaystackVerify(req.body, authHeader);
      res.status(200).json(result);
    } catch (err) {
      res.status(400).json({ error: err.message || 'Payment verification failed' });
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}
