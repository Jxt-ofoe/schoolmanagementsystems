import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { unwrap } from '../../lib/queries';
import { paymentSchema, fieldErrors } from '../../lib/validation';
import { friendlyError } from '../../lib/errors';
import { formatDate, formatDateTime, formatMoney, humanize, todayISO } from '../../lib/format';
import { downloadCsv } from '../../lib/csv';
import { useToast } from '../../lib/toast';
import type { BillingOverview } from '../../lib/types';
import { Alert, Badge, Button, Card, ConfirmDialog, EmptyState, ErrorBox, Input, Modal, PageHeader, SearchBox, Select, Spinner, StatCard, Textarea } from '../../components/ui';

export default function AdminBilling() {
  const qc = useQueryClient();
  const toast = useToast();
  const [currentOnly, setCurrentOnly] = useState(true);
  const [pStatus, setPStatus] = useState('');
  const [q, setQ] = useState('');
  const [paying, setPaying] = useState<BillingOverview | null>(null);
  const [viewing, setViewing] = useState<BillingOverview | null>(null);
  const [terms, setTerms] = useState<BillingOverview | null>(null);
  const [confirmRefresh, setConfirmRefresh] = useState(false);

  const bills = useQuery({
    queryKey: ['admin_billing', currentOnly],
    queryFn: async () => {
      let qy = supabase.from('billing_overview').select('*').order('school_name');
      if (currentOnly) qy = qy.eq('is_current', true);
      return unwrap<BillingOverview[]>(qy);
    },
  });
  const refresh = useMutation({
    mutationFn: async () => unwrap<number>(supabase.rpc('refresh_current_billing')),
    onSuccess: (n) => { toast(`Billing refreshed for ${n} school semester(s)`); setConfirmRefresh(false); qc.invalidateQueries({ queryKey: ['admin_billing'] }); },
    onError: (e) => { toast(friendlyError(e), 'error'); setConfirmRefresh(false); },
  });

  const rows = (bills.data ?? []).filter((b) => (!pStatus || b.payment_status === pStatus || b.renewal_status === pStatus)
    && (!q || `${b.school_name} ${b.school_code}`.toLowerCase().includes(q.toLowerCase())));
  const totals = rows.reduce((t, b) => ({ due: t.due + Number(b.amount_due), paid: t.paid + Number(b.amount_paid), bal: t.bal + Number(b.balance), students: t.students + b.student_count }), { due: 0, paid: 0, bal: 0, students: 0 });

  return (
    <>
      <PageHeader title="Semester billing" subtitle="Schools pay per registered student per semester. Payments are only recorded after you verify them."
        actions={<><Button variant="secondary" onClick={() => downloadCsv('billing.csv', rows as unknown as Record<string, unknown>[], [
          { key: 'school_name', label: 'School' }, { key: 'academic_year_name', label: 'Year' }, { key: 'semester_name', label: 'Semester' },
          { key: 'student_count', label: 'Students' }, { key: 'price_per_student', label: 'Price' }, { key: 'amount_due', label: 'Due' },
          { key: 'amount_paid', label: 'Paid' }, { key: 'balance', label: 'Balance' }, { key: 'payment_status', label: 'Payment status' },
          { key: 'renewal_status', label: 'Renewal' }, { key: 'due_date', label: 'Due date' }])} disabled={!rows.length}>Export CSV</Button>
          <Button onClick={() => setConfirmRefresh(true)}>Generate / refresh current semesters</Button></>} />
      <div className="stats">
        <StatCard label="Registered students" value={totals.students} />
        <StatCard label="Total due" value={formatMoney(totals.due)} />
        <StatCard label="Paid" value={formatMoney(totals.paid)} tone="good" />
        <StatCard label="Outstanding" value={formatMoney(totals.bal)} tone={totals.bal > 0 ? 'warn' : 'good'} />
      </div>
      <Card padded={false}>
        <div className="filters" style={{ padding: '12px 16px 0' }}>
          <SearchBox value={q} onChange={setQ} placeholder="Search schools" />
          <Select label="Show" value={currentOnly ? 'current' : 'all'} onChange={(e) => setCurrentOnly(e.target.value === 'current')}>
            <option value="current">Current semesters</option><option value="all">All semesters</option>
          </Select>
          <Select label="Status" value={pStatus} onChange={(e) => setPStatus(e.target.value)}>
            <option value="">Any</option><option value="unpaid">Unpaid</option><option value="partial">Partial</option><option value="paid">Paid</option>
            <option value="overpaid">Overpaid</option><option value="overdue">Overdue</option><option value="renewed">Renewed</option>
          </Select>
        </div>
        <ErrorBox error={bills.error} onRetry={() => bills.refetch()} />
        {bills.isLoading ? <Spinner /> : !rows.length ? <EmptyState title="No billing records">Use “Generate / refresh” to create records for each school's current semester.</EmptyState> : (
          <div className="table-wrap"><table>
            <thead><tr><th>School</th><th>Semester</th><th>Calculation</th><th className="num">Due</th><th className="num">Paid</th><th className="num">Balance</th><th>Payment</th><th>Renewal</th><th></th></tr></thead>
            <tbody>{rows.map((b) => (
              <tr key={b.id}>
                <td><Link to={`/admin/schools/${b.school_id}`}>{b.school_name}</Link></td>
                <td className="small">{b.academic_year_name} · {b.semester_name}<div className="muted">due {formatDate(b.due_date)}</div></td>
                <td className="nowrap">{b.student_count} × {formatMoney(b.price_per_student, b.currency)}</td>
                <td className="num">{formatMoney(b.amount_due, b.currency)}</td><td className="num">{formatMoney(b.amount_paid, b.currency)}</td>
                <td className="num"><strong>{formatMoney(b.balance, b.currency)}</strong></td>
                <td><Badge value={b.payment_status} /></td><td><Badge value={b.renewal_status} /></td>
                <td><div className="table-actions">
                  <Button size="sm" onClick={() => setPaying(b)}>Record payment</Button>
                  <Button size="sm" variant="ghost" onClick={() => setViewing(b)}>Payments</Button>
                  <Button size="sm" variant="ghost" onClick={() => setTerms(b)}>Terms</Button>
                </div></td>
              </tr>))}
            </tbody>
          </table></div>
        )}
      </Card>
      {paying && <PaymentModal bill={paying} onClose={() => setPaying(null)} />}
      {viewing && <PaymentsList bill={viewing} onClose={() => setViewing(null)} />}
      {terms && <TermsModal bill={terms} onClose={() => setTerms(null)} />}
      <ConfirmDialog open={confirmRefresh} title="Generate / refresh billing" confirmLabel="Generate" loading={refresh.isPending}
        message="Creates a billing record for every active school's current semester, or recalculates the student count on existing records. Existing prices are kept; new records use the current platform price. All changes are audited."
        onCancel={() => setConfirmRefresh(false)} onConfirm={() => refresh.mutate()} />
    </>
  );
}

