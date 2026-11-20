import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const recipientItemSchema = z.object({
  phone: z.string().trim().min(7).max(20),
  name: z.string().trim().max(120).optional(),
  student_id: z.string().uuid().nullable().optional(),
  personalized_message: z.string().trim().max(1000).optional(),
});

const sendSmsSchema = z.object({
  school_id: z.string().uuid('Invalid school ID format'),
  recipients: z.array(recipientItemSchema).min(1, 'At least one recipient is required').max(500, 'Maximum 500 recipients per broadcast'),
  message: z.string().trim().min(1, 'Message content is required').max(1000, 'Message cannot exceed 1000 characters'),
  title: z.string().trim().max(120).optional(),
  filter_type: z.enum(['all', 'class', 'custom']).optional(),
  target_class_id: z.string().uuid().nullable().optional(),
});

/**
 * Normalizes phone numbers to international E.164-compatible format (defaulting to Ghana +233).
 */
export function formatPhoneNumber(rawPhone) {
  if (!rawPhone) return null;
  let digits = String(rawPhone).replace(/[^0-9]/g, '');
  if (!digits) return null;

  // Handle local Ghana 0XXXXXXXXX (10 digits) -> 233XXXXXXXXX
  if (digits.length === 10 && digits.startsWith('0')) {
    digits = '233' + digits.substring(1);
  }
  // If 9 digits starting without 0 (e.g. 241234567)
  if (digits.length === 9) {
    digits = '233' + digits;
  }
  // International format check (min 10, max 15 digits)
  if (digits.length < 10 || digits.length > 15) {
    return null;
  }
  return digits;
}

/**
 * Dispatches an SMS via Arkesel v2 SMS API.
 */
async function sendArkeselSMS({ apiKey, senderId, recipients, message }) {
  const url = 'https://sms.arkesel.com/api/v2/sms/send';
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sender: senderId || 'SchoolMS',
      message,
      recipients,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.status === 'error') {
    throw new Error(data.message || `Arkesel API failed with HTTP ${res.status}`);
  }
  return {
    provider: 'arkesel',
    providerMessageId: data.data?.[0]?.id || data.id || 'arkesel-' + Date.now(),
    response: data,
  };
}

/**
 * Dispatches an SMS via Hubtel SMS API.
 */
async function sendHubtelSMS({ apiKey, apiSecret, senderId, recipient, message }) {
  const authStr = Buffer.from(`${apiKey}:${apiSecret || ''}`).toString('base64');
  const url = `https://smsc.hubtel.com/v1/messages/send?From=${encodeURIComponent(
    senderId || 'SchoolMS'
  )}&To=${encodeURIComponent(recipient)}&Content=${encodeURIComponent(message)}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Basic ${authStr}`,
    },
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.status !== 0) {
    throw new Error(data.description || `Hubtel SMS failed with HTTP ${res.status}`);
  }
  return {
    provider: 'hubtel',
    providerMessageId: data.messageId || 'hubtel-' + Date.now(),
    response: data,
  };
}

