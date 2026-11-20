import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

const chargeRecurringSchema = z.object({
  target_school_id: z.string().uuid('Invalid school ID format').optional(),
});

export async function handleChargeRecurring(rawBody, authHeader) {
  if (!SUPABASE_URL || !ANON_KEY) {
    throw new Error('Server configuration error: SUPABASE_URL and ANON_KEY must be configured in environment');
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    throw new Error('Server configuration error: SUPABASE_SERVICE_ROLE_KEY is not configured');
  }

  const parseResult = chargeRecurringSchema.safeParse(rawBody || {});
  if (!parseResult.success) {
    throw new Error('Invalid recurring charge parameters');
  }
  const { target_school_id } = parseResult.data;

  // 1. Verify caller authentication (Super Admin only)
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

  const { data: sa } = await adminClient.from('platform_admins').select('user_id').eq('user_id', callerId).maybeSingle();
  if (!sa) {
    throw new Error('Unauthorized: only platform super administrators can trigger recurring billing charges');
  }

  // 2. Query monthly schools eligible for recurring card charge
  let qy = adminClient
    .from('school_billing_configs')
    .select('*, schools!inner(name, code, email)')
    .eq('billing_frequency', 'monthly')
    .eq('auto_charge_card', true)
    .in('status', ['active', 'payment_pending', 'grace_period']);

  if (target_school_id) {
    qy = qy.eq('school_id', target_school_id);
  }

  const { data: eligibleConfigs, error: cfgErr } = await qy;
  if (cfgErr) {
    throw new Error(`Failed to query eligible schools: ${cfgErr.message}`);
  }

  const results = [];
  const paystackSecret = process.env.PAYSTACK_SECRET_KEY;

  for (const cfg of eligibleConfigs || []) {
    const schoolId = cfg.school_id;

    // Fetch saved card authorization
    const { data: authCard } = await adminClient
      .from('payment_authorizations')
      .select('*')
      .eq('school_id', schoolId)
      .eq('reusable', true)
      .order('is_default', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!authCard) {
      results.push({
        school_id: schoolId,
        school_name: cfg.schools?.name,
        success: false,
        reason: 'No reusable card authorization found on file',
      });
      continue;
    }

    // Fetch outstanding unpaid monthly invoice
    const { data: bill } = await adminClient
      .from('semester_billing')
      .select('*')
      .eq('school_id', schoolId)
      .eq('billing_frequency', 'monthly')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!bill || Number(bill.amount_paid) >= Number(bill.total_payable || bill.amount_due)) {
      results.push({
        school_id: schoolId,
        school_name: cfg.schools?.name,
        success: true,
        reason: 'No outstanding balance on current monthly invoice',
      });
      continue;
    }

    const outstandingGHS = Math.max(1, Number(bill.total_payable || bill.amount_due) - Number(bill.amount_paid));
    const amountInPesewas = Math.round(outstandingGHS * 100);
    const reference = `REC_${schoolId.slice(0, 8)}_${Date.now()}`;

    try {
      let chargeSuccess = false;
      let chargeData = null;

      if (paystackSecret && !paystackSecret.includes('placeholder')) {
        const res = await fetch('https://api.paystack.co/transaction/charge_authorization', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${paystackSecret}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            authorization_code: authCard.authorization_code,
            email: authCard.customer_email || cfg.schools?.email || 'billing@schoolms.org',
            amount: amountInPesewas,
            currency: 'GHS',
            reference,
            metadata: {
              school_id: schoolId,
              billing_id: bill.id,
              type: 'recurring_monthly_charge',
            },
          }),
        });

        const pstkRes = await res.json();
        chargeSuccess = pstkRes.status && pstkRes.data?.status === 'success';
        chargeData = pstkRes.data;
      } else {
        // Development mode simulation - only allowed when not in production and PAYMENT_SIMULATION is true (Finding M-6)
        if (process.env.NODE_ENV === 'production') {
          throw new Error('Live Paystack secret key required in production');
        }
        if (process.env.PAYMENT_SIMULATION !== 'true') {
          throw new Error('Server payment configuration error: PAYSTACK_SECRET_KEY is missing and PAYMENT_SIMULATION is not enabled');
        }
        console.warn('[SECURITY WARNING] PAYMENT_SIMULATION is enabled: simulating successful recurring charge in non-production environment');
        chargeSuccess = true;
        chargeData = {
          reference,
          gateway_response: 'Approved (Test recurring charge)',
          channel: 'card',
          paid_at: new Date().toISOString(),
        };
      }

      if (chargeSuccess) {
        // Record payment
        await adminClient.from('payments').insert({
          school_id: schoolId,
          billing_id: bill.id,
          amount: outstandingGHS,
          method: 'card',
          reference,
          paid_on: new Date().toISOString().slice(0, 10),
          verification: 'provider_verified',
          provider: 'paystack',
          notes: `Automatic monthly card renewal (${authCard.card_type} •••• ${authCard.last4})`,
          status: 'valid',
        });

        const nextDate = new Date();
        nextDate.setMonth(nextDate.getMonth() + 1);

        await adminClient
          .from('school_billing_configs')
          .update({
            status: 'active',
            next_billing_date: nextDate.toISOString().slice(0, 10),
            grace_period_end: null,
            updated_at: new Date().toISOString(),
          })
          .eq('school_id', schoolId);

        results.push({
          school_id: schoolId,
          school_name: cfg.schools?.name,
          success: true,
          amount: outstandingGHS,
          reference,
        });
      } else {
        const graceEnd = new Date();
        graceEnd.setDate(graceEnd.getDate() + (cfg.grace_period_days || 7));

        await adminClient
          .from('school_billing_configs')
          .update({
            status: 'grace_period',
            grace_period_end: graceEnd.toISOString().slice(0, 10),
            updated_at: new Date().toISOString(),
          })
          .eq('school_id', schoolId);

        results.push({
          school_id: schoolId,
          school_name: cfg.schools?.name,
          success: false,
          reason: chargeData?.gateway_response || 'Card deduction declined',
        });
      }
    } catch (err) {
      results.push({
        school_id: schoolId,
        school_name: cfg.schools?.name,
        success: false,
        reason: err.message,
      });
    }
  }

  return { success: true, processed: results.length, results };
}

export default async function handler(req, res) {
  if (req.method === 'POST') {
    try {
      const authHeader = req.headers.authorization;
      const result = await handleChargeRecurring(req.body, authHeader);
      res.status(200).json(result);
    } catch (err) {
      console.error('Charge recurring error:', err);
      res.status(400).json({ error: err.message || 'Recurring charge failed' });
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}
