import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useSchool } from '../../lib/auth';
import { unwrap } from '../../lib/queries';
import { formatDate, todayISO } from '../../lib/format';
import { Alert, Card, ErrorBox, PageHeader, ProgressBar, Spinner, StatCard } from '../../components/ui';

interface Dash {
  students_active: number; students_total: number; students_unplaced: number; teachers: number; classes: number; subjects: number;
  current_semester: { id: string; name: string; starts_on: string; ends_on: string } | null;
  registered_this_semester: number;
  attendance_today: { classes: number; submitted: number; draft: number; not_started: number };
  attendance_trend: { date: string; marked: number; rate: number | null }[];
  grade_entry: { assignments: number; with_assessments: number; scores_entered: number; scores_expected: number };
}

export default function SchoolDashboard() {
  const { schoolId, schoolName } = useSchool();
  const today = todayISO();
  const q = useQuery({
    queryKey: ['headmaster_dashboard', schoolId, today],
    queryFn: () => unwrap<Dash>(supabase.rpc('headmaster_dashboard', { p_school_id: schoolId, p_date: today })),
  });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const at = d.attendance_today;
  const ge = d.grade_entry;
  const unregistered = d.students_active - d.registered_this_semester;

  return (
    <>
      <PageHeader title={schoolName} subtitle={d.current_semester ? `${d.current_semester.name} · ${formatDate(d.current_semester.starts_on)} – ${formatDate(d.current_semester.ends_on)}` : 'No current semester'} />
      {!d.current_semester && <Alert tone="warn"><span>Set up an academic year and current semester to start registration, attendance and grading.</span><Link to="/school/academic">Academic calendar →</Link></Alert>}
      {d.classes === 0 && <Alert tone="info"><span>Start by creating your classes.</span><Link to="/school/classes">Create classes →</Link></Alert>}
      {d.current_semester && unregistered > 0 && <Alert tone="warn"><span>{unregistered} active students are not registered for this semester.</span><Link to="/school/academic">Register →</Link></Alert>}
      <div className="stats">
        <StatCard label="Active students" value={d.students_active} hint={d.students_unplaced ? `${d.students_unplaced} not placed in a class` : `${d.students_total} on record`} />
        <StatCard label="Teachers" value={d.teachers} />
        <StatCard label="Classes" value={d.classes} hint={`${d.subjects} subjects`} />
        <StatCard label="Registered this semester" value={d.registered_this_semester} />
      </div>
      <div className="grid-2">
        <Card title="Today's attendance" actions={<Link to="/school/attendance" className="small">Open attendance →</Link>}>
          <div className="stats" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
            <StatCard label="Submitted" value={at.submitted} tone="good" />
            <StatCard label="Draft" value={at.draft} tone={at.draft ? 'warn' : undefined} />
            <StatCard label="Not started" value={at.not_started} tone={at.not_started ? 'bad' : undefined} />
          </div>
          <ProgressBar value={at.submitted} max={at.classes} label={`${at.submitted} of ${at.classes} classes submitted`} />
        </Card>
        <Card title="Grade entry (current semester)" actions={<Link to="/school/grades" className="small">Open grades →</Link>}>
          <div className="kv"><span>Class–subject assignments</span><strong>{ge.assignments}</strong></div>
          <div className="kv"><span>With assessments set up</span><strong>{ge.with_assessments}</strong></div>
          <div className="kv"><span>Scores entered</span><strong>{ge.scores_entered} / {ge.scores_expected}</strong></div>
          <div style={{ marginTop: 10 }}><ProgressBar value={ge.scores_entered} max={ge.scores_expected} /></div>
        </Card>
      </div>
      <div style={{ height: 16 }} />
      <Card title="Attendance rate · last 14 days">
        <div className="trend" aria-label="Attendance trend">
          {d.attendance_trend.map((t) => (
            <div key={t.date} className={`trend-bar ${t.rate !== null ? 'has' : ''}`} style={{ height: `${t.rate ?? 2}%` }}
              title={`${formatDate(t.date)}: ${t.rate ?? '—'}% (${t.marked} marked)`} />
          ))}
        </div>
        <div className="trend-labels">{d.attendance_trend.map((t) => <span key={t.date}>{new Date(`${t.date}T00:00:00`).getDate()}</span>)}</div>
        <p className="muted small">Present + late as a share of students marked (excused excluded). Hover a bar for details.</p>
      </Card>
    </>
  );
}
