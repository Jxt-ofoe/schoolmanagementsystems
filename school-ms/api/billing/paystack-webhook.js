import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://simskpwdkbcudmgzjsib.supabase.co';

export async function handlePaystackWebhook(rawBody, signature) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    throw new Error('Server configuration error: SUPABASE_SERVICE_ROLE_KEY is not configured');
  }

  const webhookSecret = process.env.PAYSTACK_WEBHOOK_SECRET || process.env.PAYSTACK_SECRET_KEY;

  // 1. Verify HMAC SHA-512 signature
  if (webhookSecret && !webhookSecret.includes('placeholder')) {
    const hash = crypto
      .createHmac('sha512', webhookSecret)
      .update(typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody))
      .digest('hex');

    if (hash !== signature) {
      throw new Error('Invalid webhook signature');
    }
  }

  const payload = typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody;
  const { event, data } = payload || {};

  if (!event || !data) {
    return { status: 'ignored', message: 'No event or data present' };
  }

  const adminClient = createClient(SUPABASE_URL, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const reference = data.reference;
  const schoolId = data.metadata?.school_id;
  const billingId = data.metadata?.billing_id;
  const amountPaidGHS = Number(data.amount || 0) / 100.0;
  const channel = data.channel === 'card' ? 'card' : 'mobile_money';
  const paidDate = data.paid_at ? data.paid_at.slice(0, 10) : new Date().toISOString().slice(0, 10);

  // 2. Handle 'charge.success'
  if (event === 'charge.success') {
    // Idempotency: check if payment already recorded
    const { data: existingPayment } = await adminClient
      .from('payments')
      .select('id')
      .eq('reference', reference)
      .maybeSingle();

    if (existingPayment) {
      // Record webhook receipt without duplicate payment
      await adminClient.from('paystack_transactions').update({
        webhook_received_at: new Date().toISOString(),
      }).eq('reference', reference);

      return { status: 'success', duplicate: true, message: 'Payment already processed' };
    }

    if (schoolId && billingId) {
      // Insert verified payment record
      await adminClient.from('payments').insert({
        school_id: schoolId,
        billing_id: billingId,
        amount: amountPaidGHS,
        method: channel,
        reference,
        paid_on: paidDate,
        verification: 'provider_verified',
        provider: 'paystack',
        notes: `Webhook confirmed payment via Paystack (${data.channel})`,
        status: 'valid',
      });

      // Update Paystack transaction record
      await adminClient.from('paystack_transactions').upsert({
        reference,
        school_id: schoolId,
        billing_id: billingId,
        amount: amountPaidGHS,
        currency: data.currency || 'GHS',
        channel: data.channel,
        status: 'success',
        gateway_response: data.gateway_response || 'Successful',
        paid_at: data.paid_at,
        customer_email: data.customer?.email,
        customer_code: data.customer?.customer_code,
        authorization_code: data.authorization?.authorization_code,
        metadata: data.metadata || {},
        raw_payload: data,
        webhook_received_at: new Date().toISOString(),
      }, { onConflict: 'reference' });

      // Save reusable card authorization if available
      if (data.channel === 'card' && data.authorization?.reusable && data.authorization?.authorization_code) {
        const authInfo = data.authorization;
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
          customer_email: data.customer?.email,
          is_default: true,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'school_id, authorization_code' });
      }

      // Update subscription status and advance next billing date
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

      // Restore school to active if suspended
      await adminClient
        .from('schools')
        .update({ status: 'active', updated_at: new Date().toISOString() })
        .eq('id', schoolId)
        .eq('status', 'suspended');

      // Enforce school billing status and unsuspension check
      await adminClient.rpc('check_and_enforce_school_billing_status', { p_school_id: schoolId }).catch(() => {});

      // Audit log
      await adminClient.from('audit_logs').insert({
        school_id: schoolId,
        actor_id: null,
        actor_role: 'system',
        action: 'paystack_webhook_charge_success',
        entity_type: 'payments',
        entity_id: reference,
        metadata: { reference, amount: amountPaidGHS, channel: data.channel },
      });
    }

    return { status: 'success', event: 'charge.success', reference };
  }

  // 3. Handle 'charge.failed'
  if (event === 'charge.failed') {
    if (reference) {
      await adminClient.from('paystack_transactions').upsert({
        reference,
        school_id: schoolId || null,
        billing_id: billingId || null,
        amount: amountPaidGHS,
        currency: data.currency || 'GHS',
        channel: data.channel || 'unknown',
        status: 'failed',
        gateway_response: data.gateway_response || 'Declined',
        metadata: data.metadata || {},
        raw_payload: data,
        webhook_received_at: new Date().toISOString(),
      }, { onConflict: 'reference' });
    }

    if (schoolId) {
      const graceEnd = new Date();
      graceEnd.setDate(graceEnd.getDate() + 7);

      await adminClient
        .from('school_billing_configs')
        .update({
          status: 'grace_period',
          grace_period_end: graceEnd.toISOString().slice(0, 10),
          updated_at: new Date().toISOString(),
        })
        .eq('school_id', schoolId)
        .neq('status', 'active');

      // Record failure reminder log
      await adminClient.from('billing_reminders').upsert({
        school_id: schoolId,
        billing_id: billingId || null,
        reminder_type: 'failed',
        channel: 'in_app',
        message: `Payment charge failed: ${data.gateway_response || 'Payment declined'}. A 7-day grace period is now active.`,
        status: 'sent',
      }, { onConflict: 'school_id, billing_id, reminder_type, channel' });
    }

    return { status: 'handled', event: 'charge.failed', reference };
  }

  return { status: 'received', event };
}

export default async function handler(req, res) {
  if (req.method === 'POST') {
    try {
      const signature = req.headers['x-paystack-signature'];
      let rawBody = req.body;
      if (typeof rawBody !== 'string') {
        rawBody = JSON.stringify(rawBody);
      }
      const result = await handlePaystackWebhook(rawBody, signature);
      res.status(200).json(result);
    } catch (err) {
      res.status(400).json({ error: err.message || 'Webhook processing failed' });
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}
