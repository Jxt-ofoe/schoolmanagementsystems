import { createClient } from '@supabase/supabase-js';
import { handleGetSchoolLogo } from '../school/logo.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://simskpwdkbcudmgzjsib.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handleReportView(shareId) {
  if (!shareId || !UUID_RE.test(String(shareId).trim())) {
    throw new Error('Invalid or missing report card share link');
  }

  const cleanShareId = String(shareId).trim().toLowerCase();

  const serviceKey = SERVICE_KEY || process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || 'sb_secret_WIQRhbLScCi4Z8y4dJ2klg_tJVgB3SI';
  const adminClient = createClient(SUPABASE_URL, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Fetch WhatsApp Report Share record
  const { data: share, error: shareErr } = await adminClient
    .from('whatsapp_report_shares')
    .select('*')
    .eq('id', cleanShareId)
    .maybeSingle();

  if (shareErr) {
    console.error('Error querying whatsapp_report_shares:', shareErr.message);
    throw new Error('Could not verify report card share link');
  }

  if (!share) {
    throw new Error('This report card link does not exist or has expired');
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
      .select('*')
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
      student: {
        id: student.id,
        first_name: student.first_name,
        last_name: student.last_name,
        other_names: student.other_names,
        admission_number: student.admission_number,
        gender: student.gender,
        guardian_name: share.parent_name || student.guardian_name,
        guardian_phone: share.parent_phone || student.guardian_phone,
      },
      school: {
        id: school.id,
        name: school.name,
        motto: school.motto,
        address: school.address,
        phone: school.phone,
        email: school.email,
        logo_url: schoolLogo,
      },
      semester: {
        id: semester?.id || semester_id,
        name: semester?.name || 'Semester',
        academic_year: semester?.academic_years?.name || '',
      },
      class: {
        id: cls?.id || class_id,
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
  res.setHeader('Access-Control-Allow-Origin', '*');
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

  try {
    const url = new URL(req.url, 'http://localhost');
    const shareId = url.searchParams.get('id') || url.searchParams.get('shareId');
    const result = await handleReportView(shareId);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify(result));
  } catch (err) {
    res.statusCode = 400;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: err.message || 'Failed to load report card' }));
  }
}
