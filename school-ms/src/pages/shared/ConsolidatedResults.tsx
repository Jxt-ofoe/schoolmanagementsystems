import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { semesterLabel, unwrap, useClasses, useGradeBands, useGradingConfig, useSemesters, useSubjects } from '../../lib/queries';
import { classLabel } from '../../lib/format';
import { computePositions, formatPosition, gradeFor } from '../../lib/grades';
import { downloadCsv } from '../../lib/csv';
import { useToast } from '../../lib/toast';
import { friendlyError } from '../../lib/errors';
import type { ConsolidatedStudentRow, Examination } from '../../lib/types';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  SearchBox,
  Select,
  Spinner,
} from '../../components/ui';

interface SubjectCol {
  id: string;
  name: string;
}

interface StudentGridRow extends ConsolidatedStudentRow {
  overall_total: number;
  overall_average: number | null;
  overall_grade: string | null;
  position: number | null;
  is_incomplete: boolean;
}

export default function ConsolidatedResultsPage({ defaultRole: _defaultRole }: { defaultRole?: 'headmaster' | 'teacher' } = {}) {
  const { active } = useAuth();
  const schoolId = active?.school_id;
  const qc = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();

  const semesters = useSemesters(schoolId);
  const classes = useClasses(schoolId);
  const allSubjects = useSubjects(schoolId);
  const gradeBands = useGradeBands(schoolId);
  const gradingConfig = useGradingConfig(schoolId);

  const semesterId = params.get('semester') || semesters.data?.find((s) => s.is_current)?.id || '';
  const classId = params.get('class') || '';
  const examId = params.get('exam') || '';
  const [searchTerm, setSearchTerm] = useState('');
  const [rankCriteria, setRankCriteria] = useState<'total' | 'average'>('total');
  const [sortBy, setSortBy] = useState<'position' | 'total' | 'average' | 'name'>('position');

  const activeSemester = semesters.data?.find((s) => s.id === semesterId);

  // Available examinations for current semester
  const examinations = useQuery({
    queryKey: ['examinations_for_results', schoolId, semesterId],
    enabled: !!semesterId,
    queryFn: () =>
      unwrap<Examination[]>(
        supabase
          .from('examinations')
          .select('*')
          .eq('school_id', schoolId!)
          .eq('semester_id', semesterId)
          .order('created_at', { ascending: false })
      ),
  });

  // Fetch teacher assignments for this class to get all taught subjects
  const classSubjects = useQuery({
    queryKey: ['class_subjects_consolidated', classId],
    enabled: !!classId,
    queryFn: async () => {
      const rows = await unwrap<{ subject_id: string; subjects: { id: string; name: string } | null }[]>(
        supabase
          .from('teacher_assignments')
          .select('subject_id, subjects(id, name)')
          .eq('class_id', classId)
          .not('subject_id', 'is', null)
      );
      const unique = new Map<string, string>();
      for (const r of rows) {
        if (r.subjects) unique.set(r.subjects.id, r.subjects.name);
      }
      return Array.from(unique.entries()).map(([id, name]) => ({ id, name }));
    },
  });

  // Fetch students of this class
  const classStudents = useQuery({
    queryKey: ['class_students_consolidated', classId],
    enabled: !!classId,
    queryFn: () =>
      unwrap<{ id: string; first_name: string; last_name: string; admission_number: string }[]>(
        supabase
          .from('students')
          .select('id, first_name, last_name, admission_number')
          .eq('current_class_id', classId)
          .eq('enrollment_status', 'active')
          .order('last_name')
          .order('first_name')
      ),
  });

  // Fetch subject scores for all students and subjects in this class
  const subjectScores = useQuery({
    queryKey: ['consolidated_scores', classId, semesterId, examId],
    enabled: !!classId && !!semesterId,
    queryFn: async () => {
      let q = supabase
        .from('assessments')
        .select('id, subject_id, max_score, weight, scores(student_id, score, status)')
        .eq('class_id', classId)
        .eq('semester_id', semesterId);

      if (examId) {
        q = q.eq('examination_id', examId);
      }

      return unwrap<
        {
          id: string;
          subject_id: string;
          max_score: number;
          weight: number;
          scores: { student_id: string; score: number | null; status: string }[];
        }[]
      >(q);
    },
  });

  // Fetch subject submission statuses
  const submissions = useQuery({
    queryKey: ['subject_submissions_class', classId, semesterId, examId],
    enabled: !!classId && !!semesterId,
    queryFn: () =>
      unwrap<
        {
          subject_id: string;
          status: string;
          feedback: string | null;
          submitted_at: string | null;
        }[]
      >(
        supabase
          .from('subject_result_submissions')
          .select('subject_id, status, feedback, submitted_at')
          .eq('class_id', classId)
          .eq('semester_id', semesterId)
      ),
  });

  const subjectsList: SubjectCol[] = useMemo(() => {
    if (classSubjects.data && classSubjects.data.length > 0) {
      return classSubjects.data;
    }
    // Fallback to all subjects if none assigned yet
    return (allSubjects.data ?? []).map((s) => ({ id: s.id, name: s.name }));
  }, [classSubjects.data, allSubjects.data]);

  // Compute consolidated grid
  const gridRows: StudentGridRow[] = useMemo(() => {
    const students = classStudents.data ?? [];
    const assessments = subjectScores.data ?? [];
    const bands = gradeBands.data?.bands ?? [];

    if (!students.length) return [];

    const computed = students.map((stu) => {
      let totalAccumulator = 0;
      let subjectsCounted = 0;
      let hasMissing = false;

      const subResults = subjectsList.map((subj) => {
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
        const percentage = subjWeight > 0 ? Math.round((subjTotal * 100) / subjWeight * 100) / 100 : null;
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
          grade: band?.grade ?? null,
          remark: band?.remark ?? null,
          scores_entered: enteredCount,
          assessments_count: subjAssessments.length,
        };
      });

      const average = subjectsCounted > 0 ? Math.round((totalAccumulator / subjectsCounted) * 100) / 100 : null;
      const overallBand = gradeFor(average, bands);

      return {
        student_id: stu.id,
        admission_number: stu.admission_number,
        student_name: `${stu.last_name}, ${stu.first_name}`,
        subject_results: subResults,
        overall_total: Math.round(totalAccumulator * 100) / 100,
        overall_average: average,
        overall_grade: overallBand?.grade ?? null,
        position: null,
        is_incomplete: hasMissing || subjectsCounted < subjectsList.length,
      };
    });

    // Compute positions based on overall performance (1st position goes to the person with highest score)
    const rankable = computed.map((c) => {
      const hasAnyScore = c.subject_results.some((s) => s.percentage !== null) || c.overall_total > 0;
      const scoreValue = rankCriteria === 'total' ? c.overall_total : c.overall_average;
      return {
        ...c,
        id: c.student_id,
        score: hasAnyScore ? scoreValue : null,
      };
    });
    const tiePolicy = gradingConfig.data?.tie_ranking_policy || 'dense';
    const ranked = computePositions(rankable, tiePolicy);

    return computed.map((c) => {
      const match = ranked.find((r) => r.id === c.student_id);
      return {
        ...c,
        position: match?.position ?? null,
      };
    });
  }, [classStudents.data, subjectScores.data, subjectsList, gradeBands.data, rankCriteria, gradingConfig.data]);

  const sortedRows = useMemo(() => {
    let list = [...gridRows];
    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      list = list.filter(
        (r) =>
          r.student_name.toLowerCase().includes(q) ||
          r.admission_number.toLowerCase().includes(q)
      );
    }

    if (sortBy === 'name') {
      list.sort((a, b) => a.student_name.localeCompare(b.student_name));
    } else if (sortBy === 'total') {
      list.sort((a, b) => (b.overall_total ?? 0) - (a.overall_total ?? 0));
    } else if (sortBy === 'average') {
      list.sort((a, b) => (b.overall_average ?? 0) - (a.overall_average ?? 0));
    } else {
      list.sort((a, b) => (a.position ?? 9999) - (b.position ?? 9999));
    }
    return list;
  }, [gridRows, searchTerm, sortBy]);

  const selectedClass = classes.data?.find((c) => c.id === classId);
  const selectedExam = examinations.data?.find((e) => e.id === examId);

  const savePositionsMutation = useMutation({
    mutationFn: async () => {
      if (!schoolId || !classId || !semesterId || !activeSemester?.academic_year_id) {
        throw new Error('Please select class and semester');
      }
      if (!sortedRows.length) {
        throw new Error('No student results available to save');
      }

      const payload = sortedRows.map((r) => ({
        school_id: schoolId,
        student_id: r.student_id,
        academic_year_id: activeSemester.academic_year_id,
        semester_id: semesterId,
        class_id: classId,
        examination_id: examId || null,
        total_score: r.overall_total,
        average_score: r.overall_average ?? 0,
        overall_grade: r.overall_grade,
        position: r.position,
        total_students: sortedRows.length,
        subjects_count: r.subject_results.length,
        incomplete_subjects: r.subject_results.filter((s) => s.scores_entered < s.assessments_count).length,
        status: 'draft',
      }));

      const { error } = await supabase
        .from('terminal_reports')
        .upsert(payload, { onConflict: 'student_id, semester_id, class_id' });
      if (error) throw error;
      return payload.length;
    },
    onSuccess: (count) => {
      toast(`Saved positions for ${count} students to Terminal Reports!`);
      qc.invalidateQueries({ queryKey: ['terminal_report'] });
      qc.invalidateQueries({ queryKey: ['batch_saved_reports'] });
    },
    onError: (err) => {
      toast(friendlyError(err), 'error');
    },
  });

  const exportConsolidatedCsv = () => {
    if (!selectedClass || !sortedRows.length) return;
    const data = sortedRows.map((r) => {
      const row: Record<string, unknown> = {
        Position: r.position ? formatPosition(r.position) : '—',
        'Admission No': r.admission_number,
        'Student Name': r.student_name,
      };
      for (const sub of r.subject_results) {
        row[`${sub.subject_name} Total`] = sub.total;
        row[`${sub.subject_name} Grade`] = sub.grade ?? '—';
      }
      row['Overall Total'] = r.overall_total;
      row['Overall Average (%)'] = r.overall_average ?? '—';
      row['Overall Grade'] = r.overall_grade ?? '—';
      row['Status'] = r.is_incomplete ? 'Provisional (Incomplete)' : 'Complete';
      return row;
    });

    downloadCsv(
      `consolidated-results-${classLabel(selectedClass)}-${selectedExam?.name ?? activeSemester?.name ?? ''}.csv`,
      data
    );
  };

  const isClassTeacher = active?.role === 'teacher';

  return (
    <>
      <PageHeader
        title="Consolidated Results"
        subtitle={`Class teacher overview of all student marks across every subject.${isClassTeacher ? ' (Class Teacher Mode)' : ''}`}
        actions={
          sortedRows.length > 0 && (
            <>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => savePositionsMutation.mutate()}
                loading={savePositionsMutation.isPending}
                title="Save computed positions to Terminal Reports for all students"
              >
                💾 Save Positions to Reports
              </Button>
              <Button size="sm" variant="secondary" onClick={() => window.print()}>
                Print Class Sheet
              </Button>
              <Button size="sm" variant="secondary" onClick={exportConsolidatedCsv}>
                Export CSV
              </Button>
              <Link
                className="btn btn-sm btn-primary"
                to={`/school/reports/terminal?class=${classId}&semester=${semesterId}${examId ? `&exam=${examId}` : ''}`}
              >
                Batch Terminal Reports
              </Link>
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
          <option value="">Choose Class</option>
          {classes.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {classLabel(c)}
            </option>
          ))}
        </Select>

        <Select
          label="Examination"
          value={examId}
          onChange={(e) => {
            const next = new URLSearchParams(params);
            if (e.target.value) next.set('exam', e.target.value);
            else next.delete('exam');
            setParams(next);
          }}
        >
          <option value="">All Assessments / Cumulative</option>
          {examinations.data?.map((e) => (
            <option key={e.id} value={e.id}>
              {e.name} ({e.status})
            </option>
          ))}
        </Select>
      </div>

      {!classId ? (
        <Card>
          <EmptyState title="Select a class to view consolidated results">
            Choose an assigned class from the filter above to see every student and all subject results together.
          </EmptyState>
        </Card>
      ) : classStudents.isLoading || subjectScores.isLoading ? (
        <Card>
          <Spinner />
        </Card>
      ) : !sortedRows.length ? (
        <Card>
          <EmptyState title="No students or results found for this class">
            Students must be enrolled in this class and subject teachers must enter marks to display results.
          </EmptyState>
        </Card>
      ) : (
        <Card padded={false}>
          <div className="filters" style={{ padding: '12px 16px 0' }}>
            <SearchBox
              value={searchTerm}
              onChange={setSearchTerm}
              placeholder="Search by student name or admission number"
            />
            <Select
              label="Rank Basis"
              value={rankCriteria}
              onChange={(e) => setRankCriteria(e.target.value as 'total' | 'average')}
            >
              <option value="total">Overall Total Score (Highest Score = 1st)</option>
              <option value="average">Overall Average % (Highest Average = 1st)</option>
            </Select>
            <Select
              label="Sort by"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
            >
              <option value="position">Position / Rank (1st, 2nd, ...)</option>
              <option value="total">Highest Total Score</option>
              <option value="average">Highest Average %</option>
              <option value="name">Student Name (A-Z)</option>
            </Select>
          </div>

          {/* Submission status bar */}
          <div
            style={{
              display: 'flex',
              gap: 8,
              flexWrap: 'wrap',
              padding: '10px 16px',
              background: 'var(--green-50)',
              borderBottom: '1px solid var(--line)',
              fontSize: '0.85rem',
            }}
          >
            <strong>Subject Statuses:</strong>
            {subjectsList.map((s) => {
              const sub = submissions.data?.find((sub) => sub.subject_id === s.id);
              const status = sub?.status ?? 'draft';
              return (
                <span key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <span>{s.name}:</span>
                  <Badge
                    tone={
                      status === 'approved'
                        ? 'good'
                        : status === 'submitted'
                        ? 'info'
                        : status === 'returned'
                        ? 'danger'
                        : 'warn'
                    }
                  >
                    {status}
                  </Badge>
                </span>
              );
            })}
          </div>

          <div className="table-wrap" style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th className="num" style={{ width: 50 }}>
                    Pos.
                  </th>
                  <th style={{ minWidth: 180 }}>Student</th>
                  {subjectsList.map((sub) => (
                    <th key={sub.id} className="right" style={{ minWidth: 90 }}>
                      <div>{sub.name}</div>
                      <div className="muted small" style={{ fontWeight: 'normal' }}>
                        Score · Grd
                      </div>
                    </th>
                  ))}
                  <th className="right" style={{ minWidth: 80 }}>
                    Total
                  </th>
                  <th className="right" style={{ minWidth: 80 }}>
                    Average
                  </th>
                  <th style={{ minWidth: 60 }}>Grade</th>
                  <th style={{ minWidth: 100 }}>Status</th>
                  <th className="right" style={{ minWidth: 90 }}>
                    Report
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row) => (
                  <tr key={row.student_id}>
                    <td className="num">
                      {row.position ? (
                        <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                          {row.position === 1 && <span title="1st Place (Highest Score in Class)">🥇</span>}
                          {row.position === 2 && <span title="2nd Place">🥈</span>}
                          {row.position === 3 && <span title="3rd Place">🥉</span>}
                          <strong>{formatPosition(row.position)}</strong>
                        </div>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      <div>
                        <strong>{row.student_name}</strong>
                      </div>
                      <div className="mono muted small">{row.admission_number}</div>
                    </td>

                    {/* Subject cells */}
                    {row.subject_results.map((sub) => (
                      <td key={sub.subject_id} className="right">
                        {sub.percentage !== null ? (
                          <>
                            <span style={{ fontWeight: 600 }}>{sub.total}</span>
                            <span className="small muted" style={{ marginLeft: 4 }}>
                              ({sub.grade ?? '—'})
                            </span>
                          </>
                        ) : (
                          <span className="muted small">—</span>
                        )}
                      </td>
                    ))}

                    <td className="right">
                      <strong>{row.overall_total}</strong>
                    </td>
                    <td className="right">
                      <strong>{row.overall_average !== null ? `${row.overall_average}%` : '—'}</strong>
                    </td>
                    <td>
                      {row.overall_grade ? (
                        <Badge tone="good">{row.overall_grade}</Badge>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      {row.is_incomplete ? (
                        <Badge tone="warn">Provisional</Badge>
                      ) : (
                        <Badge tone="good">Complete</Badge>
                      )}
                    </td>
                    <td className="right">
                      <Link
                        className="btn btn-sm btn-secondary"
                        to={`/school/reports/terminal/${row.student_id}?semester=${semesterId}${examId ? `&exam=${examId}` : ''}&class=${classId}`}
                      >
                        Report
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
