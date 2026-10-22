import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useSchool } from '../../lib/auth';
import { semesterLabel, unwrap, useClasses, usePlatformSettings, useSemesters } from '../../lib/queries';
import { classLabel, formatDate, formatDateTime, humanize, studentName } from '../../lib/format';
import { friendlyError } from '../../lib/errors';
import { useToast } from '../../lib/toast';
import type { Student } from '../../lib/types';
import {
  Alert, Badge, Button, Card, ConfirmDialog, EmptyState, ErrorBox, Modal, PageHeader, Select, Spinner, Textarea,
} from '../../components/ui';
import { StudentForm } from '../../components/StudentForm';

interface Enrollment {
  id: string; semester_id: string; status: string; is_late: boolean; registered_at: string; status_reason: string | null;
  semesters: { name: string; academic_years: { name: string } | null } | null; classes: { name: string; section: string | null } | null;
}

export default function StudentProfilePage() {
  const { studentId } = useParams();
  const { schoolId, schoolName } = useSchool();
  const qc = useQueryClient();
  const toast = useToast();
  const classes = useClasses(schoolId);
  const semesters = useSemesters(schoolId);
  const settings = usePlatformSettings();
  const current = semesters.data?.find((s) => s.is_current);
  const [semesterId, setSemesterId] = useState<string>('');
  const sem = semesters.data?.find((s) => s.id === (semesterId || current?.id));
  const [editing, setEditing] = useState(false);
  const [transfer, setTransfer] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [voiding, setVoiding] = useState<Enrollment | null>(null);
  const [voidReason, setVoidReason] = useState('');

  const student = useQuery({
    queryKey: ['student', studentId],
    queryFn: () => unwrap<Student & { classes: { name: string; section: string | null } | null }>(
      supabase.from('students').select('*, classes(name, section)').eq('id', studentId!).single()),
  });
  const enrollments = useQuery({
    queryKey: ['student', studentId, 'enrollments'],
    queryFn: () => unwrap<Enrollment[]>(supabase.from('student_enrollments')
      .select('id, semester_id, status, is_late, registered_at, status_reason, semesters(name, academic_years(name)), classes(name, section)')
      .eq('student_id', studentId!).order('registered_at', { ascending: false })),
  });
  const history = useQuery({
    queryKey: ['student', studentId, 'history'],
    queryFn: () => unwrap<{ id: string; moved_at: string; reason: string | null; from_class_id: string | null; to_class_id: string | null }[]>(
      supabase.from('student_class_history').select('*').eq('student_id', studentId!).order('moved_at', { ascending: false })),
  });
  const attendance = useQuery({
    queryKey: ['student', studentId, 'attendance', sem?.id],
    enabled: !!sem,
    queryFn: () => unwrap<{ days_marked: number; present: number; absent: number; late: number; excused: number; rate: number | null; recent: { attendance_date: string; status: string; note: string | null }[] }>(
      supabase.rpc('student_attendance_summary', { p_student_id: studentId, p_from: sem!.starts_on, p_to: sem!.ends_on })),
  });
  const results = useQuery({
    queryKey: ['student', studentId, 'results', sem?.id],
    enabled: !!sem,
    queryFn: () => unwrap<{ subject_id: string; subject_name: string; total: number; weight_total: number; percentage: number | null; grade: string | null; remark: string | null; scores_entered: number; assessments_count: number }[]>(
      supabase.rpc('student_semester_results', { p_student_id: studentId, p_semester_id: sem!.id })),
  });

  const register = useMutation({
    mutationFn: async () => unwrap(supabase.rpc('register_students_for_semester', { p_semester_id: current!.id, p_student_ids: [studentId] })),
    onSuccess: (n) => { toast(n ? 'Registered for the current semester' : 'Already registered'); qc.invalidateQueries({ queryKey: ['student', studentId] }); },
    onError: (e) => toast(friendlyError(e), 'error'),
  });
  const voidReg = useMutation({
    mutationFn: async () => {
      if (!voidReason.trim()) throw new Error('A reason is required');
      const { error } = await supabase.from('student_enrollments').update({ status: 'voided', status_reason: voidReason.trim() }).eq('id', voiding!.id);
      if (error) throw error;
    },
    onSuccess: () => { toast('Registration voided'); setVoiding(null); setVoidReason(''); qc.invalidateQueries({ queryKey: ['student', studentId] }); },
    onError: (e) => toast(friendlyError(e), 'error'),
  });

  if (student.isLoading) return <Spinner />;
  if (student.error) return <><PageHeader title="Student" back={<Link to="/school/students">← Students</Link>} /><ErrorBox error={student.error} /></>;
  const s = student.data!;
  const classById = new Map(classes.data?.map((c) => [c.id, c]));
  const registeredNow = enrollments.data?.some((e) => e.semester_id === current?.id && e.status !== 'voided');
  const graceDays = settings.data?.void_grace_days ?? 14;

  return (
    <>
      <div className="print-only"><h2>{schoolName}</h2><p>Student report · {semesterLabel(sem)}</p></div>
      <PageHeader
        back={<Link to={s.current_class_id ? `/school/students/class/${s.current_class_id}` : '/school/students'}>← {s.current_class_id ? classLabel(s.classes) : 'Students'}</Link>}
        title={studentName(s)}
        subtitle={<><span className="mono">{s.admission_number}</span> · {classLabel(s.classes)} · <Badge value={s.enrollment_status} /></>}
        actions={<>
          <Button variant="secondary" onClick={() => window.print()}>Print report</Button>
          <Button variant="secondary" onClick={() => setStatusOpen(true)}>Change status</Button>
          <Button variant="secondary" onClick={() => setTransfer(true)} disabled={s.enrollment_status !== 'active'}>Transfer class</Button>
          <Button onClick={() => setEditing(true)}>Edit details</Button>
        </>} />

      {current && !registeredNow && s.enrollment_status === 'active' && (
        <Alert tone="warn">
          <span>Not registered for {semesterLabel(current)}.</span>
          <Button size="sm" onClick={() => register.mutate()} loading={register.isPending} disabled={!s.current_class_id}>Register now</Button>
        </Alert>
      )}

      <div className="grid-2">
        <Card title="Details">
          <dl className="details">
            <dt>Gender</dt><dd>{humanize(s.gender) || '—'}</dd>
            <dt>Date of birth</dt><dd>{formatDate(s.date_of_birth)}</dd>
            <dt>Admitted</dt><dd>{formatDate(s.admission_date)}</dd>
            <dt>Guardian</dt><dd>{s.guardian_name ?? '—'}{s.guardian_relationship ? ` (${s.guardian_relationship})` : ''}</dd>
            <dt>Phone</dt><dd>{s.guardian_phone ? <a href={`tel:${s.guardian_phone}`}>{s.guardian_phone}</a> : '—'}</dd>
            <dt>Email</dt><dd>{s.guardian_email ?? '—'}</dd>
            <dt>Address</dt><dd>{s.address ?? '—'}</dd>
            <dt>Notes</dt><dd>{s.notes ?? '—'}</dd>
          </dl>
        </Card>

        <Card title="Attendance" actions={
          <Select label="Semester" value={semesterId || current?.id || ''} onChange={(e) => setSemesterId(e.target.value)}>
            {semesters.data?.map((x) => <option key={x.id} value={x.id}>{semesterLabel(x)}</option>)}
          </Select>}>
          {!sem ? <EmptyState title="No semester set up" /> : attendance.isLoading ? <Spinner /> : attendance.data && attendance.data.days_marked > 0 ? (
            <>
              <div className="stats" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
                <div className="stat"><div className="stat-label">Attendance rate</div><div className="stat-value">{attendance.data.rate ?? '—'}%</div></div>
                <div className="stat"><div className="stat-label">Days marked</div><div className="stat-value">{attendance.data.days_marked}</div></div>
              </div>
              <div className="row">
                <Badge value="present">Present {attendance.data.present}</Badge><Badge value="absent">Absent {attendance.data.absent}</Badge>
                <Badge value="late">Late {attendance.data.late}</Badge><Badge value="excused">Excused {attendance.data.excused}</Badge>
              </div>
              <ul className="list-plain small" style={{ marginTop: 10 }}>
                {attendance.data.recent.slice(0, 6).map((r) => (
                  <li key={r.attendance_date} className="row-between"><span>{formatDate(r.attendance_date)}</span><span>{r.note && <span className="muted">{r.note} · </span>}<Badge value={r.status} /></span></li>
                ))}
              </ul>
            </>
          ) : <EmptyState title="No attendance recorded this semester" />}
        </Card>
      </div>

      <div style={{ height: 16 }} />
      <Card title={`Academic results · ${semesterLabel(sem)}`} padded={false}>
        {results.isLoading ? <Spinner /> : !results.data?.length ? <EmptyState title="No assessments recorded yet" /> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Subject</th><th className="num">Total</th><th className="num">%</th><th>Grade</th><th>Remark</th><th>Progress</th></tr></thead>
            <tbody>{results.data.map((r) => (
              <tr key={r.subject_id}>
                <td>{r.subject_name}</td><td className="num">{Number(r.total).toFixed(1)} / {Number(r.weight_total)}</td>
                <td className="num">{r.percentage ?? '—'}</td><td><strong>{r.grade ?? '—'}</strong></td><td>{r.remark ?? ''}</td>
                <td className="muted small">{r.scores_entered}/{r.assessments_count} assessments</td>
              </tr>))}
            </tbody>
          </table></div>
        )}
      </Card>

      <div style={{ height: 16 }} />
      <div className="grid-2 no-print">
        <Card title="Semester registrations" padded={false}>
          {!enrollments.data?.length ? <EmptyState title="Never registered" /> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Semester</th><th>Class</th><th>Status</th><th></th></tr></thead>
              <tbody>{enrollments.data.map((e) => {
                const withinGrace = Date.now() - new Date(e.registered_at).getTime() < graceDays * 86400000;
                return (
                  <tr key={e.id}>
                    <td>{e.semesters?.academic_years?.name} · {e.semesters?.name}<div className="muted small">Registered {formatDate(e.registered_at)}{e.is_late && ' · late'}</div></td>
                    <td>{classLabel(e.classes)}</td>
                    <td><Badge value={e.status} />{e.status_reason && <div className="muted small">{e.status_reason}</div>}</td>
                    <td className="right">{e.status === 'registered' && withinGrace && (
                      <Button size="sm" variant="ghost" onClick={() => setVoiding(e)}>Void</Button>)}</td>
                  </tr>);
              })}</tbody>
            </table></div>
          )}
        </Card>
        <Card title="Class history">
          {!history.data?.length ? <EmptyState title="No class changes recorded" /> : (
            <ul className="list-plain">{history.data.map((h) => (
              <li key={h.id}>
                <strong>{h.from_class_id ? classLabel(classById.get(h.from_class_id)) : 'Unplaced'} → {h.to_class_id ? classLabel(classById.get(h.to_class_id)) : 'Unplaced'}</strong>
                <div className="muted small">{formatDateTime(h.moved_at)}{h.reason ? ` · ${h.reason}` : ''}</div>
              </li>))}
            </ul>
          )}
        </Card>
      </div>

      {editing && classes.data && <StudentForm open onClose={() => setEditing(false)} schoolId={schoolId} classes={classes.data} student={s} />}
      {transfer && <TransferModal student={s} onClose={() => setTransfer(false)} />}
      {statusOpen && <StatusModal student={s} onClose={() => setStatusOpen(false)} />}
      <ConfirmDialog open={!!voiding} title="Void registration" danger confirmLabel="Void registration" loading={voidReg.isPending}
        message={`Voiding cancels this registration. Only use it for data-entry mistakes (allowed within ${graceDays} days). Withdrawals should use “Change status”.`}
        onCancel={() => setVoiding(null)} onConfirm={() => voidReg.mutate()}>
        <Textarea label="Reason (required)" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} />
      </ConfirmDialog>
    </>
  );
}

