import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useSchool } from '../../lib/auth';
import { unwrap, useClasses } from '../../lib/queries';
import { addDays, classLabel, formatDate, formatDateTime, todayISO } from '../../lib/format';
import { downloadCsv } from '../../lib/csv';
import { Alert, Badge, Button, Card, EmptyState, ErrorBox, Input, PageHeader, SearchBox, Select, Spinner, StatCard, Tabs } from '../../components/ui';

interface OverviewRow {
  class_id: string; class_name: string; students: number; session_status: string; submitted_at: string | null; taken_by_name: string | null;
  present: number; absent: number; late: number; excused: number; marked: number;
}
interface ReportRow {
  student_id: string; admission_number: string; student_name: string; class_name: string; days_marked: number;
  present: number; absent: number; late: number; excused: number; attendance_rate: number | null;
}

export default function AttendanceOverviewPage() {
  const [tab, setTab] = useState<'daily' | 'report'>('daily');
  return (
    <>
      <PageHeader title="Attendance" subtitle="Monitor daily registers and attendance rates across the school" />
      <Tabs tabs={[{ id: 'daily', label: 'Daily status' }, { id: 'report', label: 'Attendance report' }]} value={tab} onChange={setTab} />
      {tab === 'daily' ? <Daily /> : <Report />}
    </>
  );
}

function Daily() {
  const { schoolId } = useSchool();
  const [date, setDate] = useState(todayISO());
  const overview = useQuery({
    queryKey: ['attendance_overview', schoolId, date],
    queryFn: () => unwrap<OverviewRow[]>(supabase.rpc('attendance_overview', { p_school_id: schoolId, p_date: date })),
  });
  const rows = overview.data ?? [];
  const submitted = rows.filter((r) => r.session_status === 'submitted').length;
  const pending = rows.filter((r) => r.session_status !== 'submitted');
  const marked = rows.reduce((s, r) => s + r.marked, 0);
  const attended = rows.reduce((s, r) => s + r.present + r.late, 0);
  const excused = rows.reduce((s, r) => s + r.excused, 0);
  const rate = marked - excused > 0 ? Math.round((1000 * attended) / (marked - excused)) / 10 : null;

  return (
    <>
      <div className="filters">
        <Input label="Date" type="date" value={date} max={todayISO()} onChange={(e) => e.target.value && setDate(e.target.value)} />
        <div className="row" style={{ paddingBottom: 2 }}>
          <Button variant="secondary" onClick={() => setDate(addDays(date, -1))}>← Previous day</Button>
          <Button variant="secondary" onClick={() => setDate(todayISO())} disabled={date === todayISO()}>Today</Button>
        </div>
      </div>
      <div className="stats">
        <StatCard label="Registers submitted" value={`${submitted} / ${rows.length}`} tone={rows.length && submitted === rows.length ? 'good' : 'warn'} />
        <StatCard label="Not submitted" value={pending.length} tone={pending.length ? 'bad' : 'good'} />
        <StatCard label="Students marked" value={marked} />
        <StatCard label="Attendance rate" value={rate === null ? '—' : `${rate}%`} hint="present + late, excluding excused" />
      </div>
      {pending.length > 0 && rows.length > 0 && (
        <Alert tone="warn">Waiting on: {pending.map((p) => p.class_name).join(', ')}</Alert>
      )}
      <Card padded={false} title={`Classes · ${formatDate(date)}`}>
        <ErrorBox error={overview.error} onRetry={() => overview.refetch()} />
        {overview.isLoading ? <Spinner /> : !rows.length ? <EmptyState title="No active classes" /> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Class</th><th>Status</th><th>Taken by</th><th className="num">Students</th><th className="num">P</th><th className="num">A</th><th className="num">L</th><th className="num">E</th><th></th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.class_id}>
                <td><strong>{r.class_name}</strong></td>
                <td><Badge value={r.session_status} />{r.submitted_at && <div className="muted small">{formatDateTime(r.submitted_at)}</div>}</td>
                <td>{r.taken_by_name ?? '—'}</td>
                <td className="num">{r.students}</td><td className="num">{r.present}</td><td className="num">{r.absent}</td>
                <td className="num">{r.late}</td><td className="num">{r.excused}</td>
                <td className="right"><Link className="btn btn-sm btn-secondary" to={`/attendance/${r.class_id}?date=${date}`}>{r.session_status === 'not_started' ? 'Take' : 'Open'}</Link></td>
              </tr>))}
            </tbody>
          </table></div>
        )}
      </Card>
    </>
  );
}