function PaymentModal({ bill, onClose }: { bill: BillingOverview; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [v, setV] = useState({ amount: String(Math.max(0, Number(bill.balance)).toFixed(2)), method: 'mobile_money', reference: '', paid_on: todayISO(), notes: '' });
  const [confirmed, setConfirmed] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: async () => {
      const parsed = paymentSchema.safeParse(v);
      if (!parsed.success) { setErrors(fieldErrors(parsed.error)); throw new Error('Please fix the highlighted fields.'); }
      if (!confirmed) throw new Error('Confirm that you have verified this payment.');
      const { error } = await supabase.rpc('record_payment', { p_billing_id: bill.id, p_amount: parsed.data.amount, p_method: parsed.data.method,
        p_reference: parsed.data.reference, p_paid_on: parsed.data.paid_on, p_notes: parsed.data.notes });
      if (error) throw error;
    },
    onSuccess: () => { toast('Payment recorded'); qc.invalidateQueries({ queryKey: ['admin_billing'] }); qc.invalidateQueries({ queryKey: ['payments_for'] }); onClose(); },
  });
  return (
    <Modal open title={`Record payment · ${bill.school_name}`} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => m.mutate()} loading={m.isPending} disabled={!confirmed}>Record payment</Button></>}>
      {m.error && <Alert tone="error">{friendlyError(m.error)}</Alert>}
      <p className="muted small">{bill.academic_year_name} · {bill.semester_name} · balance {formatMoney(bill.balance)}</p>
      <div className="form-grid">
        <Input label="Amount (GH₵)" type="number" min={0.01} step="0.01" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} error={errors.amount} required />
        <Input label="Date received" type="date" max={todayISO()} value={v.paid_on} onChange={(e) => setV({ ...v, paid_on: e.target.value })} error={errors.paid_on} required />
        <Select label="Method" value={v.method} onChange={(e) => setV({ ...v, method: e.target.value })}>
          <option value="mobile_money">Mobile money</option><option value="bank_transfer">Bank transfer</option><option value="cash">Cash</option>
          <option value="cheque">Cheque</option><option value="card">Card</option><option value="other">Other</option>
        </Select>
        <Input label="Reference / receipt no." value={v.reference} onChange={(e) => setV({ ...v, reference: e.target.value })} error={errors.reference} hint="Prevents recording the same receipt twice" />
      </div>
      <Textarea label="Notes" value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} />
      <label className="checkbox"><input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        I have verified that this money was received (statement, MoMo confirmation or receipt).</label>
    </Modal>
  );
}

