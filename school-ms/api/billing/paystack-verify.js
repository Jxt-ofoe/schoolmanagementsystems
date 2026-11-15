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

  // 5. Strictly enforce rule: Only the webhook marks an invoice as paid, never the redirect.
  // Check if webhook has already recorded this payment into public.payments
  const { data: webhookPayment } = await adminClient
    .from('payments')
    .select('id, paid_on, amount, status')
    .eq('reference', reference)
    .maybeSingle();

  if (webhookPayment) {
    return {
      status: 'success',
      paid: true,
      already_verified: true,
      reference,
      amount: webhookPayment.amount,
      message: 'Payment confirmed by webhook and credited to invoice',
    };
  }

  // Update Paystack transaction record with status, but NEVER insert into public.payments
  await adminClient.from('paystack_transactions').upsert({
    reference,
    school_id: schoolId,
    billing_id: billingId,
    amount: amountPaidGHS,
    currency: paystackData.currency || 'GHS',
    channel: paystackData.channel,
    status: 'pending_webhook',
    gateway_response: paystackData.gateway_response || 'Authorized via Paystack; awaiting webhook confirmation to credit invoice',
    paid_at: paystackData.paid_at,
    customer_email: paystackData.customer?.email,
    customer_code: paystackData.customer?.customer_code,
    authorization_code: paystackData.authorization?.authorization_code,
    metadata: paystackData.metadata || tx?.metadata || {},
    raw_payload: paystackData,
  }, { onConflict: 'reference' });

  return {
    status: 'pending',
    paid: false,
    reference,
    amount: amountPaidGHS,
    channel: paystackData.channel,
    message: 'Payment received by Paystack. Awaiting webhook confirmation to update your account.',
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
