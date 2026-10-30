import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { semesterLabel, unwrap, useClasses, useGradeBands, useGradingConfig, useSchoolDetails, useSemesters } from '../../lib/queries';
import { classLabel } from '../../lib/format';
import { computePositions, formatPosition, gradeFor } from '../../lib/grades';
import { useToast } from '../../lib/toast';
import { friendlyError } from '../../lib/errors';
import type { Student, SubjectRow } from '../../lib/types';
import {
  Button,
  Card,
  EmptyState,
  PageHeader,
  Select,
  Spinner,
} from '../../components/ui';

export default function BatchTerminalReportsPage() {
  const { active } = useAuth();
  const schoolId = active?.school_id;
  const qc = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();

  const semesters = useSemesters(schoolId);
  const classes = useClasses(schoolId);
  const gradeBands = useGradeBands(schoolId);
  const gradingConfig = useGradingConfig(schoolId);

  const semesterId = params.get('semester') || semesters.data?.find((s) => s.is_current)?.id || '';
  const classId = params.get('class') || '';

  const activeSemester = semesters.data?.find((s) => s.id === semesterId);
  const selectedClass = classes.data?.find((c) => c.id === classId);

  // School profile
  const schoolQuery = useSchoolDetails(schoolId);

  // Students in class
  const studentsQuery = useQuery({
    queryKey: ['batch_students', classId],
    enabled: !!classId,
    queryFn: () =>
      unwrap<Student[]>(
        supabase
          .from('students')
          .select('*')
          .eq('current_class_id', classId)
          .eq('enrollment_status', 'active')
          .order('last_name')
          .order('first_name')
      ),
  });

  // All subjects taught to class
  const classSubjects = useQuery({
    queryKey: ['batch_class_subjects', classId],
    enabled: !!classId,
    queryFn: async () => {
      const rows = await unwrap<{ subject_id: string; subjects: SubjectRow | null }[]>(
        supabase.from('teacher_assignments').select('subject_id, subjects(*)').eq('class_id', classId).not('subject_id', 'is', null)
      );
      const unique = new Map<string, SubjectRow>();
      for (const r of rows) {
        if (r.subjects) unique.set(r.subjects.id, r.subjects);
      }
      return Array.from(unique.values());
    },
  });

  // Assessments for this class and semester
  const assessmentsQuery = useQuery({
    queryKey: ['batch_assessments', classId, semesterId],
    enabled: !!classId && !!semesterId,
    queryFn: () =>
      unwrap<
        {
          id: string;
          subject_id: string;
          name: string;
          max_score: number;
          weight: number;
          scores: { student_id: string; score: number | null; status: string }[];
        }[]
      >(
        supabase
          .from('assessments')
          .select('id, subject_id, name, max_score, weight, scores(student_id, score, status)')
          .eq('class_id', classId)
          .eq('semester_id', semesterId)
      ),
  });

  // Saved terminal reports snapshots
  const savedReportsQuery = useQuery({
    queryKey: ['batch_saved_reports', classId, semesterId],
    enabled: !!classId && !!semesterId,
    queryFn: () =>
      unwrap<
        {
          student_id: string;
          status: string;
          conduct: string | null;
          attitude: string | null;
          interest: string | null;
          class_teacher_remarks: string | null;
          headmaster_remarks: string | null;
          position: number | null;
        }[]
      >(
        supabase
          .from('terminal_reports')
          .select('student_id, status, conduct, attitude, interest, class_teacher_remarks, headmaster_remarks, position')
          .eq('class_id', classId)
          .eq('semester_id', semesterId)
      ),
  });

  // Attendance for the semester
  const attendanceQuery = useQuery({
    queryKey: ['batch_attendance', classId, activeSemester?.starts_on, activeSemester?.ends_on],
    enabled: !!classId && !!activeSemester?.starts_on && !!activeSemester?.ends_on,
    queryFn: () =>
      unwrap<{ student_id: string; days_marked: number; present: number; absent: number; rate: number }[]>(
        supabase.rpc('attendance_report', {
          p_school_id: schoolId!,
          p_from: activeSemester!.starts_on,
          p_to: activeSemester!.ends_on,
          p_class_id: classId,
        })
      ),
  });

  const students = studentsQuery.data ?? [];
  const subjects = classSubjects.data ?? [];
  const assessments = assessmentsQuery.data ?? [];
  const bands = gradeBands.data?.bands ?? [];
  const school = schoolQuery.data;

  // Process reports for all students
  const studentReports = useMemo(() => {
    const preReports = students.map((stu) => {
      let totalAccumulator = 0;
      let subjectsCounted = 0;
      let hasMissing = false;

      const subResults = subjects.map((subj) => {
        const subjAssessments = assessments.filter((a) => a.subject_id === subj.id);
        let subjTotal = 0;
        let subjWeight = 0;
        let enteredCount = 0;

        for (const a of subjAssessments) {
          subjWeight += Number(a.weight);
          const s = a.scores.find((sc) => sc.student_id === stu.id);
          if (s && s.status !== 'missing' && s.score !== null) {
            enteredCount += 1;
            if (s.status !== 'absent') {
              subjTotal += (Number(s.score) / Number(a.max_score)) * Number(a.weight);
            }
          } else {
            hasMissing = true;
          }
        }

        subjTotal = Math.round(subjTotal * 100) / 100;
        const percentage = subjWeight > 0 ? Math.round(((subjTotal * 100) / subjWeight) * 100) / 100 : null;
        const band = gradeFor(percentage, bands);

        if (subjAssessments.length > 0) {
          totalAccumulator += subjTotal;
          subjectsCounted += 1;
        }

        return {
          subject_id: subj.id,
          subject_name: subj.name,
          total: subjTotal,
          percentage,
          grade: band?.grade ?? '—',
          remark: band?.remark ?? (enteredCount < subjAssessments.length ? 'Incomplete' : 'Satisfactory'),
        };
      });

      const average = subjectsCounted > 0 ? Math.round((totalAccumulator / subjectsCounted) * 100) / 100 : null;
      const overallGrade = gradeFor(average, bands);
      const saved = savedReportsQuery.data?.find((r) => r.student_id === stu.id);
      const att = attendanceQuery.data?.find((a) => a.student_id === stu.id);

      return {
        student: stu,
        results: subResults,
        total: Math.round(totalAccumulator * 100) / 100,
        average,
        overallGrade: overallGrade?.grade ?? '—',
        saved,
        isProvisional: hasMissing,
        hasScores: subjectsCounted > 0 && totalAccumulator > 0,
        conduct: saved?.conduct ?? 'Satisfactory',
        attitude: saved?.attitude ?? 'Attentive',
        interest: saved?.interest ?? 'General Studies',
        classTeacherRemarks: saved?.class_teacher_remarks ?? 'Shows good effort and participation.',
        headmasterRemarks: saved?.headmaster_remarks ?? 'Promising performance. Keep aiming higher.',
        attendance: att,
      };
    });

    // Rank students by overall performance (1st position goes to the student who had highest score in the class)
    const rankable = preReports.map((r) => {
      const hasAnyScore = r.results.some((s) => s.percentage !== null) || r.hasScores;
      return {
        id: r.student.id,
        score: hasAnyScore ? r.total : null,
      };
    });
    const tiePolicy = gradingConfig.data?.tie_ranking_policy || 'dense';
    const ranked = computePositions(rankable, tiePolicy);

    return preReports.map((r) => {
      const match = ranked.find((rk) => rk.id === r.student.id);
      const computedPos = match?.position ?? null;
      const position = r.saved?.position ?? computedPos;

      return {
        ...r,
        position,
      };
    });
  }, [students, subjects, assessments, bands, savedReportsQuery.data, attendanceQuery.data, gradingConfig.data]);

  const saveAllMutation = useMutation({
    mutationFn: async () => {
      if (!schoolId || !classId || !semesterId || !activeSemester?.academic_year_id) {
        throw new Error('Please select class and semester');
      }
      if (!studentReports.length) {
        throw new Error('No reports available to save');
      }

      const payload = studentReports.map((r) => ({
        school_id: schoolId,
        student_id: r.student.id,
        academic_year_id: activeSemester.academic_year_id,
        semester_id: semesterId,
        class_id: classId,
        total_score: r.total,
        average_score: r.average ?? 0,
        overall_grade: r.overallGrade === '—' ? null : r.overallGrade,
        position: r.position,
        total_students: students.length,
        subjects_count: r.results.length,
        incomplete_subjects: r.results.filter((s) => s.remark === 'Incomplete').length,
        attendance_present: r.attendance?.present ?? 0,
        attendance_absent: r.attendance?.absent ?? 0,
        attendance_total: r.attendance?.days_marked ?? 0,
        conduct: r.conduct || null,
        attitude: r.attitude || null,
        interest: r.interest || null,
        class_teacher_remarks: r.classTeacherRemarks || null,
        headmaster_remarks: r.headmasterRemarks || null,
        status: 'draft',
      }));

      const { error } = await supabase
        .from('terminal_reports')
        .upsert(payload, { onConflict: 'student_id, semester_id, class_id' });
      if (error) throw error;
      return payload.length;
    },
    onSuccess: (count) => {
      toast(`Successfully saved positions and report remarks for ${count} students!`);
      qc.invalidateQueries({ queryKey: ['batch_saved_reports'] });
      qc.invalidateQueries({ queryKey: ['terminal_report'] });
    },
    onError: (err) => {
      toast(friendlyError(err), 'error');
    },
  });

  return (
    <>
      <div className="no-print">
        <PageHeader
          back={<Link to={`/school/consolidated?class=${classId}&semester=${semesterId}`}>← Back to Consolidated</Link>}
          title="Batch Terminal Reports"
          subtitle={`Generate and print reports for all students in ${classLabel(selectedClass)} · ${semesterLabel(activeSemester)}`}
          actions={
            studentReports.length > 0 && (
              <>
                <Button
                  variant="secondary"
                  onClick={() => saveAllMutation.mutate()}
                  loading={saveAllMutation.isPending}
                >
                  💾 Save Positions to Database
                </Button>
                <Button onClick={() => window.print()}>
                  🖨️ Print All ({studentReports.length} Reports)
                </Button>
              </>
            )
          }
        />

        <div className="filters">
          <Select
            label="Semester"
            value={semesterId}
            onChange={(e) => {
              const next = new URLSearchParams(params);
              next.set('semester', e.target.value);
              setParams(next);
            }}
          >
            {semesters.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {semesterLabel(s)}
              </option>
            ))}
          </Select>

          <Select
            label="Class"
            value={classId}
            onChange={(e) => {
              const next = new URLSearchParams(params);
              next.set('class', e.target.value);
              setParams(next);
            }}
          >
            <option value="">Select Class</option>
            {classes.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {classLabel(c)}
              </option>
            ))}
          </Select>
        </div>

        {!classId && (
          <Card>
            <EmptyState title="Choose a class to generate terminal reports" />
          </Card>
        )}
      </div>

      {classId && (
        <>
          {studentsQuery.isLoading || assessmentsQuery.isLoading ? (
            <div className="no-print">
              <Spinner />
            </div>
          ) : !studentReports.length ? (
            <div className="no-print">
              <Card>
                <EmptyState title="No students in this class" />
              </Card>
            </div>
          ) : (
            <div className="batch-reports-print-wrapper">
              {studentReports.map((report) => (
                <div
                  key={report.student.id}
                  className="terminal-report-page"
                  style={{
                    pageBreakAfter: 'always',
                    breakAfter: 'page',
                    maxWidth: 820,
                    margin: '0 auto 32px auto',
                    background: '#fff',
                    padding: 24,
                    border: '1px solid var(--line)',
                    borderRadius: 8,
                  }}
                >
                  {/* School Header */}
                  <div style={{ textAlign: 'center', borderBottom: '2px solid var(--green-800)', paddingBottom: 10, marginBottom: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
                      {school?.logo_url ? (
                        <img
                          src={school.logo_url}
                          alt={school.name}
                          width="52"
                          height="52"
                          style={{ objectFit: 'contain', maxHeight: 52, maxWidth: 52 }}
                        />
                      ) : (
                        <img src="/favicon.svg" alt="" width="40" height="40" />
                      )}
                      <div>
                        <h2 style={{ fontSize: '1.35rem', textTransform: 'uppercase', color: 'var(--green-900)', margin: 0 }}>
                          {school?.name || 'School Management System'}
                        </h2>
                        {school?.motto && (
                          <div style={{ fontStyle: 'italic', color: 'var(--muted)', fontSize: '0.82rem' }}>
                            "{school.motto}"
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="small muted">
                      {school?.address && <span>{school.address} · </span>}
                      {school?.phone && <span>Tel: {school.phone} · </span>}
                      {school?.email && <span>{school.email}</span>}
                    </div>
                    <div style={{ marginTop: 6, fontWeight: 700, fontSize: '1rem', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                      STUDENT'S TERMINAL REPORT
                    </div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--ink-2)' }}>
                      {semesterLabel(activeSemester)}
                    </div>
                  </div>

                  {/* Student Details */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '6px 16px', background: '#f8fafc', padding: '10px 14px', borderRadius: 6, marginBottom: 12, fontSize: '0.85rem' }}>
                    <div><strong>Student Name:</strong> {report.student.last_name}, {report.student.first_name}</div>
                    <div><strong>Admission No:</strong> <span className="mono">{report.student.admission_number}</span></div>
                    <div><strong>Class:</strong> {classLabel(selectedClass)}</div>
                    <div><strong>Attendance:</strong> {report.attendance ? `${report.attendance.present} / ${report.attendance.days_marked} days` : '—'}</div>
                  </div>

                  {/* Academic Table */}
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', marginBottom: 12 }}>
                    <thead>
                      <tr style={{ background: 'var(--green-800)', color: '#fff' }}>
                        <th style={{ padding: '6px 8px', textAlign: 'left' }}>Subject</th>
                        <th style={{ padding: '6px 8px', textAlign: 'right', width: 75 }}>Total (100)</th>
                        <th style={{ padding: '6px 8px', textAlign: 'center', width: 60 }}>Grade</th>
                        <th style={{ padding: '6px 8px', textAlign: 'left' }}>Remarks</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.results.map((sub, i) => (
                        <tr key={sub.subject_id} style={{ borderBottom: '1px solid var(--line)', background: i % 2 === 0 ? '#fff' : '#fbfbfb' }}>
                          <td style={{ padding: '6px 8px', fontWeight: 600 }}>{sub.subject_name}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'right' }}>{sub.total}</td>
                          <td style={{ padding: '6px 8px', textAlign: 'center', fontWeight: 700 }}>{sub.grade}</td>
                          <td style={{ padding: '6px 8px' }}>{sub.remark}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>

                  {/* Overall Summary Stats */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, border: '1px solid var(--line)', borderRadius: 6, padding: 8, marginBottom: 12, textAlign: 'center' }}>
                    <div>
                      <div className="small muted">Total Score</div>
                      <strong>{report.total}</strong>
                    </div>
                    <div>
                      <div className="small muted">Average</div>
                      <strong>{report.average !== null ? `${report.average}%` : '—'}</strong>
                    </div>
                    <div>
                      <div className="small muted">Overall Grade</div>
                      <strong style={{ color: 'var(--green-700)' }}>{report.overallGrade}</strong>
                    </div>
                    <div>
                      <div className="small muted">Class Position</div>
                      <strong style={{ fontSize: '1.05rem', color: report.position === 1 ? 'var(--green-800)' : 'var(--ink)' }}>
                        {report.position ? formatPosition(report.position, students.length) : '—'}
                        {report.position === 1 && ' 🏆'}
                      </strong>
                    </div>
                  </div>

                  {/* Remarks & Character */}
                  <div style={{ fontSize: '0.82rem', marginBottom: 14 }}>
                    <div style={{ marginBottom: 4 }}>
                      <strong>Conduct:</strong> {report.conduct} · <strong>Attitude:</strong> {report.attitude} · <strong>Interest:</strong> {report.interest}
                    </div>
                    <div style={{ marginBottom: 4 }}>
                      <strong>Class Teacher:</strong> {report.classTeacherRemarks}
                    </div>
                    <div>
                      <strong>Headmaster:</strong> {report.headmasterRemarks}
                    </div>
                  </div>

                  {/* Signatures */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 16, paddingTop: 10, borderTop: '1px dashed var(--line)' }}>
                    <div style={{ textAlign: 'center', width: 170 }}>
                      <div style={{ borderBottom: '1px solid #444', height: 26, marginBottom: 4 }}></div>
                      <div style={{ fontSize: '0.75rem', fontWeight: 600 }}>Class Teacher's Signature</div>
                    </div>

                    <div style={{ textAlign: 'center', width: 120, height: 60, border: '1px dashed #bbb', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <span style={{ fontSize: '0.7rem', color: 'var(--muted)', textTransform: 'uppercase' }}>Stamp</span>
                    </div>

                    <div style={{ textAlign: 'center', width: 170 }}>
                      <div style={{ borderBottom: '1px solid #444', height: 26, marginBottom: 4 }}></div>
                      <div style={{ fontSize: '0.75rem', fontWeight: 600 }}>Headmaster's Signature</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}
