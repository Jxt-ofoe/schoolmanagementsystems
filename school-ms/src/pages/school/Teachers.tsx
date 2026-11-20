import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useSchool } from '../../lib/auth';
import { unwrap, useClasses, useSubjects } from '../../lib/queries';
import { createStaffSchema, fieldErrors } from '../../lib/validation';
import { friendlyError } from '../../lib/errors';
import { useToast } from '../../lib/toast';
import { classLabel } from '../../lib/format';
import {
  Alert, Badge, Button, Card, ConfirmDialog, EmptyState, ErrorBox, Input, Modal, PageHeader, SearchBox, Select, Spinner,
} from '../../components/ui';

interface TeacherRow {
  id: string; user_id: string; status: 'active' | 'disabled'; created_at: string;
  profiles: { full_name: string; email: string | null; phone: string | null } | null;
}
interface AssignmentRow {
  id: string; teacher_id: string; class_id: string; subject_id: string | null;
  classes: { name: string; section: string | null } | null; subjects: { name: string } | null;
}

export async function invokeInvite(body: { email: string; full_name: string; role: 'teacher' | 'headmaster'; school_id: string; password?: string }) {
  const { data: sessData } = await supabase.auth.getSession();
  const token = sessData.session?.access_token;

  const res = await fetch('/api/staff/create', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token || ''}`,
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || 'Failed to create staff account');
  }
  return data as { user_id: string; outcome: 'created' | 'updated' };
}


export default function TeachersPage() {
  const { schoolId } = useSchool();
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [inviting, setInviting] = useState(false);
  const [managing, setManaging] = useState<TeacherRow | null>(null);
  const [toggling, setToggling] = useState<TeacherRow | null>(null);

  const teachers = useQuery({
    queryKey: ['teachers', schoolId],
    queryFn: () => unwrap<TeacherRow[]>(supabase.from('school_memberships')
      .select('id, user_id, status, created_at, profiles(full_name, email, phone)').eq('school_id', schoolId).eq('role', 'teacher')),
  });
  const assignments = useQuery({
    queryKey: ['assignments', schoolId],
    queryFn: () => unwrap<AssignmentRow[]>(supabase.from('teacher_assignments')
      .select('id, teacher_id, class_id, subject_id, classes(name, section), subjects(name)').eq('school_id', schoolId)),
  });

  const toggle = useMutation({
    mutationFn: async (t: TeacherRow) => {
      const { error } = await supabase.from('school_memberships').update({ status: t.status === 'active' ? 'disabled' : 'active' }).eq('id', t.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['teachers'] }); toast('Teacher access updated'); setToggling(null); },
    onError: (e) => { toast(friendlyError(e), 'error'); setToggling(null); },
  });
  const sendReset = useMutation({
    mutationFn: async (email: string) => {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/set-password` });
      if (error) throw error;
    },
    onSuccess: () => toast('Password setup link sent to the teacher’s email'),
    onError: (e) => toast(friendlyError(e), 'error'),
  });

  const list = (teachers.data ?? [])
    .filter((t) => !q || `${t.profiles?.full_name} ${t.profiles?.email}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (a.profiles?.full_name ?? '').localeCompare(b.profiles?.full_name ?? ''));
  const assignedTo = (uid: string) => (assignments.data ?? []).filter((a) => a.teacher_id === uid);

  return (
    <>
      <PageHeader title="Teachers" subtitle="Invite teachers and assign them to classes and subjects. Teachers only see what they are assigned."
        actions={<Button onClick={() => setInviting(true)}>+ Invite teacher</Button>} />
      <Card padded={false}>
        <div className="filters" style={{ padding: '12px 16px 0' }}>
          <SearchBox value={q} onChange={setQ} placeholder="Search teachers by name or email" />
        </div>
        <ErrorBox error={teachers.error} onRetry={() => teachers.refetch()} />
        {teachers.isLoading ? <Spinner /> : !list.length ? (
          <EmptyState title={q ? 'No matching teachers' : 'No teachers yet'} action={!q && <Button onClick={() => setInviting(true)}>Invite a teacher</Button>}>
            {!q && 'Teachers receive an email invitation and set their own password.'}
          </EmptyState>
        ) : (
          <div className="table-wrap"><table>
            <thead><tr><th>Teacher</th><th>Assignments</th><th>Status</th><th></th></tr></thead>
            <tbody>{list.map((t) => {
              const a = assignedTo(t.user_id);
              return (
                <tr key={t.id}>
                  <td><strong>{t.profiles?.full_name || '(name pending)'}</strong><div className="muted small">{t.profiles?.email}</div></td>
                  <td className="small">
                    {a.length === 0 ? <span className="muted">None</span> : a.map((x) => (
                      <div key={x.id}>{classLabel(x.classes)} · {x.subject_id ? x.subjects?.name : <strong>Class teacher</strong>}</div>))}
                  </td>
                  <td><Badge value={t.status} /></td>
                  <td><div className="table-actions">
                    <Button size="sm" variant="secondary" onClick={() => setManaging(t)}>Assignments</Button>
                    <Button size="sm" variant="ghost" onClick={() => t.profiles?.email && sendReset.mutate(t.profiles.email)}>Send password link</Button>
                    <Button size="sm" variant="ghost" onClick={() => setToggling(t)}>{t.status === 'active' ? 'Disable' : 'Enable'}</Button>
                  </div></td>
                </tr>);
            })}</tbody>
          </table></div>
        )}
      </Card>
      {inviting && <InviteModal schoolId={schoolId} onClose={() => setInviting(false)} />}
      {managing && <AssignmentsModal teacher={managing} assignments={assignedTo(managing.user_id)} onClose={() => setManaging(null)} />}
      <ConfirmDialog open={!!toggling} danger={toggling?.status === 'active'} loading={toggle.isPending}
        title={toggling?.status === 'active' ? 'Disable teacher' : 'Enable teacher'}
        confirmLabel={toggling?.status === 'active' ? 'Disable access' : 'Enable access'}
        message={toggling?.status === 'active'
          ? `${toggling?.profiles?.full_name} will immediately lose access to all classes, attendance and grades. Their past records are kept.`
          : `Restore ${toggling?.profiles?.full_name}'s access to their assigned classes?`}
        onCancel={() => setToggling(null)} onConfirm={() => toggling && toggle.mutate(toggling)} />
    </>
  );
}

