import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

const syncTopupSchema = z.object({
  school_id: z.string().uuid('Invalid school ID format'),
});

export async function handleSyncTopup(rawBody, authHeader) {
  if (!SUPABASE_URL || !ANON_KEY) {
    throw new Error('Server configuration error: SUPABASE_URL and ANON_KEY must be configured in environment');
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    throw new Error('Server configuration error: SUPABASE_SERVICE_ROLE_KEY is not configured');
  }

  // 1. Zod input validation
  const parseResult = syncTopupSchema.safeParse(rawBody);
  if (!parseResult.success) {
    throw new Error('School ID is invalid');
  }
  const { school_id } = parseResult.data;

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
      throw new Error('Unauthorized: only the headmaster or platform administrator can sync billing status');
    }
  }

  // 3. Fetch active term / semester
  const { data: currentSem } = await adminClient
    .from('semesters')
    .select('id, name, starts_on, academic_year_id, academic_years(name)')
    .eq('school_id', school_id)
    .eq('is_current', true)
    .maybeSingle();

  if (!currentSem) {
    return { synced: false, reason: 'No active semester found' };
  }

  // 4. Fetch main term invoice
  const { data: mainBill } = await adminClient
    .from('semester_billing')
    .select('*')
    .eq('school_id', school_id)
    .eq('semester_id', currentSem.id)
    .is('is_topup', false)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // 5. Fetch current live active students count
  const { count: liveActiveCount } = await adminClient
    .from('students')
    .select('*', { count: 'exact', head: true })
    .eq('school_id', school_id)
    .eq('enrollment_status', 'active');

  const live = liveActiveCount || 0;

  // 6. Run database enforcement function to recalculate billing and top-up counts
  let statusReport = null;
  try {
    const { data: enfData } = await adminClient.rpc('check_and_enforce_school_billing_status', {
      p_school_id: school_id,
    });
    statusReport = enfData;
  } catch (err) {
    console.warn('Billing enforcement RPC notice:', err);
  }

  // 7. Fetch all active invoices for this term (main + top-ups)
  const { data: allTermBills } = await adminClient
    .from('semester_billing')
    .select('id, invoice_number, is_topup, student_count, total_payable, amount_paid, subscription_status')
    .eq('school_id', school_id)
    .eq('semester_id', currentSem.id);

  const invoicedTotalStudents = (allTermBills || []).reduce((acc, b) => acc + (b.student_count || 0), 0);

  return {
    synced: true,
    updated: false,
    liveActiveCount: live,
    invoicedStudentCount: invoicedTotalStudents,
    mainBillCount: mainBill?.student_count ?? 0,
    topupCount: (allTermBills || []).filter((b) => b.is_topup).length,
    schoolStatus: statusReport?.school_status ?? 'active',
    isOverdue: statusReport?.is_overdue ?? false,
    message: 'Billing and top-up counts synchronized with database records',
  };
}

export default async function handler(req, res) {
  if (req.method === 'POST') {
    try {
      const authHeader = req.headers.authorization;
      const result = await handleSyncTopup(req.body, authHeader);
      res.status(200).json(result);
    } catch (err) {
      console.error('Sync topup error:', err);
      res.status(400).json({ error: err.message || 'Failed to sync topup' });
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}
