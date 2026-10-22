import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useSchool } from '../../lib/auth';
import { semesterLabel, unwrap, useSemesters } from '../../lib/queries';
import { academicYearSchema, semesterSchema, fieldErrors } from '../../lib/validation';
import { friendlyError } from '../../lib/errors';
import { useToast } from '../../lib/toast';
import { formatDate } from '../../lib/format';
import type { Semester } from '../../lib/types';
import { Alert, Badge, Button, Card, ConfirmDialog, EmptyState, ErrorBox, Input, Modal, PageHeader, Select, Spinner, StatCard } from '../../components/ui';

interface Year { id: string; name: string; starts_on: string; ends_on: string; is_current: boolean }

export default function AcademicPage() {
  const { schoolId } = useSchool();
  const qc = useQueryClient();
  const toast = useToast();
  const years = useQuery({
    queryKey: ['academic_years', schoolId],
    queryFn: () => unwrap<Year[]>(supabase.from('academic_years').select('*').eq('school_id', schoolId).order('starts_on', { ascending: false })),
  });
  const semesters = useSemesters(schoolId);
  const current = semesters.data?.find((s) => s.is_current);
  const [yearOpen, setYearOpen] = useState(false);
  const [semOpen, setSemOpen] = useState<Semester | 'new' | null>(null);
  const [confirmReg, setConfirmReg] = useState(false);

  const regStats = useQuery({
    queryKey: ['registration_stats', current?.id],
    enabled: !!current,
    queryFn: async () => {
      const [{ count: registered }, { count: late }, { count: active }] = await Promise.all([
        supabase.from('student_enrollments').select('id', { count: 'exact', head: true }).eq('semester_id', current!.id).neq('status', 'voided'),
        supabase.from('student_enrollments').select('id', { count: 'exact', head: true }).eq('semester_id', current!.id).eq('is_late', true).neq('status', 'voided'),
        supabase.from('students').select('id', { count: 'exact', head: true }).eq('school_id', schoolId).eq('enrollment_status', 'active').not('current_class_id', 'is', null),
      ]);
      return { registered: registered ?? 0, late: late ?? 0, active: active ?? 0 };
    },
  });

  const setCurrent = useMutation({
    mutationFn: async (id: string) => { const { error } = await supabase.rpc('set_current_semester', { p_semester_id: id }); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries(); toast('Current semester updated'); },
    onError: (e) => toast(friendlyError(e), 'error'),
  });
  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from('semesters').update({ status }).eq('id', id); if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['semesters'] }); toast('Semester updated'); },
    onError: (e) => toast(friendlyError(e), 'error'),
  });
  const registerAll = useMutation({
    mutationFn: async () => unwrap<number>(supabase.rpc('register_students_for_semester', { p_semester_id: current!.id })),
    onSuccess: (n) => { toast(`${n} student${n === 1 ? '' : 's'} registered`); setConfirmReg(false); qc.invalidateQueries({ queryKey: ['registration_stats'] }); },
    onError: (e) => { toast(friendlyError(e), 'error'); setConfirmReg(false); },
  });

  const unregistered = Math.max(0, (regStats.data?.active ?? 0) - (regStats.data?.registered ?? 0));

  return (
    <>
      <PageHeader title="Academic calendar" subtitle="Academic years, semesters and semester registration"
        actions={<><Button variant="secondary" onClick={() => setYearOpen(true)}>+ Academic year</Button>
          <Button onClick={() => setSemOpen('new')} disabled={!years.data?.length}>+ Semester</Button></>} />

      <Card title={current ? `Registration · ${semesterLabel(current)}` : 'Registration'}>
        {!current ? <Alert tone="warn">No current semester. Create one and mark it as current to start registering students.</Alert> : (
          <>
            <div className="stats">
              <StatCard label="Registered" value={regStats.data?.registered ?? '…'} tone="good" />
              <StatCard label="Active students not yet registered" value={regStats.isLoading ? '…' : unregistered} tone={unregistered ? 'warn' : undefined} />
              <StatCard label="Late registrations" value={regStats.data?.late ?? '…'} hint={current.registration_deadline ? `after ${formatDate(current.registration_deadline)}` : 'no deadline set'} />
              <StatCard label="Semester status" value={<Badge value={current.status} />} hint={`${formatDate(current.starts_on)} – ${formatDate(current.ends_on)}`} />
            </div>
            <div className="row">
              <Button onClick={() => setConfirmReg(true)} disabled={!unregistered || current.status === 'closed'}>Register all active students</Button>
              <span className="muted small">Each registered student is billed once per semester at the platform rate. Registering twice never double-counts.</span>
            </div>
          </>
        )}
      </Card>
      <div style={{ height: 16 }} />

      <Card title="Semesters" padded={false}>
        <ErrorBox error={semesters.error} />
        {semesters.isLoading ? <Spinner /> : !semesters.data?.length ? <EmptyState title="No semesters yet">Create an academic year first, then add semesters or terms.</EmptyState> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Semester</th><th>Dates</th><th>Registration deadline</th><th>Status</th><th></th></tr></thead>
            <tbody>{semesters.data.map((s) => (
              <tr key={s.id}>
                <td><strong>{semesterLabel(s)}</strong> {s.is_current && <Badge tone="good">Current</Badge>}</td>
                <td className="nowrap">{formatDate(s.starts_on)} – {formatDate(s.ends_on)}</td>
                <td>{formatDate(s.registration_deadline)}</td>
                <td><Badge value={s.status} /></td>
                <td><div className="table-actions">
                  {!s.is_current && <Button size="sm" variant="secondary" onClick={() => setCurrent.mutate(s.id)}>Make current</Button>}
                  <Button size="sm" variant="ghost" onClick={() => setSemOpen(s)}>Edit</Button>
                  {s.status !== 'closed'
                    ? <Button size="sm" variant="ghost" onClick={() => setStatus.mutate({ id: s.id, status: 'closed' })}>Close</Button>
                    : <Button size="sm" variant="ghost" onClick={() => setStatus.mutate({ id: s.id, status: 'open' })}>Reopen</Button>}
                </div></td>
              </tr>))}
            </tbody>
          </table></div>
        )}
      </Card>
      <div style={{ height: 16 }} />
      <Card title="Academic years" padded={false}>
        {years.isLoading ? <Spinner /> : !years.data?.length ? <EmptyState title="No academic years yet" action={<Button onClick={() => setYearOpen(true)}>Create academic year</Button>} /> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Year</th><th>Dates</th><th></th></tr></thead>
            <tbody>{years.data.map((y) => (
              <tr key={y.id}><td><strong>{y.name}</strong> {y.is_current && <Badge tone="good">Current</Badge>}</td><td>{formatDate(y.starts_on)} – {formatDate(y.ends_on)}</td><td /></tr>))}
            </tbody>
          </table></div>
        )}
      </Card>

      {yearOpen && <YearModal schoolId={schoolId} onClose={() => setYearOpen(false)} />}
      {semOpen && <SemesterModal schoolId={schoolId} years={years.data ?? []} semester={semOpen === 'new' ? null : semOpen} onClose={() => setSemOpen(null)} />}
      <ConfirmDialog open={confirmReg} title="Register all active students" confirmLabel={`Register ${unregistered}`} loading={registerAll.isPending}
        message={`${unregistered} active, placed students will be registered for ${semesterLabel(current)}. This adds them to this semester's bill for your school.`}
        onCancel={() => setConfirmReg(false)} onConfirm={() => registerAll.mutate()} />
    </>
  );
}

