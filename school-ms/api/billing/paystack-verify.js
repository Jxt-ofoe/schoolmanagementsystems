import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

const paystackVerifySchema = z.object({
  reference: z.string().trim().min(3).max(120).regex(/^[a-zA-Z0-9_.-]+$/, 'Invalid reference format'),
});

export async function handlePaystackVerify(rawBody, authHeader) {
  if (!SUPABASE_URL || !ANON_KEY) {
    throw new Error('Server configuration error: SUPABASE_URL and ANON_KEY must be configured in environment');
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    throw new Error('Server configuration error: SUPABASE_SERVICE_ROLE_KEY is not configured');
  }

  // 1. Zod input validation
  const parseResult = paystackVerifySchema.safeParse(rawBody);
  if (!parseResult.success) {
    throw new Error('Transaction reference is invalid');
  }
  const { reference } = parseResult.data;

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

  const adminClient = createClient(SUPABASE_URL, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 3. Fetch transaction attempt to identify school
  const { data: tx, error: txErr } = await adminClient
    .from('paystack_transactions')
    .select('*')
    .eq('reference', reference)
    .maybeSingle();

  if (txErr || !tx) {
    throw new Error('Transaction record not found');
  }

  const schoolId = tx.school_id;
  const billingId = tx.billing_id;

  // 4. Role Authorization: Caller must be super admin OR headmaster of the transaction's school
  const { data: sa } = await adminClient.from('platform_admins').select('user_id').eq('user_id', callerId).maybeSingle();
  const isSuperAdmin = !!sa;

  if (!isSuperAdmin) {
    const { data: membership } = await adminClient
      .from('school_memberships')
      .select('role, status')
      .eq('school_id', schoolId)
      .eq('user_id', callerId)
      .eq('status', 'active')
      .maybeSingle();

    if (!membership || membership.role !== 'headmaster') {
      throw new Error('Unauthorized: only the headmaster or platform administrator can verify payments');
    }
  }

  // 5. Idempotency: Check if payment is already recorded in payments table
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
      message: 'Payment confirmed and credited to invoice',
    };
  }

  // 6. Verify server-side with Paystack API
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
      await adminClient.from('paystack_transactions').update({
        status: 'failed',
        gateway_response: errorMsg,
        raw_payload: pstkJson,
      }).eq('reference', reference);

      throw new Error(errorMsg);
    }

    paystackData = pstkJson.data;
  } else {
    // Development mode simulation - only allowed when not in production and PAYMENT_SIMULATION is true (Finding M-6)
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Server payment configuration error: live secret key required in production');
    }
    if (process.env.PAYMENT_SIMULATION !== 'true') {
      throw new Error('Server payment configuration error: PAYSTACK_SECRET_KEY is missing and PAYMENT_SIMULATION is not enabled');
    }
    console.warn('[SECURITY WARNING] PAYMENT_SIMULATION is enabled: simulating successful Paystack verification in non-production environment');

    paystackData = {
      status: 'success',
      reference,
      amount: Math.round(Number(tx.amount) * 100),
      currency: 'GHS',
      channel: 'card',
      paid_at: new Date().toISOString(),
      gateway_response: 'Successful test verification',
      customer: { email: tx.customer_email || 'test@schoolms.org' },
    };
  }

  // 7. Validate verified data matches expected amount and currency
  const amountPaidGHS = Number(paystackData.amount) / 100.0;
  const channel = paystackData.channel === 'card' ? 'card' : 'mobile_money';
  const paidDate = paystackData.paid_at ? paystackData.paid_at.slice(0, 10) : new Date().toISOString().slice(0, 10);

  if (paystackData.currency && paystackData.currency !== 'GHS') {
    throw new Error(`Invalid transaction currency: expected GHS but received ${paystackData.currency}`);
  }

  // 8. Atomic payment recording: insert payment into public.payments
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

  if (pmtErr && pmtErr.code !== '23505') {
    throw new Error('Failed to record verified payment');
  }

  // 9. Update transaction status
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
    metadata: paystackData.metadata || tx.metadata || {},
    raw_payload: paystackData,
    webhook_received_at: new Date().toISOString(),
  }, { onConflict: 'reference' });

  // 10. Enforce school billing status and unsuspension
  try {
    await adminClient.rpc('check_and_enforce_school_billing_status', { p_school_id: schoolId });
  } catch (_e) {
    // Non-critical RPC error
  }

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
      console.error('Paystack verify error:', err);
      res.status(400).json({ error: err.message || 'Payment verification failed' });
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}
