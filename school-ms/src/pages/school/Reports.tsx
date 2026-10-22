import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useSchool } from '../../lib/auth';
import { semesterLabel, unwrap, useClasses, useSemesters, useSubjects } from '../../lib/queries';
import { classLabel, formatDate, todayISO } from '../../lib/format';
import { downloadCsv } from '../../lib/csv';
import { Button, Card, EmptyState, ErrorBox, PageHeader, Select, Spinner, Tabs } from '../../components/ui';

interface ResultRow {
  student_id: string; admission_number: string; student_name: string; total: number; weight_total: number;
  percentage: number | null; grade: string | null; remark: string | null; scores_entered: number; assessments_count: number;
}

export default function ReportsPage() {
  const [tab, setTab] = useState<'results' | 'enrolment'>('results');
  return (
    <>
      <PageHeader title="Reports" subtitle="Printable and exportable school reports. Attendance reports are under Attendance → Attendance report." />
      <Tabs tabs={[{ id: 'results', label: 'Class results' }, { id: 'enrolment', label: 'Enrolment summary' }]} value={tab} onChange={setTab} />
      {tab === 'results' ? <ClassResults /> : <Enrolment />}
    </>
  );
}

function ClassResults() {
  const { schoolId, schoolName } = useSchool();
  const semesters = useSemesters(schoolId);
  const classes = useClasses(schoolId);
  const subjects = useSubjects(schoolId);
  const [semesterId, setSemesterId] = useState('');
  const [classId, setClassId] = useState('');
  const [subjectId, setSubjectId] = useState('');
  const sem = semesters.data?.find((s) => s.id === semesterId) ?? semesters.data?.find((s) => s.is_current);
  const results = useQuery({
    queryKey: ['class_results', sem?.id, classId, subjectId],
    enabled: !!sem && !!classId && !!subjectId,
    queryFn: () => unwrap<ResultRow[]>(supabase.rpc('class_subject_results', { p_semester_id: sem!.id, p_class_id: classId, p_subject_id: subjectId })),
  });
  const rows = [...(results.data ?? [])].sort((a, b) => Number(b.total) - Number(a.total));
  const cls = classes.data?.find((c) => c.id === classId);
  const subj = subjects.data?.find((s) => s.id === subjectId);
  const avg = rows.length ? (rows.reduce((s, r) => s + Number(r.percentage ?? 0), 0) / rows.length).toFixed(1) : '—';

  return (
    <>
      <div className="filters">
        <Select label="Semester" value={sem?.id ?? ''} onChange={(e) => setSemesterId(e.target.value)}>
          {semesters.data?.map((s) => <option key={s.id} value={s.id}>{semesterLabel(s)}</option>)}
        </Select>
        <Select label="Class" value={classId} onChange={(e) => setClassId(e.target.value)}>
          <option value="">Choose class</option>{classes.data?.map((c) => <option key={c.id} value={c.id}>{classLabel(c)}</option>)}
        </Select>
        <Select label="Subject" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
          <option value="">Choose subject</option>{subjects.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
      </div>
      <div className="print-only"><h2>{schoolName}</h2><p>{subj?.name} · {classLabel(cls)} · {semesterLabel(sem)} · printed {formatDate(todayISO())}</p></div>
      <Card padded={false} title={cls && subj ? `${subj.name} · ${classLabel(cls)} · class average ${avg}%` : 'Class results'} actions={rows.length > 0 && <>
        <Button size="sm" variant="secondary" onClick={() => window.print()}>Print</Button>
        <Button size="sm" variant="secondary" onClick={() => downloadCsv(`results-${classLabel(cls)}-${subj?.name}.csv`, rows.map((r, i) => ({
          position: i + 1, admission_number: r.admission_number, student: r.student_name, total: r.total, out_of: r.weight_total,
          percentage: r.percentage ?? '', grade: r.grade ?? '', remark: r.remark ?? '' })))}>Export CSV</Button>
        <Link className="btn btn-sm btn-secondary" to={`/grades/${classId}/${subjectId}?semester=${sem?.id}`}>Open grade sheet</Link>
      </>}>
        <ErrorBox error={results.error} />
        {!classId || !subjectId ? <EmptyState title="Choose a class and subject" /> : results.isLoading ? <Spinner /> : !rows.length ? <EmptyState title="No results" /> : (
          <div className="table-wrap"><table>
            <thead><tr><th className="num">Pos.</th><th>Student</th><th className="num">Total</th><th className="num">%</th><th>Grade</th><th>Remark</th><th>Complete</th></tr></thead>
            <tbody>{rows.map((r, i) => (
              <tr key={r.student_id}>
                <td className="num">{i + 1}</td><td>{r.student_name} <span className="muted small mono">{r.admission_number}</span></td>
                <td className="num">{Number(r.total).toFixed(1)} / {Number(r.weight_total)}</td><td className="num">{r.percentage ?? '—'}</td>
                <td><strong>{r.grade ?? '—'}</strong></td><td>{r.remark ?? ''}</td>
                <td className="small muted">{r.scores_entered}/{r.assessments_count}</td>
              </tr>))}
            </tbody>
          </table></div>
        )}
      </Card>
    </>
  );
}

function Enrolment() {
  const { schoolId, schoolName } = useSchool();
  const classes = useClasses(schoolId);
  const counts = useQuery({
    queryKey: ['enrolment_summary', schoolId],
    queryFn: () => unwrap<{ current_class_id: string | null; gender: string | null; enrollment_status: string }[]>(
      supabase.from('students').select('current_class_id, gender, enrollment_status').eq('school_id', schoolId).eq('enrollment_status', 'active').limit(10000)),
  });
  const rows = (classes.data ?? []).map((c) => {
    const s = (counts.data ?? []).filter((x) => x.current_class_id === c.id);
    return { class: classLabel(c), female: s.filter((x) => x.gender === 'female').length, male: s.filter((x) => x.gender === 'male').length,
      unspecified: s.filter((x) => !x.gender).length, total: s.length, capacity: c.capacity ?? '' };
  });
  const total = rows.reduce((s, r) => s + r.total, 0);
  return (
    <>
      <div className="print-only"><h2>{schoolName}</h2><p>Enrolment summary · {formatDate(todayISO())}</p></div>
      <Card padded={false} title={`Active enrolment · ${total} students`} actions={<>
        <Button size="sm" variant="secondary" onClick={() => window.print()}>Print</Button>
        <Button size="sm" variant="secondary" onClick={() => downloadCsv('enrolment-summary.csv', rows)}>Export CSV</Button>
      </>}>
        <ErrorBox error={counts.error} />
        {counts.isLoading ? <Spinner /> : !rows.length ? <EmptyState title="No classes" /> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Class</th><th className="num">Female</th><th className="num">Male</th><th className="num">Not specified</th><th className="num">Total</th><th className="num">Capacity</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.class}><td>{r.class}</td><td className="num">{r.female}</td><td className="num">{r.male}</td><td className="num">{r.unspecified}</td><td className="num"><strong>{r.total}</strong></td><td className="num">{r.capacity || '—'}</td></tr>))}
            </tbody>
          </table></div>
        )}
      </Card>
    </>
  );
}
