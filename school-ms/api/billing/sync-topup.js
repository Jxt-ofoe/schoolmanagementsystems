import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://simskpwdkbcudmgzjsib.supabase.co';
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_3awl3YZ_9dzYOyLGRv0EWw_0e2o3z_x';

export async function handleSyncTopup(body, authHeader) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    throw new Error('Server configuration error: SUPABASE_SERVICE_ROLE_KEY is not configured');
  }

  const { school_id } = body || {};
  if (!school_id) {
    throw new Error('School ID is required');
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

  // Verify caller is super admin OR member of the school
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

    if (!membership) {
      throw new Error('Unauthorized: caller is not an active member of this school');
    }
  }

  // 2. Fetch active term / semester
  const { data: currentSem } = await adminClient
    .from('semesters')
    .select('id, name, starts_on, academic_year_id, academic_years(name)')
    .eq('school_id', school_id)
    .eq('is_current', true)
    .maybeSingle();

  if (!currentSem) {
    return { synced: false, reason: 'No active semester found' };
  }

  // 3. Fetch latest invoice for this term
  const { data: currentBill } = await adminClient
    .from('semester_billing')
    .select('*')
    .eq('school_id', school_id)
    .eq('semester_id', currentSem.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!currentBill) {
    // No invoice has been generated yet for this term (e.g. grace period active)
    return { synced: false, reason: 'No term invoice generated yet' };
  }

  // 4. Fetch current live active students count
  const { count: liveActiveCount } = await adminClient
    .from('students')
    .select('*', { count: 'exact', head: true })
    .eq('school_id', school_id)
    .eq('enrollment_status', 'active');

  const live = liveActiveCount || 0;

  if (live <= Number(currentBill.student_count || 0)) {
    return {
      synced: true,
      updated: false,
      liveActiveCount: live,
      invoicedCount: currentBill.student_count,
      message: 'Invoice already reflects all active students',
    };
  }

  // 5. Update invoice to include newly added students
  const { data: pSettings } = await adminClient
    .from('platform_settings')
    .select('price_per_student')
    .eq('id', true)
    .maybeSingle();
  const defaultPrice = Number(pSettings?.price_per_student ?? 3.0);

  const { data: cfg } = await adminClient
    .from('school_billing_configs')
    .select('*')
    .eq('school_id', school_id)
    .maybeSingle();

  const price = Number(cfg?.price_per_student ?? defaultPrice);
  const subtotal = live * price;

  let discount = 0;
  if (cfg?.discount_type === 'percentage' && Number(cfg.discount_value) > 0) {
    discount = Math.round(subtotal * (Number(cfg.discount_value) / 100) * 100) / 100;
  } else if (cfg?.discount_type === 'fixed' && Number(cfg.discount_value) > 0) {
    discount = Math.min(subtotal, Number(cfg.discount_value));
  }

  const passMarkup = cfg ? cfg.pass_fee_markup !== false : true;
  const markupPercent = cfg ? Number(cfg.fee_markup_percent ?? 3.0) : 3.0;
  const feeMarkup = passMarkup ? Math.round((subtotal - discount) * (markupPercent / 100) * 100) / 100 : 0;
  const total = Math.max(0, subtotal - discount + feeMarkup);
  const amountPaid = Number(currentBill.amount_paid || 0);

  const newStudents = live - Number(currentBill.student_count || 0);

  const { data: updatedBill, error: updateErr } = await adminClient
    .from('semester_billing')
    .update({
      student_count: live,
      discount_amount: discount,
      fee_markup_amount: feeMarkup,
      total_payable: total,
      subscription_status: total <= amountPaid ? 'paid' : 'awaiting_payment',
      notes: `Term invoice synced with ${live} active students (+${newStudents} new student addition)`,
      last_calculated_at: new Date().toISOString(),
    })
    .eq('id', currentBill.id)
    .select()
    .single();

  if (updateErr || !updatedBill) {
    throw new Error('Failed to update term invoice: ' + (updateErr?.message || 'unknown error'));
  }

  return {
    synced: true,
    updated: true,
    previousCount: currentBill.student_count,
    newCount: live,
    newStudentsAdded: newStudents,
    totalPayable: total,
    amountPaid,
    remainingBalance: Math.max(0, total - amountPaid),
    bill: updatedBill,
  };
}

export default async function handler(req, res) {
  if (req.method === 'POST') {
    try {
      const authHeader = req.headers.authorization;
      const result = await handleSyncTopup(req.body, authHeader);
      res.status(200).json(result);
    } catch (err) {
      res.status(400).json({ error: err.message || 'Failed to sync topup' });
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
}
