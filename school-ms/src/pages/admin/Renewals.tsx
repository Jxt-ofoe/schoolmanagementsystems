import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { unwrap, usePlatformSettings } from '../../lib/queries';
import { formatDate, formatMoney } from '../../lib/format';
import { downloadCsv } from '../../lib/csv';
import { useToast } from '../../lib/toast';
import { friendlyError } from '../../lib/errors';
import type { BillingOverview } from '../../lib/types';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorBox,
  PageHeader,
  SearchBox,
  Select,
  Spinner,
  StatCard,
  Tabs,
} from '../../components/ui';

export default function RenewalsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const settings = usePlatformSettings();

  const [activeTab, setActiveTab] = useState<'current' | 'all' | 'overdue'>('current');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [confirmInvoice, setConfirmInvoice] = useState<BillingOverview | null>(null);

  const billsQuery = useQuery({
    queryKey: ['admin_renewals_all'],
    queryFn: () =>
      unwrap<BillingOverview[]>(
        supabase.from('billing_overview').select('*').order('due_date', { ascending: true })
      ),
  });

  const allBills = billsQuery.data ?? [];

  // Filter bills
  const filtered = allBills.filter((b) => {
    if (activeTab === 'current' && !b.is_current) return false;
    if (activeTab === 'overdue' && (b.renewal_status !== 'overdue' && b.balance <= 0)) return false;
    if (statusFilter && b.renewal_status !== statusFilter && b.payment_status !== statusFilter) return false;
    if (
      searchTerm &&
      !`${b.school_name} ${b.school_code}`.toLowerCase().includes(searchTerm.toLowerCase())
    )
      return false;
    return true;
  });

  const totals = filtered.reduce(
    (acc, b) => ({
      students: acc.students + b.student_count,
      due: acc.due + Number(b.amount_due),
      paid: acc.paid + Number(b.amount_paid),
      balance: acc.balance + Number(b.balance),
    }),
    { students: 0, due: 0, paid: 0, balance: 0 }
  );

  const issueInvoiceMutation = useMutation({
    mutationFn: async (billingId: string) => {
      const invNumber = `INV-${Date.now().toString(36).toUpperCase()}`;
      const { error } = await supabase
        .from('semester_billing')
        .update({
          invoice_number: invNumber,
          subscription_status: 'awaiting_payment',
        })
        .eq('id', billingId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast('Semester invoice issued!');
      setConfirmInvoice(null);
      qc.invalidateQueries({ queryKey: ['admin_renewals_all'] });
      qc.invalidateQueries({ queryKey: ['admin_billing'] });
    },
    onError: (err) => {
      toast(friendlyError(err), 'error');
    },
  });

  return (
    <>
      <PageHeader
        title="Semester Renewals & Billing"
        subtitle={`Platform pricing model: ${formatMoney(settings.data?.price_per_student ?? 2.0)} per registered student per semester.`}
        actions={
          <Button
            variant="secondary"
            onClick={() =>
              downloadCsv('renewals.csv', filtered as any, [
                { key: 'school_name', label: 'School' },
                { key: 'semester_name', label: 'Semester' },
                { key: 'student_count', label: 'Registered Students' },
                { key: 'amount_due', label: 'Amount Due (GH₵)' },
                { key: 'amount_paid', label: 'Amount Paid (GH₵)' },
                { key: 'balance', label: 'Balance' },
                { key: 'renewal_status', label: 'Renewal Status' },
                { key: 'due_date', label: 'Due Date' },
              ])
            }
            disabled={!filtered.length}
          >
            Export CSV
          </Button>
        }
      />

      <div className="stats">
        <StatCard label="Registered Students" value={totals.students} hint="billable snapshot" />
        <StatCard label="Total Invoiced" value={formatMoney(totals.due)} />
        <StatCard label="Total Collected" value={formatMoney(totals.paid)} tone="good" />
        <StatCard
          label="Outstanding Subscriptions"
          value={formatMoney(totals.balance)}
          tone={totals.balance > 0 ? 'warn' : 'good'}
        />
      </div>

      <Tabs
        tabs={[
          { id: 'current', label: 'Current Semesters' },
          { id: 'overdue', label: 'Overdue Renewals' },
          { id: 'all', label: 'All Billing Cycles' },
        ]}
        value={activeTab}
        onChange={setActiveTab}
      />

      <Card padded={false}>
        <div className="filters" style={{ padding: '12px 16px 0' }}>
          <SearchBox value={searchTerm} onChange={setSearchTerm} placeholder="Search schools" />
          <Select label="Status" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All Statuses</option>
            <option value="upcoming">Upcoming</option>
            <option value="renewed">Renewed</option>
            <option value="pending">Pending</option>
            <option value="overdue">Overdue</option>
            <option value="paid">Paid</option>
            <option value="partial">Partial</option>
            <option value="unpaid">Unpaid</option>
          </Select>
        </div>

        <ErrorBox error={billsQuery.error} onRetry={() => billsQuery.refetch()} />
        {billsQuery.isLoading ? (
          <Spinner />
        ) : !filtered.length ? (
          <EmptyState title="No billing or renewal records found" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>School</th>
                  <th>Frequency</th>
                  <th>Period Cycle</th>
                  <th className="num">Students</th>
                  <th className="right">Calculation</th>
                  <th className="right">Due</th>
                  <th className="right">Paid</th>
                  <th className="right">Balance</th>
                  <th>Renewal</th>
                  <th>Due Date</th>
                  <th className="right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <Link to={`/admin/schools/${b.school_id}`}>
                        <strong>{b.school_name}</strong>
                      </Link>
                      <div className="mono muted small">{b.school_code}</div>
                    </td>
                    <td>
                      <Badge
                        value={b.billing_frequency === 'monthly' ? 'Monthly' : 'Semester'}
                        tone={b.billing_frequency === 'monthly' ? 'info' : 'good'}
                      />
                    </td>
                    <td>
                      {b.period_label || `${b.academic_year_name} · ${b.semester_name}`}
                      {b.is_current && <span style={{ marginLeft: 6 }}><Badge tone="info">Current</Badge></span>}
                    </td>
                    <td className="num">{b.student_count}</td>
                    <td className="right nowrap">{b.student_count} × {formatMoney(b.price_per_student)}</td>
                    <td className="right"><strong>{formatMoney(b.total_payable ?? b.amount_due)}</strong></td>
                    <td className="right" style={{ color: 'var(--green-700)' }}>{formatMoney(b.amount_paid)}</td>
                    <td className="right">
                      <strong style={{ color: b.balance > 0 ? 'var(--red)' : 'var(--green-700)' }}>
                        {formatMoney(b.balance)}
                      </strong>
                    </td>
                    <td>
                      <Badge
                        tone={
                          b.renewal_status === 'renewed'
                            ? 'good'
                            : b.renewal_status === 'overdue'
                            ? 'danger'
                            : 'warn'
                        }
                      >
                        {b.renewal_status}
                      </Badge>
                    </td>
                    <td className="small muted">{b.due_date ? formatDate(b.due_date) : '—'}</td>
                    <td className="right">
                      <div className="table-actions">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => setConfirmInvoice(b)}
                        >
                          Issue Invoice
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {confirmInvoice && (
        <ConfirmDialog
          open
          title={`Issue Invoice · ${confirmInvoice.school_name}`}
          confirmLabel="Issue Official Invoice"
          loading={issueInvoiceMutation.isPending}
          message={`Generate and issue an official platform subscription invoice for ${confirmInvoice.student_count} registered students at GH₵${Number(confirmInvoice.price_per_student).toFixed(2)}/student (Total: ${formatMoney(confirmInvoice.amount_due)}).`}
          onCancel={() => setConfirmInvoice(null)}
          onConfirm={() => issueInvoiceMutation.mutate(confirmInvoice.id)}
        />
      )}
    </>
  );
}
