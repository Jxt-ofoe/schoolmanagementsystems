import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { unwrap } from '../../lib/queries';
import { createStaffSchema, fieldErrors } from '../../lib/validation';
import { friendlyError } from '../../lib/errors';
import { formatDate, formatMoney, humanize } from '../../lib/format';
import { useToast } from '../../lib/toast';
import { invokeInvite } from '../school/Teachers';
import type { BillingOverview } from '../../lib/types';
import { Alert, Badge, Button, Card, ConfirmDialog, EmptyState, ErrorBox, Input, Modal, PageHeader, Spinner, StatCard } from '../../components/ui';

interface School { id: string; name: string; code: string; status: string; email: string | null; phone: string | null; address: string | null; region: string | null; created_at: string }
interface Member { id: string; user_id: string; role: string; status: string; profiles: { full_name: string; email: string | null } | null }

export default function AdminSchoolDetail() {
  const { schoolId } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const [inviting, setInviting] = useState(false);
  const [statusTo, setStatusTo] = useState<string | null>(null);
  const [memberToggle, setMemberToggle] = useState<Member | null>(null);

  const school = useQuery({ queryKey: ['admin_school', schoolId], queryFn: () => unwrap<School>(supabase.from('schools').select('*').eq('id', schoolId!).single()) });
  const members = useQuery({
    queryKey: ['admin_members', schoolId],
    queryFn: () => unwrap<Member[]>(supabase.from('school_memberships').select('id, user_id, role, status, profiles(full_name, email)').eq('school_id', schoolId!).order('role')),
  });
  const semesters = useQuery({
    queryKey: ['admin_semesters', schoolId],
    queryFn: () => unwrap<{ id: string; name: string; is_current: boolean; starts_on: string; ends_on: string; academic_years: { name: string } | null }[]>(
      supabase.from('semesters').select('id, name, is_current, starts_on, ends_on, academic_years(name)').eq('school_id', schoolId!).order('starts_on', { ascending: false })),
  });
  const bills = useQuery({
    queryKey: ['admin_bills', schoolId],
    queryFn: () => unwrap<BillingOverview[]>(supabase.from('billing_overview').select('*').eq('school_id', schoolId!)),
  });
  const summary = useQuery({
    queryKey: ['platform_schools'],
    queryFn: () => unwrap<{ school_id: string; students_active: number; teachers: number; registered_current: number }[]>(supabase.rpc('platform_school_summaries')),
  });
  const stats = summary.data?.find((s) => s.school_id === schoolId);

  const setStatus = useMutation({
    mutationFn: async (status: string) => { const { error } = await supabase.from('schools').update({ status }).eq('id', schoolId!); if (error) throw error; },
    onSuccess: () => { toast('School status updated'); setStatusTo(null); qc.invalidateQueries(); },
    onError: (e) => { toast(friendlyError(e), 'error'); setStatusTo(null); },
  });
  const toggleMember = useMutation({
    mutationFn: async (m: Member) => {
      const { error } = await supabase.from('school_memberships').update({ status: m.status === 'active' ? 'disabled' : 'active' }).eq('id', m.id);
      if (error) throw error;
    },
    onSuccess: () => { toast('Access updated'); setMemberToggle(null); qc.invalidateQueries({ queryKey: ['admin_members'] }); },
    onError: (e) => { toast(friendlyError(e), 'error'); setMemberToggle(null); },
  });
  const generate = useMutation({
    mutationFn: async (semesterId: string) => unwrap(supabase.rpc('upsert_semester_billing', { p_semester_id: semesterId })),
    onSuccess: () => { toast('Billing generated / refreshed'); qc.invalidateQueries({ queryKey: ['admin_bills'] }); },
    onError: (e) => toast(friendlyError(e), 'error'),
  });

  if (school.isLoading) return <Spinner />;
  if (school.error) return <ErrorBox error={school.error} />;
  const s = school.data!;
  const billFor = (semId: string) => bills.data?.find((b) => b.semester_id === semId);

  const hasHeadmaster = members.data?.some((m) => m.role === 'headmaster');

  return (
    <>
      <PageHeader back={<Link to="/admin/schools">← Schools</Link>} title={s.name}
        subtitle={<><span className="mono">{s.code}</span> · <Badge value={s.status} /> · created {formatDate(s.created_at)}</>}
        actions={<>
          {s.status !== 'active' && <Button onClick={() => setStatusTo('active')}>Activate</Button>}
          {s.status === 'active' && <Button variant="secondary" onClick={() => setStatusTo('suspended')}>Suspend</Button>}
          {s.status !== 'inactive' && <Button variant="ghost" onClick={() => setStatusTo('inactive')}>Deactivate</Button>}
        </>} />
      <div className="stats">
        <StatCard label="Active students" value={stats?.students_active ?? '…'} />
        <StatCard label="Teachers" value={stats?.teachers ?? '…'} />
        <StatCard label="Registered (current)" value={stats?.registered_current ?? '…'} />
        <StatCard label="Region" value={<span style={{ fontSize: '1rem' }}>{s.region ?? '—'}</span>} hint={s.email ?? s.phone ?? undefined} />
      </div>
      <div className="grid-2">
        <Card title="Staff accounts" padded={false}
          actions={hasHeadmaster ? <Badge tone="good">Headmaster assigned</Badge> : <Button size="sm" onClick={() => setInviting(true)} disabled={s.status !== 'active'}>+ Set Headmaster</Button>}>
          {members.isLoading ? <Spinner /> : !members.data?.length ? (
            <EmptyState title="No headmaster assigned yet">
              Click "+ Set Headmaster" to assign the school headmaster with their login password.
            </EmptyState>
          ) : (
            <div className="table-wrap"><table>
              <thead><tr><th>Name</th><th>Role</th><th>Status</th><th></th></tr></thead>
              <tbody>{members.data.map((m) => (
                <tr key={m.id}><td>{m.profiles?.full_name || '—'}<div className="muted small">{m.profiles?.email}</div></td>
                  <td>{humanize(m.role)}</td><td><Badge value={m.status} /></td>
                  <td className="right"><Button size="sm" variant="ghost" onClick={() => setMemberToggle(m)}>{m.status === 'active' ? 'Disable' : 'Enable'}</Button></td></tr>))}
              </tbody>
            </table></div>
          )}
          {hasHeadmaster && (
            <p className="muted small" style={{ padding: '0 16px 12px' }}>
              Teachers and classes are managed by the school's headmaster from their portal.
            </p>
          )}
        </Card>
        <Card title="Semesters & billing" padded={false}>
          {semesters.isLoading ? <Spinner /> : !semesters.data?.length ? <EmptyState title="No semesters yet">The headmaster sets up the academic calendar.</EmptyState> : (
            <div className="table-wrap"><table>
              <thead><tr><th>Semester</th><th className="num">Due</th><th>Status</th><th></th></tr></thead>
              <tbody>{semesters.data.map((x) => {
                const b = billFor(x.id);
                return (
                  <tr key={x.id}><td>{x.academic_years?.name} · {x.name} {x.is_current && <Badge tone="good">Current</Badge>}</td>
                    <td className="num">{b ? `${b.student_count} × ${formatMoney(b.price_per_student)} = ${formatMoney(b.amount_due)}` : '—'}</td>
                    <td>{b ? <Badge value={b.payment_status} /> : <span className="muted small">Not billed</span>}</td>
                    <td className="right"><Button size="sm" variant="secondary" onClick={() => generate.mutate(x.id)} loading={generate.isPending && generate.variables === x.id}>{b ? 'Recalculate' : 'Generate'}</Button></td></tr>);
              })}</tbody>
            </table></div>
          )}
          <p className="muted small" style={{ padding: '0 16px 12px' }}>Record payments on the <Link to="/admin/billing">Billing</Link> page.</p>
        </Card>
      </div>
      {inviting && <SetHeadmasterModal schoolId={s.id} schoolName={s.name} onClose={() => setInviting(false)} />}
      <ConfirmDialog open={!!statusTo} danger={statusTo !== 'active'} loading={setStatus.isPending}
        title={`${statusTo === 'active' ? 'Activate' : statusTo === 'suspended' ? 'Suspend' : 'Deactivate'} school`}
        confirmLabel={humanize(statusTo === 'active' ? 'activate' : statusTo === 'suspended' ? 'suspend' : 'deactivate')}
        message={statusTo === 'active' ? `Staff of ${s.name} will regain access.` : `All staff of ${s.name} will immediately lose access to school records (headmasters can still view billing). Data is kept.`}
        onCancel={() => setStatusTo(null)} onConfirm={() => statusTo && setStatus.mutate(statusTo)} />
      <ConfirmDialog open={!!memberToggle} danger={memberToggle?.status === 'active'} loading={toggleMember.isPending}
        title={memberToggle?.status === 'active' ? 'Disable account' : 'Enable account'} confirmLabel={memberToggle?.status === 'active' ? 'Disable' : 'Enable'}
        message={`${memberToggle?.profiles?.full_name ?? 'This user'} (${humanize(memberToggle?.role)}) will ${memberToggle?.status === 'active' ? 'lose' : 'regain'} access to ${s.name}.`}
        onCancel={() => setMemberToggle(null)} onConfirm={() => memberToggle && toggleMember.mutate(memberToggle)} />
    </>
  );
}

