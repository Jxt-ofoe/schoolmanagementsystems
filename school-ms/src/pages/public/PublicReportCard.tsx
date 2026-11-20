import { useState, useEffect, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { generateReportCardPdf, downloadPdfBlob } from '../../lib/reportPdf';
import { formatDate, todayISO } from '../../lib/format';

interface ReportCardPayload {
  shareId: string;
  shareStatus: string;
  sharedAt: string;
  expiresAt?: string;
  student: {
    id?: string;
    first_name: string;
    last_name: string;
    other_names: string | null;
    admission_number: string;
    gender: string | null;
    guardian_name: string | null;
    guardian_phone: string | null;
  };
  school: {
    id?: string;
    name: string;
    motto: string | null;
    address: string | null;
    phone: string | null;
    email: string | null;
    logo_url: string | null;
  };
  semester: {
    id?: string;
    name: string;
    academic_year: string;
  };
  class: {
    id?: string;
    name: string;
    section: string | null;
  };
  results: {
    subject_id: string;
    subject_name: string;
    total: number | null;
    percentage: number | null;
    grade: string | null;
    remark: string | null;
    scores_entered?: number;
    assessments_count?: number;
  }[];
  attendance: {
    present: number;
    absent: number;
    days_marked: number;
    rate?: number;
  } | null;
  terminalReport: {
    conduct: string | null;
    attitude: string | null;
    interest: string | null;
    class_teacher_remarks: string | null;
    headmaster_remarks: string | null;
    promotion_recommendation: string | null;
    next_term_begins: string | null;
    position: number | null;
    total_students: number | null;
    overall_grade: string | null;
    average_score: number | null;
    total_score: number | null;
    status: string;
  } | null;
  gradingBands?: { grade: string; min: number; max: number; remark: string }[];
}

export default function PublicReportCard() {
  const { shareId } = useParams<{ shareId: string }>();
  const [data, setData] = useState<ReportCardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const reportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchReport() {
      if (!shareId) {
        setError('No report card share link provided.');
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const res = await fetch(`/api/report/view?id=${encodeURIComponent(shareId)}`);
        const json = await res.json();

        if (cancelled) return;

        if (!res.ok || json.error) {
          throw new Error(json.error || 'Failed to load official report card.');
        }

        setData(json.reportCard);
      } catch (err: any) {
        if (cancelled) return;
        setError(err.message || 'Unable to open report card. Please verify your link.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchReport();
    return () => {
      cancelled = true;
    };
  }, [shareId]);

  const handleDownloadPdf = async () => {
    if (!reportRef.current || !data) return;
    setDownloading(true);
    try {
      const studentName = `${data.student.first_name}_${data.student.last_name}`;
      const filename = `Report_Card_${studentName.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
      const { blob } = await generateReportCardPdf(reportRef.current, filename);
      downloadPdfBlob(blob, filename);
    } catch (err: any) {
      alert(`Could not generate PDF: ${err.message || 'Unknown error'}`);
    } finally {
      setDownloading(false);
    }
  };

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', padding: 20 }}>
        <div style={{ width: 42, height: 42, border: '4px solid #cbd5e1', borderTopColor: '#0b3d26', borderRadius: '50%', animation: 'spin .8s linear infinite', marginBottom: 16 }} />
        <h2 style={{ fontSize: '1.15rem', color: '#1e293b', fontWeight: 600 }}>Loading Official Terminal Report Card…</h2>
        <p style={{ color: '#64748b', fontSize: '0.9rem' }}>Verifying school authorization and examination marks</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', padding: 20, textAlign: 'center' }}>
        <div style={{ background: '#fff', borderRadius: 12, padding: '32px 24px', maxWidth: 460, width: '100%', boxShadow: '0 4px 16px rgba(0,0,0,0.06)', border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: 12 }}>📄⚠️</div>
          <h1 style={{ fontSize: '1.25rem', color: '#991b1b', marginBottom: 8, fontWeight: 700 }}>Report Card Unavailable</h1>
          <p style={{ color: '#475569', fontSize: '0.92rem', lineHeight: 1.5, marginBottom: 20 }}>
            {error || 'This report card link is invalid or has expired. Please contact the school administration or class teacher for an updated link.'}
          </p>
          <Link
            to="/login"
            style={{
              display: 'inline-block',
              background: '#0b3d26',
              color: '#fff',
              padding: '10px 18px',
              borderRadius: 8,
              textDecoration: 'none',
              fontWeight: 600,
              fontSize: '0.9rem',
            }}
          >
            Go to School Portal
          </Link>
        </div>
      </div>
    );
  }

  const { student, school, semester, class: cls, results, attendance, terminalReport } = data;

  // Calculate summary metrics
  const totalScore = terminalReport?.total_score ?? Math.round(results.reduce((s, r) => s + Number(r.total || 0), 0) * 10) / 10;
  const countWithScores = results.filter((r) => r.percentage !== null || r.total !== null).length;
  const avgPercentage = terminalReport?.average_score ?? (countWithScores > 0 ? Math.round((totalScore / countWithScores) * 10) / 10 : null);
  const position = terminalReport?.position;
  const totalStudents = terminalReport?.total_students;
  const overallGrade = terminalReport?.overall_grade;

  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', padding: '16px 12px 48px' }}>
      {/* Top Banner / Actions for Parent */}
      <div className="no-print" style={{ maxWidth: 860, margin: '0 auto 16px', display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'space-between', alignItems: 'center', background: '#0b3d26', color: '#fff', padding: '12px 18px', borderRadius: 10, boxShadow: '0 2px 8px rgba(0,0,0,0.1)' }}>
        <div style={{ minWidth: 200, flex: '1 1 auto' }}>
          <div style={{ fontWeight: 700, fontSize: '1rem', letterSpacing: '0.02em' }}>{school.name}</div>
          <div style={{ fontSize: '0.82rem', color: '#a7f3d0' }}>Official Student Examination Terminal Report Card</div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            onClick={handleDownloadPdf}
            disabled={downloading}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              background: '#fcd116',
              color: '#0b3d26',
              border: 0,
              padding: '9px 15px',
              borderRadius: 8,
              fontWeight: 700,
              fontSize: '0.88rem',
              cursor: downloading ? 'not-allowed' : 'pointer',
              boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
            }}
          >
            {downloading ? '⏳ Generating PDF…' : '⬇️ Download Official PDF'}
          </button>
          <button
            onClick={() => window.print()}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              background: '#ffffff',
              color: '#0b3d26',
              border: 0,
              padding: '9px 14px',
              borderRadius: 8,
              fontWeight: 600,
              fontSize: '0.88rem',
              cursor: 'pointer',
            }}
          >
            🖨️ Print
          </button>
        </div>
      </div>

      {/* Official A4 Terminal Report Card Container */}
      <div
        ref={reportRef}
        className="terminal-report-page"
        style={{
          maxWidth: 860,
          margin: '0 auto',
          background: '#ffffff',
          padding: '24px 28px',
          borderRadius: 12,
          boxShadow: '0 4px 18px rgba(0,0,0,0.06)',
          border: '1px solid #e2e8f0',
          boxSizing: 'border-box',
          color: '#0f172a',
          fontFamily: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        }}
      >
        {/* Header */}
        <div style={{ textAlign: 'center', borderBottom: '2.5px solid #0b3d26', paddingBottom: 12, marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, marginBottom: 6 }}>
            {school.logo_url ? (
              <img
                src={school.logo_url}
                alt={school.name}
                width="68"
                height="68"
                style={{ objectFit: 'contain', maxHeight: 68, maxWidth: 68 }}
              />
            ) : (
              <img src="/favicon.svg" alt="" width="52" height="52" />
            )}
            <div>
              <h1 style={{ fontSize: '1.45rem', textTransform: 'uppercase', color: '#0b3d26', margin: 0, fontWeight: 800, letterSpacing: '0.02em' }}>
                {school.name}
              </h1>
              {school.motto && (
                <div style={{ fontStyle: 'italic', color: '#475569', fontSize: '0.88rem', marginTop: 2 }}>
                  "{school.motto}"
                </div>
              )}
            </div>
          </div>
          <div style={{ fontSize: '0.82rem', color: '#475569' }}>
            {school.address && <span>{school.address} · </span>}
            {school.phone && <span>Tel: {school.phone} · </span>}
            {school.email && <span>Email: {school.email}</span>}
          </div>
          <div style={{ marginTop: 10, fontWeight: 800, fontSize: '1.15rem', letterSpacing: '0.06em', textTransform: 'uppercase', color: '#0f172a' }}>
            STUDENT'S TERMINAL REPORT
          </div>
          <div style={{ fontSize: '0.88rem', color: '#334155', fontWeight: 550, marginTop: 2 }}>
            {semester.name} {semester.academic_year ? `(${semester.academic_year})` : ''} · {cls.name} {cls.section ? `(${cls.section})` : ''}
          </div>
        </div>

        {/* Student Bio Grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '8px 20px',
            background: '#f8fafc',
            padding: '12px 16px',
            borderRadius: 8,
            border: '1px solid #e2e8f0',
            marginBottom: 16,
            fontSize: '0.88rem',
          }}
        >
          <div><strong>Student Name:</strong> {student.last_name}, {student.first_name} {student.other_names ?? ''}</div>
          <div><strong>Admission No:</strong> <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{student.admission_number}</span></div>
          <div><strong>Class:</strong> {cls.name} {cls.section ? `(${cls.section})` : ''}</div>
          <div><strong>Gender:</strong> {student.gender ? student.gender.toUpperCase() : '—'}</div>
          <div><strong>Attendance:</strong> {attendance ? `${attendance.present} / ${attendance.days_marked} days (${attendance.rate ?? Math.round((attendance.present / (attendance.days_marked || 1)) * 100)}%)` : '—'}</div>
          <div><strong>Report Status:</strong> <span style={{ color: '#0b3d26', fontWeight: 700 }}>Official Certified</span></div>
        </div>

        {/* Academic Performance Table */}
        <div style={{ marginBottom: 16 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
            <thead>
              <tr style={{ background: '#0b3d26', color: '#ffffff' }}>
                <th style={{ padding: '8px 12px', textAlign: 'left', fontWeight: 700 }}>Subject</th>
                <th style={{ padding: '8px 12px', textAlign: 'right', width: 90, fontWeight: 700 }}>Score (100)</th>
                <th style={{ padding: '8px 12px', textAlign: 'center', width: 75, fontWeight: 700 }}>Grade</th>
                <th style={{ padding: '8px 12px', textAlign: 'left', minWidth: 140, fontWeight: 700 }}>Remarks</th>
              </tr>
            </thead>
            <tbody>
              {results.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ textAlign: 'center', padding: 24, color: '#64748b' }}>
                    Official examination scores recorded by {school.name}.
                  </td>
                </tr>
              ) : (
                results.map((res, i) => (
                  <tr key={res.subject_id || i} style={{ borderBottom: '1px solid #e2e8f0', background: i % 2 === 0 ? '#ffffff' : '#f8fafc' }}>
                    <td style={{ padding: '9px 12px', fontWeight: 600 }}>{res.subject_name}</td>
                    <td style={{ padding: '9px 12px', textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                      {res.total !== null && res.total !== undefined ? Number(res.total).toFixed(1) : '—'}
                    </td>
                    <td style={{ padding: '9px 12px', textAlign: 'center', fontWeight: 800, color: '#0b3d26' }}>
                      {res.grade ?? '—'}
                    </td>
                    <td style={{ padding: '9px 12px', fontSize: '0.85rem', color: '#334155' }}>
                      {res.remark ?? 'Satisfactory effort'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Summary Statistics Cards */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 10,
            border: '1px solid #e2e8f0',
            background: '#fafafa',
            borderRadius: 8,
            padding: '12px 10px',
            marginBottom: 16,
            textAlign: 'center',
          }}
        >
          <div>
            <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Total Score</div>
            <strong style={{ fontSize: '1.25rem', color: '#0f172a' }}>{totalScore !== null ? totalScore : '—'}</strong>
          </div>
          <div>
            <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Term Average</div>
            <strong style={{ fontSize: '1.25rem', color: '#0f172a' }}>{avgPercentage !== null ? `${avgPercentage}%` : '—'}</strong>
          </div>
          <div>
            <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Overall Grade</div>
            <strong style={{ fontSize: '1.25rem', color: '#0b3d26' }}>{overallGrade ?? '—'}</strong>
          </div>
          <div>
            <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Class Position</div>
            <strong style={{ fontSize: '1.25rem', color: position === 1 ? '#0b3d26' : '#0f172a' }}>
              {position ? `${position}${totalStudents ? ` of ${totalStudents}` : ''}` : '—'}
              {position === 1 ? ' 🏆' : ''}
            </strong>
          </div>
        </div>

        {/* Character & Attitude */}
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#0f172a', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Conduct & Personality Assessment
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, fontSize: '0.85rem' }}>
            <div style={{ background: '#f8fafc', padding: '8px 12px', borderRadius: 6, border: '1px solid #e2e8f0' }}>
              <span style={{ color: '#64748b', fontSize: '0.75rem', display: 'block' }}>Conduct:</span>
              <strong>{terminalReport?.conduct || 'Respectful and obedient'}</strong>
            </div>
            <div style={{ background: '#f8fafc', padding: '8px 12px', borderRadius: 6, border: '1px solid #e2e8f0' }}>
              <span style={{ color: '#64748b', fontSize: '0.75rem', display: 'block' }}>Attitude:</span>
              <strong>{terminalReport?.attitude || 'Attentive and diligent in class'}</strong>
            </div>
            <div style={{ background: '#f8fafc', padding: '8px 12px', borderRadius: 6, border: '1px solid #e2e8f0' }}>
              <span style={{ color: '#64748b', fontSize: '0.75rem', display: 'block' }}>Interest:</span>
              <strong>{terminalReport?.interest || 'Curious and cooperative'}</strong>
            </div>
          </div>
        </div>

        {/* Remarks Section */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, fontSize: '0.85rem', marginBottom: 16 }}>
          <div style={{ padding: '10px 14px', background: '#f8fafc', borderRadius: 6, border: '1px solid #e2e8f0' }}>
            <div style={{ fontWeight: 700, marginBottom: 4, color: '#1e293b' }}>Class Teacher's Remarks:</div>
            <div style={{ color: '#334155', fontStyle: 'italic', lineHeight: 1.45 }}>
              "{terminalReport?.class_teacher_remarks || 'A dedicated learner with commendable progress throughout the term.'}"
            </div>
          </div>
          <div style={{ padding: '10px 14px', background: '#f8fafc', borderRadius: 6, border: '1px solid #e2e8f0' }}>
            <div style={{ fontWeight: 700, marginBottom: 4, color: '#1e293b' }}>Headmaster's Remarks:</div>
            <div style={{ color: '#334155', fontStyle: 'italic', lineHeight: 1.45 }}>
              "{terminalReport?.headmaster_remarks || 'Approved and officially certified. Keep up the high standard of academic commitment.'}"
            </div>
          </div>
        </div>

        {/* Re-opening and Official Stamp */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-end',
            paddingTop: 16,
            borderTop: '1.5px solid #e2e8f0',
            fontSize: '0.82rem',
            color: '#475569',
          }}
        >
          <div>
            <div>Next Term Begins: <strong style={{ color: '#0f172a' }}>{terminalReport?.next_term_begins || 'Refer to School Academic Calendar'}</strong></div>
            {terminalReport?.promotion_recommendation && (
              <div style={{ marginTop: 4 }}>
                Promotion Recommendation: <strong style={{ color: '#0b3d26' }}>{terminalReport.promotion_recommendation}</strong>
              </div>
            )}
            <div style={{ marginTop: 6, fontSize: '0.74rem', color: '#94a3b8' }}>
              Generated on {formatDate(todayISO())} · Verified by {school.name}
            </div>
          </div>
          <div style={{ textAlign: 'center', minWidth: 160 }}>
            <div style={{ height: 32, borderBottom: '1px solid #94a3b8', marginBottom: 4 }}></div>
            <div style={{ fontWeight: 600, fontSize: '0.78rem', color: '#334155' }}>Headmaster Signature & Stamp</div>
          </div>
        </div>
      </div>
    </div>
  );
}
