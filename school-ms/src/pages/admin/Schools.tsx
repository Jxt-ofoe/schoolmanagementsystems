import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { unwrap } from '../../lib/queries';
import { schoolSchema, fieldErrors } from '../../lib/validation';
import { friendlyError } from '../../lib/errors';
import { formatMoney, slugify } from '../../lib/format';
import { useToast } from '../../lib/toast';
import { invokeInvite } from '../school/Teachers';
import { Alert, Badge, Button, Card, EmptyState, ErrorBox, Input, Modal, PageHeader, SearchBox, Select, Spinner } from '../../components/ui';

export interface SchoolSummary {
  school_id: string; name: string; code: string; status: string; region: string | null; created_at: string; headmasters: string | null;
  teachers: number; students_active: number; current_semester_id: string | null; current_semester: string | null; registered_current: number;
  billing_id: string | null; amount_due: number | null; amount_paid: number | null; balance: number | null;
}

export default function AdminSchools() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const schools = useQuery({ queryKey: ['platform_schools'], queryFn: () => unwrap<SchoolSummary[]>(supabase.rpc('platform_school_summaries')) });
  const rows = (schools.data ?? []).filter((s) => (!status || s.status === status) && (!q || `${s.name} ${s.code} ${s.region ?? ''}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <>
      <PageHeader title="Schools" subtitle={`${schools.data?.length ?? '…'} schools on the platform`} actions={<Button onClick={() => setCreating(true)}>+ New school</Button>} />
      <Card padded={false}>
        <div className="filters" style={{ padding: '12px 16px 0' }}>
          <SearchBox value={q} onChange={setQ} placeholder="Search by name, code or region" />
          <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All</option><option value="active">Active</option><option value="pending">Pending</option><option value="suspended">Suspended</option><option value="inactive">Inactive</option>
          </Select>
        </div>
        <ErrorBox error={schools.error} onRetry={() => schools.refetch()} />
        {schools.isLoading ? <Spinner /> : !rows.length ? <EmptyState title="No schools" action={!q && <Button onClick={() => setCreating(true)}>Add the first school</Button>} /> : (
          <div className="table-wrap"><table>
            <thead><tr><th>School</th><th>Headmaster</th><th className="num">Students</th><th className="num">Teachers</th><th>Current semester</th><th className="num">Registered</th><th className="num">Balance</th><th>Status</th></tr></thead>
            <tbody>{rows.map((s) => (
              <tr key={s.school_id} className="clickable" onClick={() => navigate(`/admin/schools/${s.school_id}`)}>
                <td><Link to={`/admin/schools/${s.school_id}`} onClick={(e) => e.stopPropagation()}><strong>{s.name}</strong></Link><div className="muted small mono">{s.code}{s.region ? ` · ${s.region}` : ''}</div></td>
                <td className="small">{s.headmasters ?? <span className="muted">None yet</span>}</td>
                <td className="num">{s.students_active}</td><td className="num">{s.teachers}</td>
                <td className="small">{s.current_semester ?? '—'}</td><td className="num">{s.registered_current}</td>
                <td className="num">{s.billing_id ? formatMoney(s.balance) : <span className="muted small">not billed</span>}</td>
                <td><Badge value={s.status} /></td>
              </tr>))}
            </tbody>
          </table></div>
        )}
      </Card>
      {creating && <CreateSchoolModal onClose={() => setCreating(false)} onCreated={(id) => navigate(`/admin/schools/${id}`)} />}
    </>
  );
}

function CreateSchoolModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [v, setV] = useState({ name: '', code: '', region: '', email: '', phone: '', address: '', status: 'active' as const });
  const [hm, setHm] = useState({ full_name: '', email: '', password: '' });
  const [codeTouched, setCodeTouched] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [createdInfo, setCreatedInfo] = useState<{ schoolId: string; schoolName: string; email: string; password: string; name: string } | null>(null);

  const generateRandomPassword = () => {
    const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$';
    let res = '';
    for (let i = 0; i < 12; i++) {
      res += chars[Math.floor(Math.random() * chars.length)];
    }
    setHm((prev) => ({ ...prev, password: res }));
    setErrors((prev) => ({ ...prev, password: '' }));
  };

  const m = useMutation({
    mutationFn: async () => {
      const parsed = schoolSchema.safeParse(v);
      if (!parsed.success) { setErrors(fieldErrors(parsed.error)); throw new Error('Please fix the highlighted school fields.'); }
      
      if (!hm.full_name.trim()) throw new Error('Please enter the Headmaster full name.');
      if (!hm.email.trim() || !hm.email.includes('@')) throw new Error('Please enter a valid Headmaster email.');
      if (!hm.password || hm.password.length < 8) throw new Error('Headmaster password must be at least 8 characters.');

      // 1. Create school
      const { data, error } = await supabase.from('schools').insert(parsed.data).select('id, name').single();
      if (error) throw error;
      const schoolId = data.id as string;

      // 2. Create headmaster account with password
      await invokeInvite({
        school_id: schoolId,
        full_name: hm.full_name.trim(),
        email: hm.email.trim().toLowerCase(),
        password: hm.password,
        role: 'headmaster',
      });

      return { schoolId, schoolName: data.name };
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['platform_schools'] });
      setCreatedInfo({
        schoolId: res.schoolId,
        schoolName: res.schoolName,
        email: hm.email,
        password: hm.password,
        name: hm.full_name,
      });
      toast('School and Headmaster account created successfully!');
    },
  });

  if (createdInfo) {
    const copyText = `Login credentials for ${createdInfo.schoolName}:\nPortal: ${window.location.origin}/login\nRole: Headmaster\nName: ${createdInfo.name}\nEmail: ${createdInfo.email}\nPassword: ${createdInfo.password}`;
    return (
      <Modal open title="School & Headmaster Created!" onClose={() => onCreated(createdInfo.schoolId)}
        footer={<Button onClick={() => onCreated(createdInfo.schoolId)}>Go to School Details →</Button>}>
        <Alert tone="success">
          <strong>{createdInfo.schoolName}</strong> is registered and the Headmaster account is fully active!
        </Alert>
        <div style={{ background: '#f8fafc', padding: 16, borderRadius: 8, margin: '16px 0', border: '1px solid #e2e8f0', color: '#1e293b' }}>
          <p style={{ margin: '6px 0' }}><strong>School:</strong> {createdInfo.schoolName}</p>
          <p style={{ margin: '6px 0' }}><strong>Headmaster:</strong> {createdInfo.name}</p>
          <p style={{ margin: '6px 0' }}><strong>Email:</strong> {createdInfo.email}</p>
          <p style={{ margin: '6px 0' }}><strong>Password:</strong> <code style={{ fontSize: '1.05rem', background: '#e2e8f0', padding: '2px 8px', borderRadius: 4, fontWeight: 'bold' }}>{createdInfo.password}</code></p>
          <p style={{ margin: '6px 0' }}><strong>Portal URL:</strong> <a href="/login" target="_blank" rel="noreferrer">{window.location.origin}/login</a></p>
        </div>
        <Button variant="secondary" onClick={() => {
          navigator.clipboard.writeText(copyText);
          toast('Headmaster credentials copied to clipboard!');
        }}>
          📋 Copy Headmaster Credentials
        </Button>
      </Modal>
    );
  }

  return (
    <Modal open title="New School & Headmaster" onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => m.mutate()} loading={m.isPending}>Create School & Headmaster</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        {m.error && <Alert tone="error">{friendlyError(m.error)}</Alert>}
        
        <h3 style={{ margin: '0 0 12px', fontSize: '1rem', color: '#0f5132' }}>1. School Details</h3>
        <Input label="School name" value={v.name} error={errors.name} placeholder="e.g. Saint Dominic Savio" required
          onChange={(e) => setV({ ...v, name: e.target.value, code: codeTouched ? v.code : slugify(e.target.value) })} />
        <Input label="School code" value={v.code} error={errors.code} hint="Unique short identifier, e.g. saint-dominic-savio" required
          onChange={(e) => { setCodeTouched(true); setV({ ...v, code: e.target.value.toLowerCase() }); }} />
        <div className="form-grid">
          <Input label="Region" value={v.region} onChange={(e) => setV({ ...v, region: e.target.value })} placeholder="e.g. Greater Accra" />
          <Select label="Initial status" value={v.status} onChange={(e) => setV({ ...v, status: e.target.value as typeof v.status })}>
            <option value="active">Active</option><option value="pending">Pending activation</option>
          </Select>
          <Input label="School Email" type="email" value={v.email} error={errors.email} onChange={(e) => setV({ ...v, email: e.target.value })} />
          <Input label="School Phone" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} />
        </div>
        <Input label="Address" value={v.address} onChange={(e) => setV({ ...v, address: e.target.value })} />

        <hr style={{ margin: '20px 0 16px', border: '0', borderTop: '1px solid #e2e8f0' }} />

        <h3 style={{ margin: '0 0 12px', fontSize: '1rem', color: '#0f5132' }}>2. Headmaster Account (Login Credentials)</h3>
        <Input label="Headmaster Full Name" value={hm.full_name} error={errors.full_name} placeholder="e.g. Mr. Kwesi Mensah" required
          onChange={(e) => setHm({ ...hm, full_name: e.target.value })} />
        <Input label="Headmaster Email" type="email" value={hm.email} error={errors.email} placeholder="e.g. headmaster@school.com" required
          onChange={(e) => setHm({ ...hm, email: e.target.value })} />
        <div style={{ position: 'relative' }}>
          <Input label="Headmaster Password" type="text" value={hm.password} error={errors.password} placeholder="Minimum 8 characters" required
            onChange={(e) => setHm({ ...hm, password: e.target.value })} />
          <Button type="button" size="sm" variant="ghost" style={{ position: 'absolute', right: 0, top: 0 }} onClick={generateRandomPassword}>
            ⚡ Generate random
          </Button>
        </div>
        <p className="muted small" style={{ marginTop: 6 }}>
          The headmaster can log in immediately with this email and password to set up classes, subjects, and teachers.
        </p>
      </form>
    </Modal>
  );
}