function PaymentsList({ bill, onClose }: { bill: BillingOverview; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [voiding, setVoiding] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const payments = useQuery({
    queryKey: ['payments_for', bill.id],
    queryFn: () => unwrap<{ id: string; amount: number; method: string; reference: string | null; paid_on: string; status: string; void_reason: string | null; created_at: string; verification: string }[]>(
      supabase.from('payments').select('*').eq('billing_id', bill.id).order('created_at', { ascending: false })),
  });
  const v = useMutation({
    mutationFn: async () => { const { error } = await supabase.rpc('void_payment', { p_payment_id: voiding, p_reason: reason }); if (error) throw error; },
    onSuccess: () => { toast('Payment voided'); setVoiding(null); setReason(''); qc.invalidateQueries({ queryKey: ['payments_for'] }); qc.invalidateQueries({ queryKey: ['admin_billing'] }); },
    onError: (e) => toast(friendlyError(e), 'error'),
  });
  return (
    <Modal open wide title={`Payments · ${bill.school_name} · ${bill.semester_name}`} onClose={onClose} footer={<Button onClick={onClose}>Close</Button>}>
      {payments.isLoading ? <Spinner /> : !payments.data?.length ? <EmptyState title="No payments recorded" /> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Received</th><th className="num">Amount</th><th>Method</th><th>Reference</th><th>Status</th><th></th></tr></thead>
          <tbody>{payments.data.map((p) => (
            <tr key={p.id}><td>{formatDate(p.paid_on)}<div className="muted small">recorded {formatDateTime(p.created_at)}</div></td>
              <td className="num">{formatMoney(p.amount)}</td><td>{humanize(p.method)}</td><td className="mono">{p.reference ?? '—'}</td>
              <td><Badge value={p.status} />{p.void_reason && <div className="muted small">{p.void_reason}</div>}</td>
              <td className="right">{p.status === 'valid' && <Button size="sm" variant="ghost" onClick={() => setVoiding(p.id)}>Void</Button>}</td></tr>))}
          </tbody>
        </table></div>
      )}
      <ConfirmDialog open={!!voiding} danger title="Void payment" confirmLabel="Void payment" loading={v.isPending}
        message="Voiding reverses this payment on the balance. The record is kept and the action is audited." onCancel={() => setVoiding(null)} onConfirm={() => v.mutate()}>
        <Textarea label="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
      </ConfirmDialog>
    </Modal>
  );
}

function TermsModal({ bill, onClose }: { bill: BillingOverview; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [price, setPrice] = useState(String(bill.price_per_student));
  const [due, setDue] = useState(bill.due_date ?? '');
  const [notes, setNotes] = useState(bill.notes ?? '');
  const m = useMutation({
    mutationFn: async () => {
      const p = Number(price);
      if (Number.isNaN(p) || p < 0) throw new Error('Enter a valid price');
      const { error } = await supabase.rpc('update_billing_terms', { p_billing_id: bill.id, p_price_per_student: p, p_due_date: due || null, p_notes: notes || null });
      if (error) throw error;
    },
    onSuccess: () => { toast('Billing terms updated'); qc.invalidateQueries({ queryKey: ['admin_billing'] }); onClose(); },
  });
  return (
    <Modal open title={`Billing terms · ${bill.school_name}`} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => m.mutate()} loading={m.isPending}>Save</Button></>}>
      {m.error && <Alert tone="error">{friendlyError(m.error)}</Alert>}
      <Input label="Price per student (GH₵)" type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)}
        hint={`Amount due becomes ${bill.student_count} × ${formatMoney(Number(price) || 0)} = ${formatMoney(bill.student_count * (Number(price) || 0))}`} />
      <Input label="Due date" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
      <Textarea label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <p className="muted small">Changes are recorded in the audit log with the old and new values.</p>
    </Modal>
  );
}
