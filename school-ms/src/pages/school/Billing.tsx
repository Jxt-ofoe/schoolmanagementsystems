import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useSchool } from '../../lib/auth';
import { semesterLabel, unwrap, usePlatformSettings, useSemesters } from '../../lib/queries';
import { formatDate, formatMoney, humanize } from '../../lib/format';
import { summarize } from '../../lib/billing';
import type { BillingOverview } from '../../lib/types';
import { Alert, Badge, Card, EmptyState, ErrorBox, PageHeader, Spinner, StatCard } from '../../components/ui';

export default function SchoolBillingPage() {
  const { schoolId } = useSchool();
  const settings = usePlatformSettings();
  const semesters = useSemesters(schoolId);
  const current = semesters.data?.find((s) => s.is_current);
  const bills = useQuery({
    queryKey: ['billing', schoolId],
    queryFn: () => unwrap<BillingOverview[]>(supabase.from('billing_overview').select('*').eq('school_id', schoolId).order('created_at', { ascending: false })),
  });
  const payments = useQuery({
    queryKey: ['payments', schoolId],
    queryFn: () => unwrap<{ id: string; billing_id: string; amount: number; method: string; reference: string | null; paid_on: string; status: string; verification: string }[]>(
      supabase.from('payments').select('id, billing_id, amount, method, reference, paid_on, status, verification').eq('school_id', schoolId).order('paid_on', { ascending: false })),
  });
  const liveCount = useQuery({
    queryKey: ['billable_count', current?.id],
    enabled: !!current,
    queryFn: () => unwrap<number>(supabase.rpc('billable_student_count', { p_semester_id: current!.id })),
  });
  const currentBill = bills.data?.find((b) => b.semester_id === current?.id);
  const price = Number(currentBill?.price_per_student ?? settings.data?.price_per_student ?? 2);
  const estimate = summarize(liveCount.data ?? 0, price, Number(currentBill?.amount_paid ?? 0));

  return (
    <>
      <PageHeader title="Billing" subtitle={`Your school pays ${formatMoney(settings.data?.price_per_student ?? 2)} per registered student per semester. Teachers never pay.`} />
      {current && (
        <Card title={`Current semester · ${semesterLabel(current)}`}>
          <div className="stats">
            <StatCard label="Registered students (live)" value={liveCount.data ?? '…'} hint="unique registrations, excluding voided" />
            <StatCard label="Calculation" value={<span style={{ fontSize: '1.1rem' }}>{estimate.count} × {formatMoney(price)}</span>} />
            <StatCard label={currentBill ? 'Amount due (live)' : 'Estimated amount'} value={formatMoney(estimate.due)} />
            <StatCard label="Balance" value={formatMoney(estimate.balance)} tone={estimate.balance > 0 ? 'warn' : 'good'} />
          </div>
          {currentBill && currentBill.student_count !== (liveCount.data ?? 0) && (
            <Alert tone="info">The invoiced count is {currentBill.student_count} (calculated {formatDate(currentBill.last_calculated_at)}). The platform administrator will refresh it to include later registrations.</Alert>
          )}
          {!currentBill && <Alert tone="info">No invoice has been issued for this semester yet. The figure above is an estimate.</Alert>}
        </Card>
      )}
      <div style={{ height: 16 }} />
      <Card title="Invoices" padded={false}>
        <ErrorBox error={bills.error} />
        {bills.isLoading ? <Spinner /> : !bills.data?.length ? <EmptyState title="No invoices yet" /> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Semester</th><th className="num">Students</th><th>Calculation</th><th className="num">Due</th><th className="num">Paid</th><th className="num">Balance</th><th>Payment</th><th>Renewal</th><th>Due date</th></tr></thead>
            <tbody>{bills.data.map((b) => (
              <tr key={b.id}>
                <td>{b.academic_year_name} · {b.semester_name}</td><td className="num">{b.student_count}</td>
                <td className="nowrap">{b.student_count} × {formatMoney(b.price_per_student, b.currency)}</td>
                <td className="num">{formatMoney(b.amount_due, b.currency)}</td><td className="num">{formatMoney(b.amount_paid, b.currency)}</td>
                <td className="num"><strong>{formatMoney(b.balance, b.currency)}</strong></td>
                <td><Badge value={b.payment_status} /></td><td><Badge value={b.renewal_status} /></td><td>{formatDate(b.due_date)}</td>
              </tr>))}
            </tbody>
          </table></div>
        )}
      </Card>
      <div style={{ height: 16 }} />
      <Card title="Payments received" padded={false}>
        {payments.isLoading ? <Spinner /> : !payments.data?.length ? <EmptyState title="No payments recorded">Payments are recorded by the platform administrator once verified.</EmptyState> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Date</th><th className="num">Amount</th><th>Method</th><th>Reference</th><th>Verification</th><th>Status</th></tr></thead>
            <tbody>{payments.data.map((p) => (
              <tr key={p.id}><td>{formatDate(p.paid_on)}</td><td className="num">{formatMoney(p.amount)}</td><td>{humanize(p.method)}</td>
                <td className="mono">{p.reference ?? '—'}</td><td className="small">{humanize(p.verification)}</td><td><Badge value={p.status} /></td></tr>))}
            </tbody>
          </table></div>
        )}
      </Card>
    </>
  );
}
