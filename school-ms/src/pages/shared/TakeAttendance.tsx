import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { unwrap } from '../../lib/queries';
import { classLabel, formatDate, formatDateTime, todayISO } from '../../lib/format';
import { friendlyError } from '../../lib/errors';
import { useToast } from '../../lib/toast';
import type { AttendanceStatus, ClassRow } from '../../lib/types';
import { Alert, Badge, Button, EmptyState, ErrorBox, Input, PageHeader, Spinner } from '../../components/ui';

const STATUSES: { id: AttendanceStatus; label: string }[] = [
  { id: 'present', label: 'Present' },
  { id: 'absent', label: 'Absent' },
  { id: 'late', label: 'Late' },
  { id: 'excused', label: 'Excused' },
];

interface Mark { status: AttendanceStatus | null; note: string }

export default function TakeAttendancePage() {
  const { classId } = useParams();
  const [params, setParams] = useSearchParams();
  const date = params.get('date') || todayISO();
  const { active } = useAuth();
  const qc = useQueryClient();
  const toast = useToast();
  const [marks, setMarks] = useState<Record<string, Mark>>({});
  const [notesOpen, setNotesOpen] = useState<Record<string, boolean>>({});
  const [sessionNote, setSessionNote] = useState('');
  const [dirty, setDirty] = useState(false);

  const cls = useQuery({
    queryKey: ['class', classId],
    queryFn: () => unwrap<ClassRow>(supabase.from('classes').select('*').eq('id', classId!).single()),
  });
  const students = useQuery({
    queryKey: ['students', 'class', classId, 'register'],
    queryFn: () => unwrap<{ id: string; first_name: string; last_name: string; admission_number: string }[]>(
      supabase.from('students').select('id, first_name, last_name, admission_number')
        .eq('current_class_id', classId!).eq('enrollment_status', 'active').order('last_name').order('first_name')),
  });
  const session = useQuery({
    queryKey: ['attendance', classId, date],
    queryFn: async () => {
      const s = await unwrap<{ id: string; status: string; submitted_at: string | null; notes: string | null; profiles?: null }[]>(
        supabase.from('attendance_sessions').select('id, status, submitted_at, notes').eq('class_id', classId!).eq('attendance_date', date));
      const records = s.length
        ? await unwrap<{ student_id: string; status: AttendanceStatus; note: string | null }[]>(
          supabase.from('attendance_records').select('student_id, status, note').eq('session_id', s[0].id))
        : [];
      return { session: s[0] ?? null, records };
    },
  });

  // hydrate local state when data for this date arrives
  useEffect(() => {
    if (!students.data || !session.data) return;
    const next: Record<string, Mark> = {};
    for (const st of students.data) next[st.id] = { status: null, note: '' };
    for (const r of session.data.records) next[r.student_id] = { status: r.status, note: r.note ?? '' };
    setMarks(next);
    setSessionNote(session.data.session?.notes ?? '');
    setDirty(false);
  }, [students.data, session.data]);

  const counts = useMemo(() => {
    const c = { present: 0, absent: 0, late: 0, excused: 0, unmarked: 0 };
    Object.values(marks).forEach((m) => { if (m.status) c[m.status] += 1; else c.unmarked += 1; });
    return c;
  }, [marks]);

  const setMark = (id: string, patch: Partial<Mark>) => { setMarks((m) => ({ ...m, [id]: { ...m[id], ...patch } })); setDirty(true); };
  const markAll = (status: AttendanceStatus) => {
    setMarks((m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { ...v, status: v.status ?? status }])));
    setDirty(true);
  };

  const save = useMutation({
    mutationFn: async (submit: boolean) => {
      const records = Object.entries(marks).filter(([, m]) => m.status).map(([student_id, m]) => ({ student_id, status: m.status, note: m.note }));
      if (submit && counts.unmarked > 0) throw new Error(`Mark all students before submitting (${counts.unmarked} unmarked).`);
      if (!records.length) throw new Error('Mark at least one student.');
      const { error } = await supabase.rpc('save_attendance', { p_class_id: classId, p_date: date, p_records: records, p_submit: submit, p_notes: sessionNote || null });
      if (error) throw error;
      return submit;
    },
    onSuccess: (submitted) => {
      toast(submitted ? 'Attendance submitted' : 'Draft saved');
      setDirty(false);
      qc.invalidateQueries({ queryKey: ['attendance', classId, date] });
      qc.invalidateQueries({ queryKey: ['teacher_dashboard'] });
      qc.invalidateQueries({ queryKey: ['attendance_overview'] });
    },
    onError: (e) => toast(friendlyError(e), 'error'),
  });

  const changeDate = (d: string) => {
    if (dirty && !window.confirm('You have unsaved changes. Switch date and discard them?')) return;
    setParams({ date: d });
  };

  if (cls.isLoading || students.isLoading) return <Spinner />;
  if (cls.error) return <ErrorBox error={cls.error} />;
  const sess = session.data?.session;
  const backTo = active?.role === 'headmaster' ? '/school/attendance' : '/teach';

  return (
    <>
      <PageHeader back={<Link to={backTo}>← Back</Link>} title={`Attendance · ${classLabel(cls.data)}`}
        subtitle={<>{formatDate(date)} · {sess ? <><Badge value={sess.status} />{sess.submitted_at && <span className="muted small"> at {formatDateTime(sess.submitted_at)}</span>}</> : <Badge value="not_started" />}</>} />

      <div className="filters">
        <Input label="Date" type="date" value={date} max={todayISO()} onChange={(e) => e.target.value && changeDate(e.target.value)} />
        <div className="row" style={{ paddingBottom: 2 }}>
          <Button variant="secondary" onClick={() => markAll('present')} disabled={!counts.unmarked}>Mark remaining present</Button>
        </div>
      </div>
      {sess?.status === 'submitted' && <Alert tone="info">Already submitted. Changes you save now are recorded in the audit log.</Alert>}
      <ErrorBox error={students.error || session.error} />

      {!students.data?.length ? <EmptyState title="No active students in this class" /> : (
        <div className="att-list">
          {students.data.map((s) => {
            const m = marks[s.id] ?? { status: null, note: '' };
            return (
              <div key={s.id} className="att-row">
                <div className="att-row-head">
                  <div>
                    <div className="att-name">{s.last_name}, {s.first_name}</div>
                    <div className="att-adm">{s.admission_number}
                      {' · '}<button className="att-note-toggle" onClick={() => setNotesOpen((n) => ({ ...n, [s.id]: !n[s.id] }))}>
                        {m.note ? 'Edit note' : 'Add note'}</button></div>
                  </div>
                </div>
                <div className="att-buttons" role="group" aria-label={`Attendance for ${s.first_name} ${s.last_name}`}>
                  {STATUSES.map((st) => (
                    <button key={st.id} type="button" className={`att-btn s-${st.id}`} aria-pressed={m.status === st.id}
                      onClick={() => setMark(s.id, { status: st.id })} title={st.label}>
                      {st.label}
                    </button>
                  ))}
                </div>
                {notesOpen[s.id] && (
                  <input aria-label={`Note for ${s.first_name}`} placeholder="Optional note (e.g. reason for absence)" maxLength={300}
                    value={m.note} onChange={(e) => setMark(s.id, { note: e.target.value })} />
                )}
              </div>
            );
          })}
          <div className="card card-body">
            <Input label="Register note (optional)" value={sessionNote} maxLength={500} onChange={(e) => { setSessionNote(e.target.value); setDirty(true); }} />
          </div>
        </div>
      )}

      {!!students.data?.length && (
        <div className="sticky-bar">
          <div className="row small">
            <Badge value="present">P {counts.present}</Badge><Badge value="absent">A {counts.absent}</Badge>
            <Badge value="late">L {counts.late}</Badge><Badge value="excused">E {counts.excused}</Badge>
            {counts.unmarked > 0 && <Badge tone="neutral">{counts.unmarked} unmarked</Badge>}
          </div>
          <div className="row">
            <Button variant="secondary" onClick={() => save.mutate(false)} loading={save.isPending && save.variables === false} disabled={!dirty}>Save draft</Button>
            <Button onClick={() => save.mutate(true)} loading={save.isPending && save.variables === true}>{sess?.status === 'submitted' ? 'Save changes' : 'Submit'}</Button>
          </div>
        </div>
      )}
    </>
  );
}