function YearModal({ schoolId, onClose }: { schoolId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const y = new Date().getFullYear();
  const [v, setV] = useState({ name: `${y}/${y + 1}`, starts_on: `${y}-09-01`, ends_on: `${y + 1}-07-31` });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: async () => {
      const parsed = academicYearSchema.safeParse(v);
      if (!parsed.success) { setErrors(fieldErrors(parsed.error)); throw new Error('Please fix the highlighted fields.'); }
      const { error } = await supabase.from('academic_years').insert({ ...parsed.data, school_id: schoolId });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['academic_years'] }); toast('Academic year created'); onClose(); },
  });
  return (
    <Modal open title="New academic year" onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => m.mutate()} loading={m.isPending}>Create</Button></>}>
      {m.error && <Alert tone="error">{friendlyError(m.error)}</Alert>}
      <Input label="Name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} error={errors.name} required />
      <div className="form-grid">
        <Input label="Starts" type="date" value={v.starts_on} onChange={(e) => setV({ ...v, starts_on: e.target.value })} error={errors.starts_on} />
        <Input label="Ends" type="date" value={v.ends_on} onChange={(e) => setV({ ...v, ends_on: e.target.value })} error={errors.ends_on} />
      </div>
    </Modal>
  );
}

function SemesterModal({ schoolId, years, semester, onClose }: { schoolId: string; years: Year[]; semester: Semester | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [v, setV] = useState({
    academic_year_id: semester?.academic_year_id ?? years[0]?.id ?? '', name: semester?.name ?? 'Semester 1',
    starts_on: semester?.starts_on ?? '', ends_on: semester?.ends_on ?? '', registration_deadline: semester?.registration_deadline ?? '',
  });
  const [makeCurrent, setMakeCurrent] = useState(!semester);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: async () => {
      const parsed = semesterSchema.safeParse(v);
      if (!parsed.success) { setErrors(fieldErrors(parsed.error)); throw new Error('Please fix the highlighted fields.'); }
      if (semester) {
        const { academic_year_id: _y, ...rest } = parsed.data;
        const { error } = await supabase.from('semesters').update(rest).eq('id', semester.id);
        if (error) throw error;
        return;
      }
      const { data, error } = await supabase.from('semesters').insert({ ...parsed.data, school_id: schoolId }).select('id').single();
      if (error) throw error;
      if (makeCurrent) {
        const { error: e2 } = await supabase.rpc('set_current_semester', { p_semester_id: data.id });
        if (e2) throw e2;
      }
    },
    onSuccess: () => { qc.invalidateQueries(); toast('Semester saved'); onClose(); },
  });
  return (
    <Modal open title={semester ? 'Edit semester' : 'New semester'} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => m.mutate()} loading={m.isPending}>Save</Button></>}>
      {m.error && <Alert tone="error">{friendlyError(m.error)}</Alert>}
      <Select label="Academic year" value={v.academic_year_id} disabled={!!semester} onChange={(e) => setV({ ...v, academic_year_id: e.target.value })} error={errors.academic_year_id}>
        {years.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
      </Select>
      <Input label="Name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} error={errors.name} placeholder="Semester 1 / Term 1" required />
      <div className="form-grid">
        <Input label="Starts" type="date" value={v.starts_on} onChange={(e) => setV({ ...v, starts_on: e.target.value })} error={errors.starts_on} required />
        <Input label="Ends" type="date" value={v.ends_on} onChange={(e) => setV({ ...v, ends_on: e.target.value })} error={errors.ends_on} required />
      </div>
      <Input label="Registration deadline" type="date" value={v.registration_deadline} onChange={(e) => setV({ ...v, registration_deadline: e.target.value })}
        error={errors.registration_deadline} hint="Registrations after this date are flagged as late (still billed once)" />
      {!semester && <label className="checkbox"><input type="checkbox" checked={makeCurrent} onChange={(e) => setMakeCurrent(e.target.checked)} /> Make this the current semester</label>}
    </Modal>
  );
}
