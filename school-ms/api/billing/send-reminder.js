import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://simskpwdkbcudmgzjsib.supabase.co';
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_3awl3YZ_9dzYOyLGRv0EWw_0e2o3z_x';

export async function handleSendReminder(body, authHeader) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    throw new Error('Server configuration error: SUPABASE_SERVICE_ROLE_KEY is not configured');
  }

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

  const { school_id, billing_id, reminder_type } = body || {};
  if (!school_id) {
    throw new Error('School ID is required');
  }

  const validTypes = ['due_soon', 'due_today', 'failed', 'grace_warning', 'auto_renewal_notice'];
  const type = validTypes.includes(reminder_type) ? reminder_type : 'due_soon';

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
    default:
      message = `Reminder: Please review your pending subscription invoice for ${school.name}.`;
  }

  // 4. Record reminder in billing_reminders table (enforces duplicate prevention)
  const { error: insErr } = await adminClient.from('billing_reminders').insert({
    school_id,
    billing_id: billing_id || null,
    reminder_type: type,
    recipient_phone: recipientPhone,
    recipient_email: recipientEmail,
    channel: 'sms',
    message,
    status: 'sent',
  });

  if (insErr && insErr.code === '23505') {
    return { success: true, duplicate_prevented: true, message: 'Duplicate reminder prevented by unique constraint' };
  }

  // Also record in-app notification record
  await adminClient.from('billing_reminders').insert({
    school_id,
    billing_id: billing_id || null,
    reminder_type: type,
    recipient_phone: recipientPhone,
    recipient_email: recipientEmail,
    channel: 'in_app',
    message,
    status: 'sent',
  }).catch(() => null);

  return {
    success: true,
    reminder_type: type,
    school_name: school.name,
    recipient: recipientPhone || recipientEmail || 'School Admin',
    message,
  };
}

export default async function handler(req, res) {
  if (req.method === 'POST') {
    try {
      const authHeader = req.headers.authorization;
      const result = await handleSendReminder(req.body, authHeader);
      res.status(200).json(result);
    } catch (err) {
      res.status(400).json({ error: err.message || 'Failed to send billing reminder' });
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}
