import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useSchool, useAuth } from '../../lib/auth';
import { unwrap } from '../../lib/queries';
import { formatDate, todayISO } from '../../lib/format';
import { Alert, Badge, Card, EmptyState, ErrorBox, PageHeader, ProgressBar, Spinner } from '../../components/ui';

interface TeacherDash {
  current_semester_id: string | null; current_semester: string | null;
  classes: { class_id: string; class_name: string; is_class_teacher: boolean; students: number; attendance_status: string; subjects: { subject_id: string; subject_name: string }[] }[];
  grade_tasks: { class_id: string; class_name: string; subject_id: string; subject_name: string; assessments: number; weight_total: number; scores_entered: number; scores_expected: number }[];
}

export default function TeacherDashboard() {
  const { schoolId, schoolName } = useSchool();
  const { ctx } = useAuth();
  const today = todayISO();
  const q = useQuery({
    queryKey: ['teacher_dashboard', schoolId, today],
    queryFn: () => unwrap<TeacherDash>(supabase.rpc('teacher_dashboard', { p_school_id: schoolId, p_date: today })),
  });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const pendingAttendance = d.classes.filter((c) => c.attendance_status !== 'submitted');

  return (
    <>
      <PageHeader title={`Good day, ${ctx?.profile?.full_name?.split(' ')[0] || 'teacher'}`} subtitle={`${schoolName} · ${formatDate(today)}${d.current_semester ? ` · ${d.current_semester}` : ''}`} />
      {!d.classes.length && <Alert tone="info">You have not been assigned to any classes yet. Your headmaster assigns classes and subjects.</Alert>}

      {d.classes.length > 0 && (
        <Card title="Today's attendance">
          {pendingAttendance.length === 0 ? <p>All your registers for today are submitted. ✔</p> : (
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
              {d.classes.map((c) => (
                <Link key={c.class_id} to={`/attendance/${c.class_id}?date=${today}`} className="class-card">
                  <div className="row-between"><h3>{c.class_name}</h3><Badge value={c.attendance_status} /></div>
                  <div className="meta">{c.students} students{c.is_class_teacher ? ' · class teacher' : ''}</div>
                  <div style={{ marginTop: 8 }} className="btn btn-primary btn-sm">{c.attendance_status === 'submitted' ? 'View register' : 'Take attendance'}</div>
                </Link>
              ))}
            </div>
          )}
        </Card>
      )}
      <div style={{ height: 16 }} />
      <Card title="Grade entry" padded={false}>
        {!d.current_semester_id ? <EmptyState title="No current semester" /> : !d.grade_tasks.length ? <EmptyState title="No subject assignments">You are not assigned to teach a subject yet.</EmptyState> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Class</th><th>Subject</th><th className="num">Assessments</th><th>Progress</th><th></th></tr></thead>
            <tbody>{d.grade_tasks.map((g) => (
              <tr key={g.class_id + g.subject_id}>
                <td>{g.class_name}</td><td>{g.subject_name}</td>
                <td className="num">{g.assessments} <span className="muted small">({Number(g.weight_total)}%)</span></td>
                <td style={{ minWidth: 150 }}><ProgressBar value={g.scores_entered} max={g.scores_expected} label={`${g.scores_entered}/${g.scores_expected}`} /></td>
                <td className="right"><Link className="btn btn-sm btn-primary" to={`/grades/${g.class_id}/${g.subject_id}`}>Enter grades</Link></td>
              </tr>))}
            </tbody>
          </table></div>
        )}
      </Card>
      <div style={{ height: 16 }} />
      <Card title="My classes">
        {!d.classes.length ? <EmptyState title="No classes" /> : (
          <ul className="list-plain">{d.classes.map((c) => (
            <li key={c.class_id} className="row-between">
              <div><Link to={`/teach/class/${c.class_id}`}><strong>{c.class_name}</strong></Link>
                <div className="muted small">{[c.is_class_teacher && 'Class teacher', ...c.subjects.map((s) => s.subject_name)].filter(Boolean).join(' · ')}</div></div>
              <span className="muted small">{c.students} students</span>
            </li>))}
          </ul>
        )}
      </Card>
    </>
  );
}
