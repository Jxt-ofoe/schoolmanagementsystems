import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

const sendReminderSchema = z.object({
  school_id: z.string().uuid('Invalid school ID format'),
  billing_id: z.string().uuid().nullable().optional(),
  reminder_type: z.enum(['due_soon', 'due_today', 'failed', 'grace_warning', 'auto_renewal_notice']).optional(),
});

export async function handleSendReminder(rawBody, authHeader) {
  if (!SUPABASE_URL || !ANON_KEY) {
    throw new Error('Server configuration error: SUPABASE_URL and ANON_KEY must be configured in environment');
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    throw new Error('Server configuration error: SUPABASE_SERVICE_ROLE_KEY is not configured');
  }

  const parseResult = sendReminderSchema.safeParse(rawBody || {});
  if (!parseResult.success) {
    throw new Error('Invalid reminder parameters');
  }
  const { school_id, billing_id, reminder_type } = parseResult.data;

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
    throw new Error('Unauthorized: only platform super administrators can dispatch billing reminders');
  }

  const type = reminder_type || 'due_soon';

  // 1. Fetch school and billing details
  const { data: school } = await adminClient
    .from('schools')
    .select('id, name, phone, email')
    .eq('id', school_id)
    .single();

  if (!school) {
    throw new Error('School not found');
  }

  // Fetch headmaster contact if available
  const { data: headmasterMember } = await adminClient
    .from('school_memberships')
    .select('user_id, profiles(full_name, phone, email)')
    .eq('school_id', school_id)
    .eq('role', 'headmaster')
    .eq('status', 'active')
    .limit(1)
    .maybeSingle();

  const recipientPhone = headmasterMember?.profiles?.phone || school.phone;
  const recipientEmail = headmasterMember?.profiles?.email || school.email;

  // 2. Check for duplicate reminder
  const { data: existing } = await adminClient
    .from('billing_reminders')
    .select('id, sent_at')
    .eq('school_id', school_id)
    .eq('billing_id', billing_id || null)
    .eq('reminder_type', type)
    .eq('channel', 'sms')
    .maybeSingle();

  if (existing) {
    return {
      success: true,
      duplicate_prevented: true,
      message: `Reminder of type '${type}' was already sent on ${existing.sent_at}`,
    };
  }

  // 3. Craft message
  let message = '';
  switch (type) {
    case 'due_soon':
      message = `Hello ${school.name}, your School Management subscription invoice is due soon. Please log in to your admin dashboard to review and complete your payment via Paystack.`;
      break;
    case 'due_today':
      message = `Important: Today is the payment deadline for your ${school.name} subscription invoice. Please complete payment today to maintain uninterrupted access.`;
      break;
    case 'failed':
      message = `Notice: Your subscription payment for ${school.name} could not be processed. A grace period has been granted. Please log in to retry your payment.`;
      break;
    case 'grace_warning':
      message = `Urgent: The grace period for ${school.name} is expiring shortly. Please settle your outstanding invoice immediately to prevent service disruption.`;
      break;
    case 'auto_renewal_notice':
      message = `Notice: Your monthly subscription for ${school.name} is scheduled for automatic renewal in 3 days.`;
      break;
  }

  // 4. Record reminder log
  const { data: reminderLog, error: remErr } = await adminClient
    .from('billing_reminders')
    .insert({
      school_id,
      billing_id: billing_id || null,
      reminder_type: type,
      recipient_phone: recipientPhone,
      recipient_email: recipientEmail,
      channel: 'sms',
      message,
      status: 'sent',
      sent_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (remErr) {
    throw new Error(`Failed to record reminder: ${remErr.message}`);
  }

  return {
    success: true,
    reminder: reminderLog,
    recipient_phone: recipientPhone,
    recipient_email: recipientEmail,
  };
}

export default async function handler(req, res) {
  if (req.method === 'POST') {
    try {
      const authHeader = req.headers.authorization;
      const result = await handleSendReminder(req.body, authHeader);
      res.status(200).json(result);
    } catch (err) {
      console.error('Send reminder error:', err);
      res.status(400).json({ error: err.message || 'Failed to dispatch reminder' });
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}
