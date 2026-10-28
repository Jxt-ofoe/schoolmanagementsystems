import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { semesterLabel, unwrap, useClasses, useGradeBands, useSchoolDetails, useSemesters } from '../../lib/queries';
import { classLabel, formatDate, todayISO } from '../../lib/format';
import { friendlyError } from '../../lib/errors';
import { useToast } from '../../lib/toast';
import { gradeFor } from '../../lib/grades';
import type { SchoolGradingConfig, Student, TerminalReport } from '../../lib/types';
import {
  Alert,
  Button,
  ErrorBox,
  Input,
  PageHeader,
  Select,
  Spinner,
  Textarea,
} from '../../components/ui';

export default function TerminalReportViewPage() {
  const { studentId } = useParams();
  const [params] = useSearchParams();
  const { active } = useAuth();
  const schoolId = active?.school_id;
  const qc = useQueryClient();
  const toast = useToast();

  const semesters = useSemesters(schoolId);
  const classes = useClasses(schoolId);
  const gradeBands = useGradeBands(schoolId);

  const semesterId = params.get('semester') || semesters.data?.find((s) => s.is_current)?.id || '';
  const classIdParam = params.get('class') || '';

  const [conduct, setConduct] = useState('');
  const [attitude, setAttitude] = useState('');
  const [interest, setInterest] = useState('');
  const [teacherRemarks, setTeacherRemarks] = useState('');
  const [headmasterRemarks, setHeadmasterRemarks] = useState('');
  const [promotionRec, setPromotionRec] = useState<string>('');
  const [nextTermBegins, setNextTermBegins] = useState('');

  // School profile & info
  const schoolQuery = useSchoolDetails(schoolId);

  // Student details
  const studentQuery = useQuery({
    queryKey: ['student_for_report', studentId],
    enabled: !!studentId,
    queryFn: () => unwrap<Student>(supabase.from('students').select('*').eq('id', studentId!).single()),
  });

  const student = studentQuery.data;
  const classId = classIdParam || student?.current_class_id || '';
  const studentClass = classes.data?.find((c) => c.id === classId);
  const currentSemester = semesters.data?.find((s) => s.id === semesterId);

  // School grading configs (conduct/attitude options, weights, etc.)
  const gradingConfig = useQuery({
    queryKey: ['grading_config', schoolId],
    queryFn: async () => {
      const { data } = await supabase.from('school_grading_configs').select('*').eq('school_id', schoolId!).maybeSingle();
      return data as SchoolGradingConfig | null;
    },
  });

  // Attendance summary for this student in this semester
  const attendanceQuery = useQuery({
    queryKey: ['student_attendance_report', studentId, currentSemester?.starts_on, currentSemester?.ends_on],
    enabled: !!studentId && !!currentSemester?.starts_on && !!currentSemester?.ends_on,
    queryFn: () =>
      unwrap<{ days_marked: number; present: number; absent: number; late: number; excused: number; rate: number }>(
        supabase.rpc('student_attendance_summary', {
          p_student_id: studentId!,
          p_from: currentSemester!.starts_on,
          p_to: currentSemester!.ends_on,
        })
      ),
  });

  // Academic semester results for this student
  const resultsQuery = useQuery({
    queryKey: ['student_semester_results_report', studentId, semesterId],
    enabled: !!studentId && !!semesterId,
    queryFn: () =>
      unwrap<
        {
          subject_id: string;
          subject_name: string;
          total: number;
          weight_total: number;
          percentage: number | null;
          grade: string | null;
          remark: string | null;
          scores_entered: number;
          assessments_count: number;
        }[]
      >(supabase.rpc('student_semester_results', { p_student_id: studentId!, p_semester_id: semesterId })),
  });

  // Existing saved or published terminal report
  const existingReport = useQuery({
    queryKey: ['terminal_report', studentId, semesterId, classId],
    enabled: !!studentId && !!semesterId && !!classId,
    queryFn: async () => {
      const { data } = await supabase
        .from('terminal_reports')
        .select('*')
        .eq('student_id', studentId!)
        .eq('semester_id', semesterId)
        .eq('class_id', classId)
        .maybeSingle();
      return data as TerminalReport | null;
    },
  });

  // Populate remarks and conduct if report already exists
  useEffect(() => {
    if (existingReport.data) {
      const rep = existingReport.data;
      setConduct(rep.conduct ?? '');
      setAttitude(rep.attitude ?? '');
      setInterest(rep.interest ?? '');
      setTeacherRemarks(rep.class_teacher_remarks ?? '');
      setHeadmasterRemarks(rep.headmaster_remarks ?? '');
      setPromotionRec(rep.promotion_recommendation ?? '');
      setNextTermBegins(rep.next_term_begins ?? '');
    } else {
      setNextTermBegins(gradingConfig.data?.next_term_begins ?? '');
    }
  }, [existingReport.data, gradingConfig.data]);

  const results = resultsQuery.data ?? [];
  const totalScore = Math.round(results.reduce((s, r) => s + Number(r.total || 0), 0) * 100) / 100;
  const countWithScores = results.filter((r) => r.percentage !== null).length;
  const averagePercentage = countWithScores > 0 ? Math.round((totalScore / countWithScores) * 100) / 100 : null;
  const overallGrade = gradeFor(averagePercentage, gradeBands.data?.bands ?? []);
  const incompleteCount = results.filter((r) => r.scores_entered < r.assessments_count).length;

  const saveReportMutation = useMutation({
    mutationFn: async (publish: boolean) => {
      if (!currentSemester?.academic_year_id || !classId) {
        throw new Error('Missing semester or class details');
      }

      const payload = {
        school_id: schoolId,
        student_id: studentId,
        academic_year_id: currentSemester.academic_year_id,
        semester_id: semesterId,
        class_id: classId,
        status: publish ? 'published' : 'draft',
        total_score: totalScore,
        average_score: averagePercentage ?? 0,
        overall_grade: overallGrade?.grade ?? null,
        subjects_count: results.length,
        incomplete_subjects: incompleteCount,
        attendance_present: attendanceQuery.data?.present ?? 0,
        attendance_absent: attendanceQuery.data?.absent ?? 0,
        attendance_total: attendanceQuery.data?.days_marked ?? 0,
        conduct: conduct || null,
        attitude: attitude || null,
        interest: interest || null,
        class_teacher_remarks: teacherRemarks || null,
        headmaster_remarks: headmasterRemarks || null,
        promotion_recommendation: promotionRec || null,
        next_term_begins: nextTermBegins || null,
        snapshot_data: {
          generated_at: new Date().toISOString(),
          school_name: schoolQuery.data?.name,
          student_name: `${student?.first_name} ${student?.last_name}`,
          admission_number: student?.admission_number,
          results,
          overall_grade: overallGrade?.grade,
          average: averagePercentage,
          total: totalScore,
        },
        published_at: publish ? new Date().toISOString() : null,
      };

      const { error } = await supabase
        .from('terminal_reports')
        .upsert(payload, { onConflict: 'student_id, semester_id, class_id' });
      if (error) throw error;
    },
    onSuccess: (_, publish) => {
      toast(publish ? 'Report approved and published!' : 'Report remarks saved as draft');
      qc.invalidateQueries({ queryKey: ['terminal_report', studentId] });
    },
    onError: (err) => {
      toast(friendlyError(err), 'error');
    },
  });

  if (studentQuery.isLoading || resultsQuery.isLoading || schoolQuery.isLoading) {
    return <Spinner />;
  }

  if (studentQuery.error || !student) {
    return (
      <ErrorBox
        error={studentQuery.error ?? new Error('Student not found')}
      />
    );
  }

  const school = schoolQuery.data;
  const att = attendanceQuery.data;
  const isPublished = existingReport.data?.status === 'published';

  return (
    <>
      <div className="no-print">
        <PageHeader
          back={<Link to={`/school/consolidated?class=${classId}&semester=${semesterId}`}>← Back to Consolidated</Link>}
          title={`Terminal Report: ${student.first_name} ${student.last_name}`}
          subtitle={`${classLabel(studentClass)} · ${semesterLabel(currentSemester)}`}
          actions={
            <>
              <Button size="sm" variant="secondary" onClick={() => window.print()}>
                🖨️ Print Report
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => saveReportMutation.mutate(false)}
                loading={saveReportMutation.isPending}
              >
                Save Draft
              </Button>
              <Button
                size="sm"
                onClick={() => saveReportMutation.mutate(true)}
                loading={saveReportMutation.isPending}
              >
                {isPublished ? 'Update & Re-Publish' : 'Approve & Publish'}
              </Button>
            </>
          }
        />

        {incompleteCount > 0 && (
          <div style={{ marginBottom: 16 }}>
            <Alert tone="warn">
              This student has {incompleteCount} subject{incompleteCount > 1 ? 's' : ''} with incomplete marks. This report is currently marked as <strong>Provisional</strong>.
            </Alert>
          </div>
        )}

        {isPublished && (
          <div style={{ marginBottom: 16 }}>
            <Alert tone="success">
              This terminal report is <strong>Published</strong>. An official historical snapshot has been captured.
            </Alert>
          </div>
        )}
      </div>

      {/* PRINT-READY A4 REPORT CARD */}
      <div className="terminal-report-container" style={{ margin: '0 auto', maxWidth: 860, background: '#fff', padding: 24, borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', border: '1px solid var(--line)' }}>
        
        {/* School Header */}
        <div style={{ textAlign: 'center', borderBottom: '2px solid var(--green-800)', paddingBottom: 12, marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, marginBottom: 4 }}>
            {school?.logo_url ? (
              <img
                src={school.logo_url}
                alt={school.name}
                width="64"
                height="64"
                style={{ objectFit: 'contain', maxHeight: 64, maxWidth: 64 }}
              />
            ) : (
              <img src="/favicon.svg" alt="" width="48" height="48" />
            )}
            <div>
              <h1 style={{ fontSize: '1.45rem', textTransform: 'uppercase', color: 'var(--green-900)', margin: 0 }}>
                {school?.name || 'School Management System'}
              </h1>
              {school?.motto && (
                <div style={{ fontStyle: 'italic', color: 'var(--muted)', fontSize: '0.9rem' }}>
                  "{school.motto}"
                </div>
              )}
            </div>
          </div>
          <div className="small muted">
            {school?.address && <span>{school.address} · </span>}
            {school?.phone && <span>Tel: {school.phone} · </span>}
            {school?.email && <span>Email: {school.email}</span>}
          </div>
          <div style={{ marginTop: 8, fontWeight: 700, fontSize: '1.1rem', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            STUDENT'S TERMINAL REPORT
          </div>
          <div style={{ fontSize: '0.9rem', color: 'var(--ink-2)' }}>
            {semesterLabel(currentSemester)} · Generated on {formatDate(todayISO())}
          </div>
        </div>

        {/* Student Bio Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '8px 24px', background: 'var(--bg)', padding: '12px 16px', borderRadius: 8, marginBottom: 16, fontSize: '0.9rem' }}>
          <div><strong>Student Name:</strong> {student.last_name}, {student.first_name} {student.other_names ?? ''}</div>
          <div><strong>Admission No:</strong> <span className="mono">{student.admission_number}</span></div>
          <div><strong>Class:</strong> {classLabel(studentClass)}</div>
          <div><strong>Gender:</strong> {student.gender ? student.gender.toUpperCase() : '—'}</div>
          <div><strong>Attendance:</strong> {att ? `${att.present} / ${att.days_marked} days (${att.rate ?? 0}%)` : '—'}</div>
          <div><strong>Status:</strong> {incompleteCount > 0 ? <span style={{ color: 'var(--amber)', fontWeight: 600 }}>Provisional</span> : <span style={{ color: 'var(--green-700)', fontWeight: 600 }}>Final</span>}</div>
        </div>

        {/* Academic Performance Table */}
        <div style={{ marginBottom: 16 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
            <thead>
              <tr style={{ background: 'var(--green-800)', color: '#fff' }}>
                <th style={{ padding: '8px 10px', textAlign: 'left' }}>Subject</th>
                <th style={{ padding: '8px 10px', textAlign: 'right', width: 80 }}>Total (100)</th>
                <th style={{ padding: '8px 10px', textAlign: 'center', width: 65 }}>Grade</th>
                <th style={{ padding: '8px 10px', textAlign: 'left', minWidth: 140 }}>Remarks</th>
              </tr>
            </thead>
            <tbody>
              {results.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ textAlign: 'center', padding: 16, color: 'var(--muted)' }}>
                    No subject results recorded yet for this semester.
                  </td>
                </tr>
              ) : (
                results.map((res, i) => (
                  <tr key={res.subject_id} style={{ borderBottom: '1px solid var(--line)', background: i % 2 === 0 ? '#fff' : '#fcfcfc' }}>
                    <td style={{ padding: '8px 10px', fontWeight: 600 }}>{res.subject_name}</td>
                    <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                      {res.total !== null ? Number(res.total).toFixed(1) : '—'}
                    </td>
                    <td style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 700 }}>
                      {res.grade ?? '—'}
                    </td>
                    <td style={{ padding: '8px 10px', fontSize: '0.85rem' }}>
                      {res.remark ?? (res.scores_entered < res.assessments_count ? 'Incomplete' : 'Good effort')}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Overall Summary Stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, border: '1px solid var(--line)', borderRadius: 8, padding: 12, marginBottom: 16, textAlign: 'center' }}>
          <div>
            <div className="small muted">Total Score</div>
            <strong style={{ fontSize: '1.15rem' }}>{totalScore}</strong>
          </div>
          <div>
            <div className="small muted">Term Average</div>
            <strong style={{ fontSize: '1.15rem' }}>{averagePercentage !== null ? `${averagePercentage}%` : '—'}</strong>
          </div>
          <div>
            <div className="small muted">Overall Grade</div>
            <strong style={{ fontSize: '1.15rem', color: 'var(--green-700)' }}>{overallGrade?.grade ?? '—'}</strong>
          </div>
          <div>
            <div className="small muted">Class Position</div>
            <strong style={{ fontSize: '1.15rem' }}>
              {existingReport.data?.position ? `#${existingReport.data.position}` : '—'}
            </strong>
          </div>
        </div>

        {/* Character & Attitude Section */}
        <div style={{ marginBottom: 16 }}>
          <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: 8, color: 'var(--ink)' }}>
            Conduct & Personality Assessment
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            <Input label="Conduct" value={conduct} onChange={(e) => setConduct(e.target.value)} placeholder="e.g. Respectful and obedient" />
            <Input label="Attitude" value={attitude} onChange={(e) => setAttitude(e.target.value)} placeholder="e.g. Attentive in class" />
            <Input label="Interest" value={interest} onChange={(e) => setInterest(e.target.value)} placeholder="e.g. Sports & ICT" />
          </div>
        </div>

        {/* Remarks Section */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12, marginBottom: 16 }}>
          <Textarea
            label="Class Teacher's Remarks"
            value={teacherRemarks}
            onChange={(e) => setTeacherRemarks(e.target.value)}
            placeholder="Enter comprehensive evaluation of the student's academic and social progress..."
            rows={2}
          />
          <Textarea
            label="Headmaster's Remarks"
            value={headmasterRemarks}
            onChange={(e) => setHeadmasterRemarks(e.target.value)}
            placeholder="Headmaster's concluding remarks and recommendations..."
            rows={2}
          />
        </div>

        {/* Next Term / Promotion Section */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16, background: '#f8fafc', padding: 12, borderRadius: 8, marginBottom: 20 }}>
          <Input label="Next Term Begins" type="date" value={nextTermBegins} onChange={(e) => setNextTermBegins(e.target.value)} />
          <Select label="Promotion / Decision" value={promotionRec} onChange={(e) => setPromotionRec(e.target.value)}>
            <option value="">Not Applicable (Term Report)</option>
            <option value="promoted">Promoted to Next Class</option>
            <option value="promoted_on_probation">Promoted on Probation</option>
            <option value="repeat">Repeat Current Class</option>
            <option value="graduated">Graduated</option>
          </Select>
        </div>

        {/* Signatures and Stamp */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 32, paddingTop: 16, borderTop: '1px dashed var(--line)' }}>
          <div style={{ textAlign: 'center', width: 200 }}>
            <div style={{ borderBottom: '1px solid #444', height: 36, marginBottom: 4 }}></div>
            <div style={{ fontSize: '0.8rem', fontWeight: 600 }}>Class Teacher's Signature</div>
          </div>

          <div style={{ textAlign: 'center', width: 140, height: 75, border: '2px dashed #bbb', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ fontSize: '0.75rem', color: 'var(--muted)', textTransform: 'uppercase' }}>Official School Stamp</span>
          </div>

          <div style={{ textAlign: 'center', width: 200 }}>
            <div style={{ borderBottom: '1px solid #444', height: 36, marginBottom: 4 }}></div>
            <div style={{ fontSize: '0.8rem', fontWeight: 600 }}>Headmaster's Signature</div>
          </div>
        </div>

      </div>
    </>
  );
}