function Report() {
  const { schoolId } = useSchool();
  const classes = useClasses(schoolId);
  const [from, setFrom] = useState(addDays(todayISO(), -30));
  const [to, setTo] = useState(todayISO());
  const [classId, setClassId] = useState('');
  const [teacherId, setTeacherId] = useState('');
  const [q, setQ] = useState('');
  const teachers = useQuery({
    queryKey: ['teachers_min', schoolId],
    queryFn: () => unwrap<{ user_id: string; profiles: { full_name: string } | null }[]>(
      supabase.from('school_memberships').select('user_id, profiles(full_name)').eq('school_id', schoolId)),
  });
  const report = useQuery({
    queryKey: ['attendance_report', schoolId, from, to, classId, teacherId],
    enabled: from <= to,
    queryFn: () => unwrap<ReportRow[]>(supabase.rpc('attendance_report', {
      p_school_id: schoolId, p_from: from, p_to: to, p_class_id: classId || null, p_teacher_id: teacherId || null,
    })),
  });
  const rows = (report.data ?? []).filter((r) => !q || `${r.student_name} ${r.admission_number}`.toLowerCase().includes(q.toLowerCase()));
  const avg = rows.length ? Math.round((10 * rows.reduce((s, r) => s + Number(r.attendance_rate ?? 0), 0)) / rows.length) / 10 : null;
  return (
    <>
      <div className="filters">
        <Input label="From" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        <Input label="To" type="date" value={to} max={todayISO()} onChange={(e) => setTo(e.target.value)} />
        <Select label="Class" value={classId} onChange={(e) => setClassId(e.target.value)}>
          <option value="">All classes</option>{classes.data?.map((c) => <option key={c.id} value={c.id}>{classLabel(c)}</option>)}
        </Select>
        <Select label="Taken by" value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
          <option value="">Anyone</option>{teachers.data?.map((t) => <option key={t.user_id} value={t.user_id}>{t.profiles?.full_name}</option>)}
        </Select>
        <SearchBox value={q} onChange={setQ} placeholder="Filter by student" />
      </div>
      <Card padded={false} title={`Students · average rate ${avg ?? '—'}%`} actions={<>
        <Button variant="secondary" size="sm" onClick={() => window.print()}>Print</Button>
        <Button variant="secondary" size="sm" disabled={!rows.length} onClick={() => downloadCsv(`attendance-${from}-to-${to}.csv`, rows as unknown as Record<string, unknown>[], [
          { key: 'admission_number', label: 'Admission no.' }, { key: 'student_name', label: 'Student' }, { key: 'class_name', label: 'Class' },
          { key: 'days_marked', label: 'Days' }, { key: 'present', label: 'Present' }, { key: 'absent', label: 'Absent' },
          { key: 'late', label: 'Late' }, { key: 'excused', label: 'Excused' }, { key: 'attendance_rate', label: 'Rate %' }])}>Export CSV</Button>
      </>}>
        <ErrorBox error={report.error} />
        {report.isLoading ? <Spinner /> : !rows.length ? <EmptyState title="No attendance in this range" /> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Student</th><th>Class</th><th className="num">Days</th><th className="num">P</th><th className="num">A</th><th className="num">L</th><th className="num">E</th><th className="num">Rate</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.student_id + r.class_name}>
                <td><Link to={`/school/students/${r.student_id}`}>{r.student_name}</Link> <span className="muted small mono">{r.admission_number}</span></td>
                <td>{r.class_name}</td><td className="num">{r.days_marked}</td><td className="num">{r.present}</td><td className="num">{r.absent}</td>
                <td className="num">{r.late}</td><td className="num">{r.excused}</td>
                <td className="num"><Badge tone={r.attendance_rate === null ? 'neutral' : r.attendance_rate >= 90 ? 'good' : r.attendance_rate >= 75 ? 'warn' : 'bad'}>{r.attendance_rate ?? '—'}%</Badge></td>
              </tr>))}
            </tbody>
          </table></div>
        )}
      </Card>
    </>
  );
}