function TransferModal({ student, onClose }: { student: Student; onClose: () => void }) {
  const { schoolId } = useSchool();
  const classes = useClasses(schoolId);
  const qc = useQueryClient();
  const toast = useToast();
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: async () => {
      if (!to) throw new Error('Choose the new class');
      const { error } = await supabase.rpc('transfer_student', { p_student_id: student.id, p_to_class_id: to, p_reason: reason.trim() || null });
      if (error) throw error;
    },
    onSuccess: () => { toast('Student transferred'); qc.invalidateQueries(); onClose(); },
  });
  return (
    <Modal open title="Transfer to another class" onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => m.mutate()} loading={m.isPending}>Transfer</Button></>}>
      {m.error && <Alert tone="error">{friendlyError(m.error)}</Alert>}
      <Select label="New class" value={to} onChange={(e) => setTo(e.target.value)} required>
        <option value="">Choose a class</option>
        {classes.data?.filter((c) => c.id !== student.current_class_id).map((c) => <option key={c.id} value={c.id}>{classLabel(c)}</option>)}
      </Select>
      <Textarea label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Promotion, section change" />
      <p className="muted small">The move is recorded in the student class history. The current semester registration follows the student.</p>
    </Modal>
  );
}

function StatusModal({ student, onClose }: { student: Student; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState(student.enrollment_status);
  const [reason, setReason] = useState('');
  const m = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('set_student_status', { p_student_id: student.id, p_status: status, p_reason: reason.trim() || null });
      if (error) throw error;
    },
    onSuccess: () => { toast('Status updated'); qc.invalidateQueries(); onClose(); },
  });
  return (
    <Modal open title="Change enrollment status" onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => m.mutate()} loading={m.isPending} disabled={status === student.enrollment_status}>Save</Button></>}>
      {m.error && <Alert tone="error">{friendlyError(m.error)}</Alert>}
      <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value as Student['enrollment_status'])}>
        <option value="active">Active</option><option value="suspended">Suspended</option><option value="withdrawn">Withdrawn</option>
        <option value="transferred_out">Transferred to another school</option><option value="graduated">Graduated</option>
      </Select>
      <Textarea label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
      {(status === 'withdrawn' || status === 'transferred_out') && (
        <Alert tone="info">The current semester registration stays billable (the place was used this semester) and is marked as {humanize(status)}.</Alert>
      )}
    </Modal>
  );
}
