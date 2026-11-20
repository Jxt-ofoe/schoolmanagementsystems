import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { handleGetSchoolLogo } from '../school/logo.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const shareIdSchema = z.string().uuid('Invalid report card share link');

// In-memory per-IP token bucket rate limiting (20 requests per minute per IP).
// Note: Vercel serverless functions are ephemeral instances; this in-memory bucket protects against
// bursts within the same warm container instance. Edge WAF / Vercel firewall rate-limiting rules are
// the durable platform-level control.
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 20;
const ipBuckets = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  let bucket = ipBuckets.get(ip);
  if (!bucket || now - bucket.windowStart > RATE_LIMIT_WINDOW_MS) {
    bucket = { windowStart: now, count: 1 };
    ipBuckets.set(ip, bucket);
    return true;
  }
  if (bucket.count >= RATE_LIMIT_MAX_REQUESTS) {
    return false;
  }
  bucket.count += 1;
  return true;
}

if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [ip, bucket] of ipBuckets.entries()) {
      if (now - bucket.windowStart > RATE_LIMIT_WINDOW_MS) {
        ipBuckets.delete(ip);
      }
    }
  }, 5 * 60 * 1000).unref?.();
}

export async function handleReportView(shareId) {
  const parseResult = shareIdSchema.safeParse(shareId);
  if (!parseResult.success) {
    throw new Error('Invalid or missing report card share link');
  }

  const cleanShareId = parseResult.data.toLowerCase();

  if (!SUPABASE_URL || !SERVICE_KEY) {
    throw new Error('Server configuration error: SUPABASE environment variables are not configured');
  }

  const adminClient = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Fetch WhatsApp Report Share record
  const { data: share, error: shareErr } = await adminClient
    .from('whatsapp_report_shares')
    .select('id, student_id, school_id, semester_id, class_id, status, parent_name, parent_phone, created_at, expires_at')
    .eq('id', cleanShareId)
    .maybeSingle();

  if (shareErr) {
    console.error('Error querying whatsapp_report_shares:', shareErr);
    throw new Error('Could not verify report card share link');
  }

  if (!share) {
    throw new Error('This report card link does not exist or has expired');
  }

  if (share.status && share.status !== 'sent' && share.status !== 'delivered' && share.status !== 'active') {
    throw new Error('This report card link is no longer active');
  }

  if (share.expires_at && new Date(share.expires_at).getTime() < Date.now()) {
    throw new Error('This report card link has expired');
  }

  const { student_id, school_id, semester_id, class_id } = share;

  // 2. Fetch Student info
  const { data: student, error: studentErr } = await adminClient
    .from('students')
    .select('id, first_name, last_name, other_names, admission_number, gender, guardian_name, guardian_phone, enrollment_status')
    .eq('id', student_id)
    .single();

  if (studentErr || !student) {
    throw new Error('Student record not found');
  }

  // 3. Fetch School details
  const { data: school, error: schoolErr } = await adminClient
    .from('schools')
    .select('id, name, code, status, email, phone, address, region, motto')
    .eq('id', school_id)
    .single();

  if (schoolErr || !school) {
    throw new Error('School record not found');
  }

  // Fetch school logo if present
  let schoolLogo = null;
  try {
    const logoResult = await handleGetSchoolLogo(school_id);
    schoolLogo = logoResult?.url || null;
  } catch (logoErr) {
    console.warn('Could not fetch school logo:', logoErr);
  }

  // 4. Fetch Semester & Academic Year
  const { data: semester } = await adminClient
    .from('semesters')
    .select('id, name, is_current, academic_years(id, name)')
    .eq('id', semester_id)
    .maybeSingle();

  // 5. Fetch Class
  const { data: cls } = await adminClient
    .from('classes')
    .select('id, name, section')
    .eq('id', class_id)
    .maybeSingle();

  // 6. Fetch Subject Results for this student and semester
  let results = [];
  try {
    const { data: resData, error: resErr } = await adminClient.rpc('student_semester_results', {
      p_student_id: student_id,
      p_semester_id: semester_id,
    });
    if (!resErr && Array.isArray(resData)) {
      results = resData;
    }
  } catch (resRpcErr) {
    console.warn('Could not query student_semester_results RPC:', resRpcErr);
  }

  // 7. Fetch Attendance Summary
  let attendance = null;
  try {
    const { data: attData } = await adminClient.rpc('student_attendance_summary', {
      p_student_id: student_id,
      p_semester_id: semester_id,
    });
    if (attData) {
      attendance = Array.isArray(attData) ? attData[0] || null : attData;
    }
  } catch (attRpcErr) {
    console.warn('Could not query student_attendance_summary RPC:', attRpcErr);
  }

  // 8. Fetch Official Published Terminal Report if present
  let terminalReport = null;
  try {
    const { data: repData } = await adminClient
      .from('terminal_reports')
      .select('id, attendance, position, total_score, overall_average, class_average, promoted, conduct, attitude, interest, form_master_remarks, headmaster_remarks, next_term_begins, snapshot_data')
      .eq('student_id', student_id)
      .eq('semester_id', semester_id)
      .maybeSingle();
    if (repData) {
      terminalReport = repData;
    }
  } catch (repErr) {
    console.warn('Could not query terminal_reports:', repErr);
  }

  // 9. Fetch Grading Scale Bands for remark/grade calculation
  let gradingBands = [];
  try {
    const { data: configData } = await adminClient
      .from('grading_configs')
      .select('bands')
      .eq('school_id', school_id)
      .maybeSingle();
    if (configData?.bands && Array.isArray(configData.bands)) {
      gradingBands = configData.bands;
    }
  } catch {
    // Optional fallback
  }

  // Fallback results from snapshot if RPC returned empty and report has snapshot
  if (results.length === 0 && terminalReport?.snapshot_data?.results && Array.isArray(terminalReport.snapshot_data.results)) {
    results = terminalReport.snapshot_data.results;
  }

  return {
    success: true,
    reportCard: {
      shareId: cleanShareId,
      shareStatus: share.status,
      sharedAt: share.created_at,
      expiresAt: share.expires_at,
      student: {
        first_name: student.first_name,
        last_name: student.last_name,
        other_names: student.other_names,
        admission_number: student.admission_number,
        gender: student.gender,
        guardian_name: share.parent_name || student.guardian_name,
        guardian_phone: share.parent_phone || student.guardian_phone,
      },
      school: {
        name: school.name,
        motto: school.motto,
        address: school.address,
        phone: school.phone,
        email: school.email,
        logo_url: schoolLogo,
      },
      semester: {
        name: semester?.name || 'Semester',
        academic_year: semester?.academic_years?.name || '',
      },
      class: {
        name: cls?.name || 'Class',
        section: cls?.section || null,
      },
      results,
      attendance,
      terminalReport,
      gradingBands,
    },
  };
}

export default async function handler(req, res) {
  const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const reqOrigin = req.headers?.origin;
  if (reqOrigin && allowedOrigins.includes(reqOrigin)) {
    res.setHeader('Access-Control-Allow-Origin', reqOrigin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'Method not allowed' }));
  }

  // Rate limiting check: 20 req/min/IP
  const forwarded = req.headers?.['x-forwarded-for'];
  const ip = (typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : null) || req.socket?.remoteAddress || 'unknown';
  if (!checkRateLimit(ip)) {
    res.statusCode = 429;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'Too many requests. Please try again later.' }));
  }

  try {
    const url = new URL(req.url, 'http://localhost');
    const shareId = url.searchParams.get('id') || url.searchParams.get('shareId');
    const result = await handleReportView(shareId);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify(result));
  } catch (err) {
    console.error('Report view error:', err);
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: err.message || 'Failed to load report card' }));
  }
}