export async function handleSendSMS(rawBody, authHeader) {
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) {
    throw new Error('Server configuration error: SUPABASE environment variables are not configured');
  }

  // 1. Zod input validation
  const parseResult = sendSmsSchema.safeParse(rawBody);
  if (!parseResult.success) {
    const errorMsg = parseResult.error.issues.map((i) => i.message).join('; ');
    throw new Error(`Invalid input: ${errorMsg}`);
  }

  const { school_id, recipients, message, title, filter_type, target_class_id } = parseResult.data;

  // 2. Authenticate caller
  const token = (authHeader || '').replace(/^Bearer\s+/i, '');
  if (!token) throw new Error('Unauthorized: missing authorization token');

  const callerClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userErr } = await callerClient.auth.getUser(token);
  if (userErr || !userData?.user) throw new Error('Unauthorized: invalid session');
  const callerId = userData.user.id;

  const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Verify school exists and is active (suspended schools cannot dispatch SMS)
  const { data: school, error: schoolErr } = await adminClient
    .from('schools')
    .select('id, name, status')
    .eq('id', school_id)
    .single();

  if (schoolErr || !school) {
    throw new Error('School not found');
  }

  if (school.status === 'suspended') {
    throw new Error('School account is suspended due to overdue billing. Settle invoices to reactivate messaging services.');
  }

  // Verify caller is super admin or active headmaster of this school
  const { data: sa } = await adminClient.from('platform_admins').select('user_id').eq('user_id', callerId).maybeSingle();
  const isSuperAdmin = !!sa;

  if (!isSuperAdmin) {
    const { data: m } = await adminClient
      .from('school_memberships')
      .select('role, status')
      .eq('school_id', school_id)
      .eq('user_id', callerId)
      .maybeSingle();

    if (!m || m.role !== 'headmaster' || m.status !== 'active') {
      throw new Error('Unauthorized: only the headmaster can dispatch bulk SMS messages');
    }
  }

  // Recipient validation and caps (Finding M-4)
  if (filter_type === 'custom') {
    if (recipients.length > 50) {
      throw new Error('Custom SMS broadcasts are limited to a maximum of 50 recipients per request.');
    }
  } else {
    // When filter_type !== 'custom', ensure all student_ids belong to the caller's school_id
    const studentIds = Array.from(new Set(recipients.map((r) => r.student_id).filter(Boolean)));
    if (studentIds.length > 0) {
      const { data: validStudents, error: studentErr } = await adminClient
        .from('students')
        .select('id')
        .eq('school_id', school_id)
        .in('id', studentIds);

      if (studentErr) {
        throw new Error('Failed to validate student recipients for this school');
      }

      const validStudentIdSet = new Set((validStudents || []).map((s) => s.id));
      const hasMismatch = studentIds.some((id) => !validStudentIdSet.has(id));
      if (hasMismatch) {
        throw new Error('Invalid recipient: one or more students do not belong to this school');
      }
    }
  }

  // Daily platform-spend guard (Finding M-4)
  // Query sum of estimated_cost from sms_logs created today (UTC midnight).
  // Note [Finding M-4]: A durable per-school prepaid SMS balance table (school_sms_credits)
  // is needed before opening SMS to self-serve topups. This global guard prevents unexpected
  // carrier spend on shared platform credentials.
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const { data: dailyLogs, error: dailyLogsErr } = await adminClient
    .from('sms_logs')
    .select('estimated_cost')
    .gte('created_at', todayStart.toISOString());

  if (!dailyLogsErr && Array.isArray(dailyLogs)) {
    const dailySpend = dailyLogs.reduce((acc, row) => acc + Number(row.estimated_cost || 0), 0);
    const dailyCap = Number(process.env.PLATFORM_SMS_DAILY_CAP_GHS || 50);
    if (dailySpend >= dailyCap) {
      throw new Error('Daily platform SMS limit reached. Contact support.');
    }
  }

  // 3. Load school communication settings & SaaS platform shared credentials
  const { data: settings } = await adminClient
    .from('communication_settings')
    .select('*')
    .eq('school_id', school_id)
    .maybeSingle();

  // SaaS platform-level shared SMS ID & credentials
  const platformSenderId = (
    process.env.PLATFORM_SMS_SENDER_ID ||
    process.env.SMS_SENDER_ID ||
    'SchoolMS'
  ).slice(0, 11);

  const platformApiKey =
    process.env.PLATFORM_SMS_API_KEY ||
    process.env.ARKESEL_API_KEY ||
    process.env.SMS_API_KEY;

  const platformApiSecret =
    process.env.PLATFORM_SMS_API_SECRET ||
    process.env.HUBTEL_CLIENT_SECRET;

  const platformProvider = process.env.PLATFORM_SMS_PROVIDER || 'arkesel';
  const platformRatePerUnit = Number(process.env.PLATFORM_SMS_RATE || 0.05);

  // If school has a private key, use it; otherwise use SaaS shared gateway
  const apiKey = settings?.sms_api_key || platformApiKey;
  const apiSecret = settings?.sms_api_secret || platformApiSecret;
  const senderId = (settings?.sms_sender_id || platformSenderId).slice(0, 11);
  const provider = settings?.provider || platformProvider;
  const ratePerUnit = Number(settings?.sms_rate_per_unit || platformRatePerUnit);

  // 4. Create communication batch
  const { data: batch, error: batchErr } = await adminClient
    .from('communication_batches')
    .insert({
      school_id,
      channel: 'sms',
      title: title || `SMS Broadcast - ${new Date().toLocaleDateString()}`,
      filter_type: filter_type || 'all',
      target_class_id: target_class_id || null,
      total_recipients: recipients.length,
      status: 'processing',
      created_by: callerId,
    })
    .select()
    .single();

  if (batchErr) throw batchErr;

  let successfulCount = 0;
  let failedCount = 0;
  let totalCost = 0;
  const dispatchResults = [];

  // 5. Process recipients
  for (const item of recipients) {
    const cleanPhone = formatPhoneNumber(item.phone);
    const recipientName = item.name || 'Parent/Guardian';
    const personalizedMessage = item.personalized_message || message;
    const units = Math.max(1, Math.ceil(personalizedMessage.length / 160));
    const estimatedCost = units * ratePerUnit;

    if (!cleanPhone) {
      failedCount++;
      const logEntry = {
        school_id,
        batch_id: batch.id,
        student_id: item.student_id || null,
        recipient_name: recipientName,
        recipient_phone: item.phone || 'N/A',
        message: personalizedMessage,
        units,
        estimated_cost: 0,
        status: 'failed',
        provider,
        error_message: 'Invalid phone number format',
        sent_by: callerId,
      };
      await adminClient.from('sms_logs').insert(logEntry);
      dispatchResults.push({ ...logEntry, success: false });
      continue;
    }

    try {
      let providerResp;
      if (!apiKey || apiKey === 'demo' || !settings?.is_sms_enabled) {
        providerResp = {
          provider: `${provider}-simulated`,
          providerMessageId: `sim-${Date.now()}`,
          response: { simulated: true, notice: 'Live SMS API key not configured or disabled in settings' },
        };
      } else if (provider === 'arkesel') {
        providerResp = await sendArkeselSMS({
          apiKey,
          senderId,
          recipients: [cleanPhone],
          message: personalizedMessage,
        });
      } else if (provider === 'hubtel') {
        providerResp = await sendHubtelSMS({
          apiKey,
          apiSecret,
          senderId,
          recipient: cleanPhone,
          message: personalizedMessage,
        });
      } else {
        providerResp = {
          provider: 'custom',
          providerMessageId: `custom-${Date.now()}`,
          response: { custom: true },
        };
      }

      successfulCount++;
      totalCost += estimatedCost;

      const logEntry = {
        school_id,
        batch_id: batch.id,
        student_id: item.student_id || null,
        recipient_name: recipientName,
        recipient_phone: cleanPhone,
        message: personalizedMessage,
        units,
        estimated_cost: estimatedCost,
        status: 'sent',
        provider: providerResp.provider,
        provider_message_id: providerResp.providerMessageId,
        sent_by: callerId,
      };
      await adminClient.from('sms_logs').insert(logEntry);
      dispatchResults.push({ ...logEntry, success: true });
    } catch (sendErr) {
      failedCount++;
      const logEntry = {
        school_id,
        batch_id: batch.id,
        student_id: item.student_id || null,
        recipient_name: recipientName,
        recipient_phone: cleanPhone,
        message: personalizedMessage,
        units,
        estimated_cost: 0,
        status: 'failed',
        provider,
        error_message: sendErr.message || 'SMS delivery failed',
        sent_by: callerId,
      };
      await adminClient.from('sms_logs').insert(logEntry);
      dispatchResults.push({ ...logEntry, success: false });
    }
  }

  // 6. Update batch totals
  await adminClient
    .from('communication_batches')
    .update({
      successful_count: successfulCount,
      failed_count: failedCount,
      estimated_cost: totalCost,
      status: failedCount === recipients.length ? 'failed' : 'completed',
    })
    .eq('id', batch.id);

  return {
    success: true,
    batch_id: batch.id,
    total_recipients: recipients.length,
    successful_count: successfulCount,
    failed_count: failedCount,
    estimated_cost: totalCost,
    provider,
    is_live: !!(apiKey && apiKey !== 'demo' && settings?.is_sms_enabled),
    results: dispatchResults,
  };
}

export default async function handler(req, res) {
  if (req.method === 'POST') {
    try {
      const authHeader = req.headers.authorization;
      const result = await handleSendSMS(req.body, authHeader);
      res.status(200).json(result);
    } catch (err) {
      console.error('Send SMS error:', err);
      res.status(400).json({ error: err.message || 'Failed to dispatch SMS' });
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}