function InviteModal({ schoolId, onClose }: { schoolId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [v, setV] = useState({ full_name: '', email: '', password: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [createdInfo, setCreatedInfo] = useState<{ email: string; password: string; name: string } | null>(null);

  const generateRandomPassword = () => {
    // Cryptographically secure temporary password (Finding M-5)
    // TODO(M-5): Migrate to invite-user edge function once deployed
    const pool = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%&*';
    const array = new Uint32Array(12);
    crypto.getRandomValues(array);
    const res = Array.from(array, (x) => pool[x % pool.length]).join('');
    setV((prev) => ({ ...prev, password: res }));
    setErrors((prev) => ({ ...prev, password: '' }));
  };

  const m = useMutation({
    mutationFn: async () => {
      const parsed = createStaffSchema.safeParse(v);
      if (!parsed.success) { setErrors(fieldErrors(parsed.error)); throw new Error('Please fix the highlighted fields.'); }
      return invokeInvite({ ...parsed.data, role: 'teacher', school_id: schoolId });
    },
    onSuccess: () => {
      setCreatedInfo({ email: v.email, password: v.password, name: v.full_name });
      qc.invalidateQueries({ queryKey: ['teachers'] });
      toast('Teacher account created successfully!');
    },
  });

  if (createdInfo) {
    const copyText = `Teacher account credentials:\nPortal: ${window.location.origin}/login\nEmail: ${createdInfo.email}\nPassword: ${createdInfo.password}\nRole: Teacher`;
    return (
      <Modal open title="Teacher Account Created!" onClose={onClose}
        footer={<Button onClick={onClose}>Done</Button>}>
        <Alert tone="success">The teacher account is now active and ready to use immediately.</Alert>
        <div style={{ background: '#f8fafc', padding: 16, borderRadius: 8, margin: '16px 0', border: '1px solid #e2e8f0', color: '#1e293b' }}>
          <p style={{ margin: '6px 0' }}><strong>Name:</strong> {createdInfo.name}</p>
          <p style={{ margin: '6px 0' }}><strong>Email:</strong> {createdInfo.email}</p>
          <p style={{ margin: '6px 0' }}><strong>Password:</strong> <code style={{ fontSize: '1.05rem', background: '#e2e8f0', padding: '2px 8px', borderRadius: 4, fontWeight: 'bold' }}>{createdInfo.password}</code></p>
          <p style={{ margin: '6px 0' }}><strong>Login URL:</strong> <a href="/login" target="_blank" rel="noreferrer">{window.location.origin}/login</a></p>
        </div>
        <p className="muted small" style={{ marginBottom: 12 }}>
          Temporary password generated — share once; the user should change this password at first login.
        </p>
        <Button variant="secondary" onClick={() => {
          navigator.clipboard.writeText(copyText);
          toast('Credentials copied to clipboard!');
        }}>
          📋 Copy Login Credentials
        </Button>
      </Modal>
    );
  }

  return (
    <Modal open title="Add a Teacher" onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => m.mutate()} loading={m.isPending}>Create Account</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        {m.error && <Alert tone="error">{friendlyError(m.error)}</Alert>}
        <Input label="Full name" value={v.full_name} onChange={(e) => setV({ ...v, full_name: e.target.value })} error={errors.full_name} placeholder="e.g. Mr. Kwame Mensah" required />
        <Input label="Email address" type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} error={errors.email} placeholder="e.g. teacher@school.com" required />
        <div style={{ position: 'relative' }}>
          <Input label="Password" type="text" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} error={errors.password} placeholder="Minimum 8 characters" required />
          <Button type="button" size="sm" variant="ghost" style={{ position: 'absolute', right: 0, top: 0 }} onClick={generateRandomPassword}>
            ⚡ Generate random
          </Button>
        </div>
        <p className="muted small">
          Temporary password generated — share once; the user should change this password at first login. This creates their active login account immediately. You can share the password directly with them.
        </p>
      </form>
    </Modal>
  );
}