function SetHeadmasterModal({ schoolId, schoolName, onClose }: { schoolId: string; schoolName: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [v, setV] = useState({ full_name: '', email: '', password: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [createdInfo, setCreatedInfo] = useState<{ email: string; password: string; name: string } | null>(null);

  const generateRandomPassword = () => {
    const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$';
    let res = '';
    for (let i = 0; i < 12; i++) {
      res += chars[Math.floor(Math.random() * chars.length)];
    }
    setV((prev) => ({ ...prev, password: res }));
    setErrors((prev) => ({ ...prev, password: '' }));
  };

  const m = useMutation({
    mutationFn: async () => {
      const parsed = createStaffSchema.safeParse(v);
      if (!parsed.success) { setErrors(fieldErrors(parsed.error)); throw new Error('Please fix the highlighted fields.'); }
      return invokeInvite({ ...parsed.data, role: 'headmaster', school_id: schoolId });
    },
    onSuccess: () => {
      setCreatedInfo({ email: v.email, password: v.password, name: v.full_name });
      qc.invalidateQueries({ queryKey: ['admin_members'] });
      qc.invalidateQueries({ queryKey: ['platform_schools'] });
      toast('Headmaster account created successfully!');
    },
  });

  if (createdInfo) {
    const copyText = `Login credentials for ${schoolName}:\nPortal: ${window.location.origin}/login\nRole: Headmaster\nName: ${createdInfo.name}\nEmail: ${createdInfo.email}\nPassword: ${createdInfo.password}`;
    return (
      <Modal open title="Headmaster Account Created!" onClose={onClose}
        footer={<Button onClick={onClose}>Done</Button>}>
        <Alert tone="success">
          The Headmaster account for <strong>{schoolName}</strong> is now active. They can log in immediately.
        </Alert>
        <div style={{ background: '#f8fafc', padding: 16, borderRadius: 8, margin: '16px 0', border: '1px solid #e2e8f0', color: '#1e293b' }}>
          <p style={{ margin: '6px 0' }}><strong>School:</strong> {schoolName}</p>
          <p style={{ margin: '6px 0' }}><strong>Headmaster:</strong> {createdInfo.name}</p>
          <p style={{ margin: '6px 0' }}><strong>Email:</strong> {createdInfo.email}</p>
          <p style={{ margin: '6px 0' }}><strong>Password:</strong> <code style={{ fontSize: '1.05rem', background: '#e2e8f0', padding: '2px 8px', borderRadius: 4, fontWeight: 'bold' }}>{createdInfo.password}</code></p>
          <p style={{ margin: '6px 0' }}><strong>Portal URL:</strong> <a href="/login" target="_blank" rel="noreferrer">{window.location.origin}/login</a></p>
        </div>
        <Button variant="secondary" onClick={() => {
          navigator.clipboard.writeText(copyText);
          toast('Credentials copied to clipboard!');
        }}>
          📋 Copy Headmaster Credentials
        </Button>
      </Modal>
    );
  }

  return (
    <Modal open title="Set School Headmaster" onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => m.mutate()} loading={m.isPending}>Create Headmaster Account</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        {m.error && <Alert tone="error">{friendlyError(m.error)}</Alert>}
        <Input label="Headmaster Full Name" value={v.full_name} onChange={(e) => setV({ ...v, full_name: e.target.value })} error={errors.full_name} placeholder="e.g. Mrs. Grace Ansah" required />
        <Input label="Headmaster Email" type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} error={errors.email} placeholder="e.g. headmaster@school.com" required />
        <div style={{ position: 'relative' }}>
          <Input label="Password" type="text" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} error={errors.password} placeholder="Minimum 8 characters" required />
          <Button type="button" size="sm" variant="ghost" style={{ position: 'absolute', right: 0, top: 0 }} onClick={generateRandomPassword}>
            ⚡ Generate random
          </Button>
        </div>
        <p className="muted small" style={{ marginTop: 10 }}>
          The headmaster will log in with these credentials to manage classes, teachers, and students.
        </p>
      </form>
    </Modal>
  );
}


