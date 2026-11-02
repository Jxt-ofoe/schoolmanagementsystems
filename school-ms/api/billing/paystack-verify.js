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

  if (paystackSecret && !paystackSecret.includes('placeholder')) {
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

  // 5. Insert verified payment record into public.payments
  // The database trigger sync_amount_paid will automatically recalculate amount_paid on semester_billing!
  const { data: newPayment, error: pErr } = await adminClient
    .from('payments')
    .insert({
      school_id: schoolId,
      billing_id: billingId,
      amount: amountPaidGHS,
      method: channel,
      reference: reference,
      paid_on: paidDate,
      verification: 'provider_verified',
      provider: 'paystack',
      notes: `Verified online payment via Paystack (${paystackData.channel})`,
      status: 'valid',
      recorded_by: callerId,
    })
    .select('id')
    .single();

  if (pErr) {
    // If unique reference conflict, handle gracefully
    if (pErr.code === '23505') {
      return { status: 'success', already_verified: true, reference, message: 'Payment reference already recorded' };
    }
    throw new Error(`Failed to record payment in database: ${pErr.message}`);
  }

  // 6. Update Paystack transaction record
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
  }, { onConflict: 'reference' });

  // 7. Store reusable card authorization if available
  if (paystackData.channel === 'card' && paystackData.authorization?.reusable && paystackData.authorization?.authorization_code) {
    const authInfo = paystackData.authorization;
    await adminClient.from('payment_authorizations').upsert({
      school_id: schoolId,
      authorization_code: authInfo.authorization_code,
      card_type: authInfo.card_type,
      last4: authInfo.last4,
      exp_month: authInfo.exp_month,
      exp_year: authInfo.exp_year,
      bin: authInfo.bin,
      bank: authInfo.bank,
      channel: 'card',
      signature: authInfo.signature,
      reusable: true,
      country_code: authInfo.country_code || 'GH',
      account_name: authInfo.account_name,
      customer_email: paystackData.customer?.email,
      is_default: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'school_id, authorization_code' });
  }

  // 8. Update School Billing Configuration & Next Billing Date
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
    nextDate.setMonth(nextDate.getMonth() + 4); // Standard semester
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

  // If school status was suspended, restore to active
  await adminClient
    .from('schools')
    .update({ status: 'active', updated_at: new Date().toISOString() })
    .eq('id', schoolId)
    .eq('status', 'suspended');

  // 9. Audit Log
  await adminClient.from('audit_logs').insert({
    school_id: schoolId,
    actor_id: callerId,
    actor_role: 'system',
    action: 'paystack_payment_verified',
    entity_type: 'payments',
    entity_id: newPayment.id,
    metadata: {
      reference,
      amount: amountPaidGHS,
      channel: paystackData.channel,
      billing_id: billingId,
    },
  });

  return {
    status: 'success',
    verified: true,
    payment_id: newPayment.id,
    reference,
    amount: amountPaidGHS,
    channel: paystackData.channel,
    next_billing_date: nextBillingISO,
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