function AssignmentsModal({ teacher, assignments, onClose }: { teacher: TeacherRow; assignments: AssignmentRow[]; onClose: () => void }) {
  const { schoolId } = useSchool();
  const qc = useQueryClient();
  const toast = useToast();
  const classes = useClasses(schoolId);
  const subjects = useSubjects(schoolId);
  const [classId, setClassId] = useState('');
  const [subjectId, setSubjectId] = useState('__class_teacher');
  const add = useMutation({
    mutationFn: async () => {
      if (!classId) throw new Error('Choose a class');
      const { error } = await supabase.from('teacher_assignments').insert({
        school_id: schoolId, teacher_id: teacher.user_id, class_id: classId, subject_id: subjectId === '__class_teacher' ? null : subjectId,
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['assignments'] }); qc.invalidateQueries({ queryKey: ['class_teachers'] }); toast('Assignment added'); },
  });
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('teacher_assignments').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['assignments'] }); toast('Assignment removed'); },
    onError: (e) => toast(friendlyError(e), 'error'),
  });
  return (
    <Modal open wide title={`Assignments · ${teacher.profiles?.full_name ?? ''}`} onClose={onClose} footer={<Button onClick={onClose}>Done</Button>}>
      {teacher.status !== 'active' && <Alert tone="warn">This teacher is disabled. Enable them before adding assignments.</Alert>}
      <h3>Current assignments</h3>
      {assignments.length === 0 ? <p className="muted">No assignments yet.</p> : (
        <ul className="list-plain">{assignments.map((a) => (
          <li key={a.id} className="row-between">
            <span>{classLabel(a.classes)} · {a.subject_id ? a.subjects?.name : <strong>Class teacher (takes attendance)</strong>}</span>
            <Button size="sm" variant="ghost" onClick={() => remove.mutate(a.id)} loading={remove.isPending && remove.variables === a.id}>Remove</Button>
          </li>))}
        </ul>
      )}
      <h3 style={{ marginTop: 18 }}>Add assignment</h3>
      {add.error && <Alert tone="error">{friendlyError(add.error)}</Alert>}
      <div className="form-grid">
        <Select label="Class" value={classId} onChange={(e) => setClassId(e.target.value)}>
          <option value="">Choose a class</option>
          {classes.data?.map((c) => <option key={c.id} value={c.id}>{classLabel(c)}</option>)}
        </Select>
        <Select label="Role in class" value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
          <option value="__class_teacher">Class teacher (attendance)</option>
          {subjects.data?.map((s) => <option key={s.id} value={s.id}>Subject: {s.name}</option>)}
        </Select>
      </div>
      <Button onClick={() => add.mutate()} loading={add.isPending} disabled={teacher.status !== 'active'}>Add assignment</Button>
      <p className="muted small" style={{ marginTop: 10 }}>Any teacher assigned to a class can take its attendance; only subject teachers can enter grades for their subject.</p>
    </Modal>
  );
}
