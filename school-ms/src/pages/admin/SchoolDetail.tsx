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
import { Alert, Badge, Button, Card, ConfirmDialog, EmptyState, ErrorBox, Input, Modal, PageHeader, Select, Spinner, StatCard, Textarea } from '../../components/ui';

interface School { id: string; name: string; code: string; status: string; email: string | null; phone: string | null; address: string | null; region: string | null; logo_url?: string | null; created_at: string }
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
  const bills = useQuery({
    queryKey: ['admin_bills', schoolId],
    queryFn: () => unwrap<BillingOverview[]>(supabase.from('billing_overview').select('*').eq('school_id', schoolId!).order('created_at', { ascending: false })),
  });
  const billingConfig = useQuery({
    queryKey: ['admin_school_billing_config', schoolId],
    queryFn: async () => {
      try {
        return await unwrap<any>(supabase.from('school_billing_configs').select('*').eq('school_id', schoolId!).maybeSingle());
      } catch (err: any) {
        if (err?.code === 'PGRST205' || err?.message?.includes('schema cache')) return null;
        throw err;
      }
    },
  });
  const cardAuth = useQuery({
    queryKey: ['admin_school_card_auth', schoolId],
    queryFn: async () => {
      try {
        return await unwrap<any>(supabase.from('payment_authorizations').select('*').eq('school_id', schoolId!).maybeSingle());
      } catch (err: any) {
        if (err?.code === 'PGRST205' || err?.message?.includes('schema cache')) return null;
        throw err;
      }
    },
  });
  const [configuringBilling, setConfiguringBilling] = useState(false);
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

  if (school.isLoading) return <Spinner />;
  if (school.error) return <ErrorBox error={school.error} />;
  const s = school.data!;

  const hasHeadmaster = members.data?.some((m) => m.role === 'headmaster');

  return (
    <>
      <PageHeader
        back={<Link to="/admin/schools">← Schools</Link>}
        title={
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
            {s.logo_url && (
              <img
                src={s.logo_url}
                alt={s.name}
                width="36"
                height="36"
                style={{ objectFit: 'contain', borderRadius: 4, background: '#fff', border: '1px solid var(--line, #e2e8f0)' }}
              />
            )}
            <span>{s.name}</span>
          </div>
        }
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
        <Card
          title="Billing arrangement & subscription"
          padded={false}
          actions={
            <Button size="sm" onClick={() => setConfiguringBilling(true)}>
              Configure Arrangement
            </Button>
          }
        >
          <div style={{ padding: '16px' }}>
            <div className="grid-2" style={{ gap: 12 }}>
              <div className="kv">
                <span>Pricing Rate:</span>
                <strong style={{ color: 'var(--primary)', fontSize: '1.05rem' }}>
                  {formatMoney(billingConfig.data?.price_per_student ?? 3.0)} / student / term
                </strong>
              </div>
              <div className="kv">
                <span>Billing Frequency:</span>
                <Badge
                  value="Per Term"
                  tone="good"
                />
              </div>
              <div className="kv">
                <span>Subscription Status:</span>
                <Badge
                  value={billingConfig.data?.status || 'active'}
                  tone={
                    (billingConfig.data?.status || 'active') === 'active'
                      ? 'good'
                      : billingConfig.data?.status === 'grace_period'
                        ? 'warn'
                        : 'bad'
                  }
                />
              </div>
              <div className="kv">
                <span>Next Billing Date:</span>
                <strong>{formatDate(billingConfig.data?.next_billing_date) || '—'}</strong>
              </div>
              <div className="kv">
                <span>Payment Terms:</span>
                <span>
                  {billingConfig.data?.due_days ?? 14} days due · {billingConfig.data?.grace_period_days ?? 7} days grace
                </span>
              </div>
              <div className="kv">
                <span>Fee Markup (3%):</span>
                <span>
                  {billingConfig.data?.pass_fee_markup !== false
                    ? `${billingConfig.data?.fee_markup_percent ?? 3}% Passed to school`
                    : 'Absorbed'}
                </span>
              </div>
              <div className="kv">
                <span>Special Discount:</span>
                <span>
                  {billingConfig.data?.discount_type === 'percentage'
                    ? `${billingConfig.data?.discount_value}% off`
                    : billingConfig.data?.discount_type === 'fixed'
                      ? `GH₵ ${billingConfig.data?.discount_value} off`
                      : 'None'}
                </span>
              </div>
              <div className="kv">
                <span>Saved Card for Recurring:</span>
                <span>
                  {cardAuth.data
                    ? `💳 ${cardAuth.data.card_type?.toUpperCase()} •••• ${cardAuth.data.last4} (${cardAuth.data.bank || 'Bank'})`
                    : 'No card on file'}
                </span>
              </div>
            </div>
          </div>
          <div style={{ borderTop: '1px solid var(--border)', padding: '12px 16px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <strong>Invoices & Payments ({bills.data?.length ?? 0})</strong>
              <Link to="/admin/billing" className="small">
                Manage all on Billing Page →
              </Link>
            </div>
            {bills.isLoading ? (
              <Spinner />
            ) : !bills.data?.length ? (
              <EmptyState title="No invoices issued yet" />
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Period</th>
                      <th className="num">Students</th>
                      <th className="num">Due</th>
                      <th className="num">Paid</th>
                      <th className="num">Balance</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bills.data.map((b) => (
                      <tr key={b.id}>
                        <td>{b.period_label || b.semester_name || 'Invoice'}</td>
                        <td className="num">{b.student_count}</td>
                        <td className="num">{formatMoney(b.total_payable ?? b.amount_due)}</td>
                        <td className="num">{formatMoney(b.amount_paid)}</td>
                        <td className="num">
                          <strong style={{ color: b.balance > 0 ? 'var(--warn)' : 'var(--green)' }}>
                            {formatMoney(b.balance)}
                          </strong>
                        </td>
                        <td>
                          <Badge value={b.payment_status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </Card>
      </div>

      {configuringBilling && (
        <SchoolBillingConfigModal
          schoolId={s.id}
          schoolName={s.name}
          initialConfig={billingConfig.data}
          onClose={() => setConfiguringBilling(false)}
        />
      )}
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
        <p className="muted small" style={{ marginBottom: 12 }}>
          Temporary password generated — share once; the user should change this password at first login.
        </p>
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
          Temporary password generated — share once; the user should change this password at first login. The headmaster will log in with these credentials to manage classes, teachers, and students.
        </p>
      </form>
    </Modal>
  );
}

function SchoolBillingConfigModal({
  schoolId,
  schoolName,
  initialConfig,
  onClose,
}: {
  schoolId: string;
  schoolName: string;
  initialConfig?: any;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();

  const [price, setPrice] = useState(String(initialConfig?.price_per_student ?? 3.0));
  const [startDate, setStartDate] = useState(initialConfig?.billing_start_date ?? new Date().toISOString().slice(0, 10));
  const [nextDate, setNextDate] = useState(initialConfig?.next_billing_date ?? '');
  const [dueDays, setDueDays] = useState(String(initialConfig?.due_days ?? 14));
  const [graceDays, setGraceDays] = useState(String(initialConfig?.grace_period_days ?? 7));
  const [discountType, setDiscountType] = useState<'none' | 'fixed' | 'percentage'>(initialConfig?.discount_type ?? 'none');
  const [discountValue, setDiscountValue] = useState(String(initialConfig?.discount_value ?? 0));
  const [passMarkup, setPassMarkup] = useState(initialConfig?.pass_fee_markup !== false);
  const [markupPercent, setMarkupPercent] = useState(String(initialConfig?.fee_markup_percent ?? 3.0));
  const [autoCharge] = useState(initialConfig?.auto_charge_card ?? false);
  const [status, setStatus] = useState(initialConfig?.status ?? 'active');
  const [notes, setNotes] = useState(initialConfig?.notes ?? '');

  const save = useMutation({
    mutationFn: async () => {
      const p = Number(price);
      if (Number.isNaN(p) || p < 0) throw new Error('Enter a valid price per student');

      const { error } = await supabase.rpc('upsert_school_billing_config', {
        p_school_id: schoolId,
        p_price_per_student: p,
        p_billing_frequency: 'term',
        p_billing_start_date: startDate,
        p_next_billing_date: nextDate || null,
        p_due_days: Number(dueDays) || 14,
        p_grace_period_days: Number(graceDays) || 7,
        p_discount_type: discountType,
        p_discount_value: Number(discountValue) || 0,
        p_pass_fee_markup: passMarkup,
        p_fee_markup_percent: Number(markupPercent) || 3.0,
        p_auto_charge_card: autoCharge,
        p_status: status,
        p_notes: notes || null,
      });

      if (error) throw error;
    },
    onSuccess: () => {
      toast('School billing arrangement updated successfully');
      qc.invalidateQueries({ queryKey: ['admin_school_billing_config', schoolId] });
      qc.invalidateQueries({ queryKey: ['admin_bills', schoolId] });
      qc.invalidateQueries({ queryKey: ['admin_billing'] });
      onClose();
    },
    onError: (e) => toast(friendlyError(e), 'error'),
  });

  return (
    <Modal
      open
      wide
      title={`Configure Billing Arrangement · ${schoolName}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => save.mutate()} loading={save.isPending}>
            Save Billing Arrangement
          </Button>
        </>
      }
    >
      {save.error && <Alert tone="error">{friendlyError(save.error)}</Alert>}

      <div className="form-grid">
        <Input
          label="Price per student per term (GH₵)"
          type="number"
          step="0.01"
          min="0"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          hint="Configured term price for this specific school (default GHS 3.00)"
          required
        />
        <Input
          label="Billing Frequency"
          value="Per Term"
          disabled
        />
        <Input
          label="Billing Start Date"
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
        />
        <Input
          label="Next Billing Date"
          type="date"
          value={nextDate}
          onChange={(e) => setNextDate(e.target.value)}
        />
        <Input
          label="Payment Deadline (Days)"
          type="number"
          min="1"
          value={dueDays}
          onChange={(e) => setDueDays(e.target.value)}
        />
        <Input
          label="Grace Period (Days)"
          type="number"
          min="0"
          value={graceDays}
          onChange={(e) => setGraceDays(e.target.value)}
        />
        <Select
          label="Special Discount"
          value={discountType}
          onChange={(e) => setDiscountType(e.target.value as any)}
        >
          <option value="none">No Discount</option>
          <option value="percentage">Percentage (%) Discount</option>
          <option value="fixed">Fixed Amount (GH₵) Discount</option>
        </Select>
        {discountType !== 'none' && (
          <Input
            label={discountType === 'percentage' ? 'Discount Percentage (%)' : 'Discount Amount (GH₵)'}
            type="number"
            step="0.01"
            min="0"
            value={discountValue}
            onChange={(e) => setDiscountValue(e.target.value)}
          />
        )}
      </div>

      <div style={{ marginTop: 16 }} className="form-grid">
        <Select
          label="Subscription Status"
          value={status}
          onChange={(e) => setStatus(e.target.value as any)}
        >
          <option value="active">Active</option>
          <option value="payment_pending">Payment Pending</option>
          <option value="payment_overdue">Payment Overdue</option>
          <option value="grace_period">Grace Period</option>
          <option value="suspended">Suspended (Access blocked; records preserved)</option>
          <option value="cancelled">Cancelled</option>
        </Select>
        <Input
          label="Payment Fee Markup (%)"
          type="number"
          step="0.1"
          min="0"
          value={markupPercent}
          onChange={(e) => setMarkupPercent(e.target.value)}
          hint="Official 3% payment processing markup"
        />
      </div>

      <div style={{ marginTop: 16 }}>
        <label className="checkbox" style={{ display: 'block', marginBottom: 8 }}>
          <input
            type="checkbox"
            checked={passMarkup}
            onChange={(e) => setPassMarkup(e.target.checked)}
          />
          <strong>Pass 3% Paystack payment fee to school</strong> (Itemized clearly on checkout)
        </label>
      </div>

      <div style={{ marginTop: 16 }}>
        <Textarea
          label="Billing Notes / Special Agreement"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>
    </Modal>
  );
}


