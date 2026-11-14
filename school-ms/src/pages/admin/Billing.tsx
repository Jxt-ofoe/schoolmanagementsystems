import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { unwrap } from '../../lib/queries';
import { paymentSchema, fieldErrors } from '../../lib/validation';
import { friendlyError } from '../../lib/errors';
import { formatDate, formatDateTime, formatMoney, humanize, todayISO } from '../../lib/format';
import { PRICE_PER_STUDENT_PER_TERM } from '../../lib/billing';
import { downloadCsv } from '../../lib/csv';
import { useToast } from '../../lib/toast';
import type {
  BillingOverview,
  SchoolBillingConfig,
  PaystackTransaction,
  BillingReminder,
} from '../../lib/types';
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorBox,
  Input,
  Modal,
  PageHeader,
  SearchBox,
  Select,
  Spinner,
  StatCard,
  Tabs,
  Textarea,
} from '../../components/ui';

interface SchoolOption {
  id: string;
  name: string;
  code: string;
  status: string;
}

export default function AdminBilling() {
  const qc = useQueryClient();
  const toast = useToast();

  const [activeTab, setActiveTab] = useState<'current_term' | 'invoices' | 'configs' | 'paystack' | 'reminders'>('current_term');
  const [currentOnly, setCurrentOnly] = useState(false);
  const [pStatus, setPStatus] = useState('');
  const [q, setQ] = useState('');

  // Modals state
  const [configuringSchool, setConfiguringSchool] = useState<SchoolBillingConfig | null>(null);
  const [isNewConfig, setIsNewConfig] = useState(false);
  const [generatingForSchool, setGeneratingForSchool] = useState<SchoolOption | null>(null);
  const [confirmGenerateAll, setConfirmGenerateAll] = useState(false);
  const [remindingBill, setRemindingBill] = useState<BillingOverview | null>(null);
  const [paying, setPaying] = useState<BillingOverview | null>(null);
  const [viewing, setViewing] = useState<BillingOverview | null>(null);
  const [terms, setTerms] = useState<BillingOverview | null>(null);

  // Queries
  const schoolsQuery = useQuery({
    queryKey: ['admin_all_schools'],
    queryFn: () => unwrap<SchoolOption[]>(supabase.from('schools').select('id, name, code, status').order('name')),
  });

  const bills = useQuery({
    queryKey: ['admin_billing', currentOnly],
    queryFn: async () => {
      let qy = supabase.from('billing_overview').select('*').order('created_at', { ascending: false });
      if (currentOnly) qy = qy.eq('is_current', true);
      return unwrap<BillingOverview[]>(qy);
    },
  });

  const [isMigrationPending, setIsMigrationPending] = useState(false);

  const configsQuery = useQuery({
    queryKey: ['admin_billing_configs'],
    queryFn: async () => {
      try {
        const res = await unwrap<(SchoolBillingConfig & { schools?: { name: string; code: string; status: string } })[]>(
          supabase.from('school_billing_configs').select('*, schools(name, code, status)').order('created_at', { ascending: false })
        );
        setIsMigrationPending(false);
        return res;
      } catch (err: any) {
        if (err?.code === 'PGRST205' || err?.message?.includes('schema cache')) {
          setIsMigrationPending(true);
          return [];
        }
        throw err;
      }
    },
  });

  const paystackTxQuery = useQuery({
    queryKey: ['admin_paystack_transactions'],
    queryFn: async () => {
      try {
        return await unwrap<(PaystackTransaction & { schools?: { name: string } })[]>(
          supabase.from('paystack_transactions').select('*, schools(name)').order('created_at', { ascending: false }).limit(50)
        );
      } catch (err: any) {
        if (err?.code === 'PGRST205' || err?.message?.includes('schema cache')) {
          return [];
        }
        throw err;
      }
    },
  });

  const remindersQuery = useQuery({
    queryKey: ['admin_billing_reminders'],
    queryFn: async () => {
      try {
        return await unwrap<(BillingReminder & { schools?: { name: string } })[]>(
          supabase.from('billing_reminders').select('*, schools(name)').order('sent_at', { ascending: false }).limit(50)
        );
      } catch (err: any) {
        if (err?.code === 'PGRST205' || err?.message?.includes('schema cache')) {
          return [];
        }
        throw err;
      }
    },
  });

  const generateAllTermsMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('generate_all_school_term_invoices');
      if (error) throw error;
      return data as { generated: number; skipped: number; errors: string[] };
    },
    onSuccess: (res) => {
      toast(`Successfully generated ${res.generated} term invoice(s)! ${res.skipped ? `(${res.skipped} skipped without active term)` : ''}`);
      setConfirmGenerateAll(false);
      qc.invalidateQueries({ queryKey: ['admin_billing'] });
      qc.invalidateQueries({ queryKey: ['admin_billing_configs'] });
    },
    onError: (e) => {
      toast(friendlyError(e), 'error');
      setConfirmGenerateAll(false);
    },
  });

  const allBills = bills.data ?? [];
  const rows = allBills.filter((b) => {
    if (pStatus && b.payment_status !== pStatus && b.renewal_status !== pStatus) return false;
    if (q && !`${b.school_name} ${b.school_code} ${b.period_label || ''}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  const allConfigs = configsQuery.data ?? [];
  const filteredConfigs = allConfigs.filter((c) => {
    const sName = c.schools?.name || '';
    const sCode = c.schools?.code || '';
    if (q && !`${sName} ${sCode}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (pStatus && c.status !== pStatus) return false;
    return true;
  });

  // Calculate Metrics
  const activeSchoolsCount = schoolsQuery.data?.filter((s) => s.status === 'active').length ?? 0;
  const overdueCount = allBills.filter((b) => b.renewal_status === 'overdue' && b.balance > 0).length;

  const totals = rows.reduce(
    (t, b) => ({
      due: t.due + Number(b.total_payable ?? b.amount_due ?? 0),
      paid: t.paid + Number(b.amount_paid ?? 0),
      bal: t.bal + Number(b.balance ?? 0),
      students: t.students + (b.student_count ?? 0),
    }),
    { due: 0, paid: 0, bal: 0, students: 0 }
  );

  return (
    <>
      <PageHeader
        title="School billing & Term invoices"
        subtitle={`Standard rate: ${formatMoney(PRICE_PER_STUDENT_PER_TERM)} per student per term (active students snapshot × price per student).`}
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setIsNewConfig(true);
                setConfiguringSchool(null);
              }}
            >
              + Configure School
            </Button>
            <Button
              variant="primary"
              onClick={() => setConfirmGenerateAll(true)}
              title="Generate term invoices for all active schools with active terms"
            >
              ⚡ Generate Invoices for All Schools
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                const s = schoolsQuery.data?.[0];
                if (s) setGeneratingForSchool(s);
              }}
            >
              Generate Bill
            </Button>
          </>
        }
      />

      {isMigrationPending && (
        <div
          style={{
            background: 'var(--amber-50, #fffbeb)',
            border: '1px solid var(--amber-300, #fcd34d)',
            borderRadius: 8,
            padding: '14px 18px',
            marginBottom: 20,
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
          }}
        >
          <span style={{ fontSize: 20 }}>⚠️</span>
          <div style={{ flex: 1, fontSize: 13, color: '#92400e' }}>
            <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>
              Database Migration Required
            </div>
            <div>
              The table <code>public.school_billing_configs</code> has not been detected in Supabase yet.
              Please copy the migration script from{' '}
              <code>supabase/migrations/20261102000011_flexible_billing_and_paystack.sql</code>{' '}
              and execute it in your <strong>Supabase SQL Editor</strong> to enable per-school custom pricing and Paystack features.
            </div>
          </div>
        </div>
      )}

      {/* Top Metrics Cards */}
      <div className="stats">
        <StatCard label="Active schools" value={activeSchoolsCount} hint={`${activeSchoolsCount} schools on per-term billing`} />
        <StatCard label="Total payments collected" value={formatMoney(totals.paid)} tone="good" hint="Verified via Paystack & offline" />
        <StatCard label="Outstanding invoices" value={formatMoney(totals.bal)} tone={totals.bal > 0 ? 'warn' : 'good'} />
        <StatCard label="Overdue schools" value={overdueCount} tone={overdueCount > 0 ? 'bad' : 'good'} hint="Payment deadline passed" />
      </div>

      <Card padded={false}>
        <div style={{ padding: '16px 16px 0' }}>
          <Tabs
            tabs={[
              { id: 'current_term', label: `Current Term Status (${activeSchoolsCount})` },
              { id: 'invoices', label: `All Term Invoices (${rows.length})` },
              { id: 'configs', label: `School Configurations (${allConfigs.length})` },
              { id: 'paystack', label: `Paystack Transactions (${paystackTxQuery.data?.length ?? 0})` },
              { id: 'reminders', label: `Reminders Sent (${remindersQuery.data?.length ?? 0})` },
            ]}
            value={activeTab}
            onChange={(t) => setActiveTab(t as any)}
          />
        </div>

        {/* Filters */}
        <div className="filters" style={{ padding: '12px 16px 12px' }}>
          <SearchBox value={q} onChange={setQ} placeholder="Search schools..." />
          {activeTab === 'invoices' && (
            <Select label="Scope" value={currentOnly ? 'current' : 'all'} onChange={(e) => setCurrentOnly(e.target.value === 'current')}>
              <option value="all">All terms</option>
              <option value="current">Current term only</option>
            </Select>
          )}
          <Select label="Status" value={pStatus} onChange={(e) => setPStatus(e.target.value)}>
            <option value="">Any status</option>
            <option value="active">Active</option>
            <option value="unpaid">Unpaid</option>
            <option value="partial">Partial</option>
            <option value="paid">Paid</option>
            <option value="overdue">Overdue</option>
            <option value="grace_period">Grace Period</option>
            <option value="suspended">Suspended</option>
          </Select>
          {activeTab === 'invoices' && (
            <Button
              variant="secondary"
              onClick={() =>
                downloadCsv(
                  'school_billing.csv',
                  rows as unknown as Record<string, unknown>[],
                  [
                    { key: 'school_name', label: 'School' },
                    { key: 'billing_frequency', label: 'Frequency' },
                    { key: 'period_label', label: 'Period' },
                    { key: 'student_count', label: 'Students' },
                    { key: 'price_per_student', label: 'Price' },
                    { key: 'amount_due', label: 'Subtotal' },
                    { key: 'discount_amount', label: 'Discount' },
                    { key: 'fee_markup_amount', label: 'Markup (3%)' },
                    { key: 'total_payable', label: 'Total Payable' },
                    { key: 'amount_paid', label: 'Paid' },
                    { key: 'balance', label: 'Balance' },
                    { key: 'payment_status', label: 'Status' },
                    { key: 'due_date', label: 'Due Date' },
                  ]
                )
              }
              disabled={!rows.length}
            >
              Export CSV
            </Button>
          )}
        </div>

        {/* Tab 0: Current Term Status Across All Schools */}
        {activeTab === 'current_term' && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>School</th>
                  <th>Current Term</th>
                  <th>Student Snapshot</th>
                  <th>Rate</th>
                  <th className="num">Term Bill</th>
                  <th className="num">Paid</th>
                  <th className="num">Balance</th>
                  <th>Payment Status</th>
                  <th>Due Date</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {schoolsQuery.isLoading ? (
                  <tr><td colSpan={10}><Spinner /></td></tr>
                ) : !schoolsQuery.data?.filter(s => s.status === 'active').length ? (
                  <tr><td colSpan={10}><EmptyState title="No active schools found" /></td></tr>
                ) : (
                  schoolsQuery.data
                    .filter((s) => s.status === 'active')
                    .filter((s) => !q || `${s.name} ${s.code}`.toLowerCase().includes(q.toLowerCase()))
                    .map((s) => {
                      // Find most recent or current term invoice for this school
                      const schoolBill = allBills.find((b) => b.school_id === s.id && (b.is_current || !b.billing_month));
                      const schoolCfg = allConfigs.find((c) => c.school_id === s.id);
                      const priceRate = Number(schoolBill?.price_per_student ?? schoolCfg?.price_per_student ?? PRICE_PER_STUDENT_PER_TERM);

                      return (
                        <tr key={s.id}>
                          <td>
                            <Link to={`/admin/schools/${s.id}`}>
                              <strong>{s.name}</strong>
                            </Link>
                            <div className="muted small">{s.code}</div>
                          </td>
                          <td>
                            {schoolBill ? (
                              <>
                                <strong>{schoolBill.period_label || schoolBill.semester_name || 'Current Term'}</strong>
                                {schoolBill.snapshot_date && (
                                  <div className="muted small">Snapshot: {formatDate(schoolBill.snapshot_date)}</div>
                                )}
                              </>
                            ) : (
                              <span className="muted">No term invoice yet</span>
                            )}
                          </td>
                          <td>
                            {schoolBill ? (
                              <span><strong>{schoolBill.student_count}</strong> active students</span>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                          <td>{formatMoney(priceRate)} / student</td>
                          <td className="num">
                            {schoolBill ? (
                              <strong>{formatMoney(schoolBill.total_payable ?? schoolBill.amount_due)}</strong>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                          <td className="num" style={{ color: 'var(--green)' }}>
                            {schoolBill ? formatMoney(schoolBill.amount_paid) : '—'}
                          </td>
                          <td className="num">
                            {schoolBill ? (
                              <strong style={{ color: schoolBill.balance > 0 ? 'var(--warn)' : 'var(--green)' }}>
                                {formatMoney(schoolBill.balance)}
                              </strong>
                            ) : (
                              '—'
                            )}
                          </td>
                          <td>
                            {schoolBill ? (
                              <Badge value={schoolBill.payment_status} />
                            ) : (
                              <Badge value="Not Invoiced" tone="muted" />
                            )}
                          </td>
                          <td className="small">
                            {schoolBill?.due_date ? formatDate(schoolBill.due_date) : '—'}
                          </td>
                          <td>
                            <div className="table-actions">
                              <Button
                                size="sm"
                                variant={schoolBill ? 'secondary' : 'primary'}
                                onClick={() => setGeneratingForSchool(s)}
                              >
                                {schoolBill ? 'Re-generate' : 'Generate Invoice'}
                              </Button>
                              {schoolBill && schoolBill.balance > 0 && (
                                <Button size="sm" onClick={() => setPaying(schoolBill)}>
                                  Record Offline
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Tab 1: Invoices */}
        {activeTab === 'invoices' && (
          <>
            <ErrorBox error={bills.error} onRetry={() => bills.refetch()} />
            {bills.isLoading ? (
              <Spinner />
            ) : !rows.length ? (
              <EmptyState title="No billing records match filters">
                Use “Generate Bill” or “Generate Invoices for All Schools” to issue term invoices.
              </EmptyState>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>School</th>
                      <th>Billing Model</th>
                      <th>Period & Term</th>
                      <th>Calculation Formula</th>
                      <th className="num">Due</th>
                      <th className="num">Paid</th>
                      <th className="num">Balance</th>
                      <th>Status</th>
                      <th>Renewal</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((b) => (
                      <tr key={b.id}>
                        <td>
                          <Link to={`/admin/schools/${b.school_id}`}>
                            <strong>{b.school_name}</strong>
                          </Link>
                          <div className="muted small">{b.school_code}</div>
                        </td>
                        <td>
                          <Badge
                            value={b.billing_frequency === 'monthly' ? 'Monthly (Legacy)' : 'Per Term'}
                            tone={b.billing_frequency === 'monthly' ? 'muted' : 'good'}
                          />
                        </td>
                        <td className="small">
                          <strong>{b.period_label || b.semester_name || 'Term Invoice'}</strong>
                          <div className="muted">due {formatDate(b.due_date)}</div>
                          {b.snapshot_date && (
                            <div className="muted" style={{ fontSize: '0.78rem' }}>Snapshot: {formatDate(b.snapshot_date)}</div>
                          )}
                        </td>
                        <td className="nowrap small">
                          <strong>{b.student_count} students × {formatMoney(b.price_per_student, b.currency)} = {formatMoney(b.student_count * b.price_per_student, b.currency)}</strong>
                          {Number(b.discount_amount) > 0 && (
                            <div className="muted" style={{ color: 'var(--green)' }}>
                              - {formatMoney(b.discount_amount, b.currency)} discount
                            </div>
                          )}
                          {Number(b.fee_markup_amount) > 0 && (
                            <div className="muted" style={{ fontSize: '0.8rem' }}>
                              + {formatMoney(b.fee_markup_amount, b.currency)} (3% processing fee)
                            </div>
                          )}
                        </td>
                        <td className="num">
                          <strong>{formatMoney(b.total_payable ?? b.amount_due, b.currency)}</strong>
                        </td>
                        <td className="num">{formatMoney(b.amount_paid, b.currency)}</td>
                        <td className="num">
                          <strong style={{ color: b.balance > 0 ? 'var(--warn)' : 'var(--green)' }}>
                            {formatMoney(b.balance, b.currency)}
                          </strong>
                        </td>
                        <td>
                          <Badge value={b.payment_status} />
                        </td>
                        <td>
                          <Badge value={b.renewal_status} />
                        </td>
                        <td>
                          <div className="table-actions">
                            <Button size="sm" onClick={() => setPaying(b)}>
                              Record Offline
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setViewing(b)}>
                              Payments
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setRemindingBill(b)}>
                              🔔 Remind
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setTerms(b)}>
                              Terms
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* Tab 2: School Billing Configurations */}
        {activeTab === 'configs' && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>School</th>
                  <th>Price / Student</th>
                  <th>Billing Frequency</th>
                  <th>Start Date</th>
                  <th>Next Billing</th>
                  <th>Deadline & Grace</th>
                  <th>Special Discount</th>
                  <th>3% Markup</th>
                  <th>Subscription Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filteredConfigs.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link to={`/admin/schools/${c.school_id}`}>
                        <strong>{c.schools?.name || 'School'}</strong>
                      </Link>
                      <div className="muted small">{c.schools?.code}</div>
                    </td>
                    <td>
                      <strong style={{ fontSize: '1.05rem', color: 'var(--primary)' }}>
                        {formatMoney(c.price_per_student)}
                      </strong>{' '}
                      <span className="muted small">/ student</span>
                    </td>
                    <td>
                      <Badge
                        value="Per Term"
                        tone="good"
                      />
                    </td>
                    <td className="small">{formatDate(c.billing_start_date)}</td>
                    <td className="small">
                      <strong>{formatDate(c.next_billing_date)}</strong>
                    </td>
                    <td className="small">
                      {c.due_days} days due · {c.grace_period_days} days grace
                    </td>
                    <td className="small">
                      {c.discount_type === 'none' ? (
                        <span className="muted">None</span>
                      ) : c.discount_type === 'percentage' ? (
                        <span style={{ color: 'var(--green)' }}>{c.discount_value}% off</span>
                      ) : (
                        <span style={{ color: 'var(--green)' }}>GH₵ {c.discount_value} off</span>
                      )}
                    </td>
                    <td>
                      <Badge
                        value={c.pass_fee_markup ? `${c.fee_markup_percent}% Passed` : 'Absorbed'}
                        tone={c.pass_fee_markup ? 'good' : 'muted'}
                      />
                    </td>
                    <td>
                      <Badge
                        value={c.status}
                        tone={
                          c.status === 'active'
                            ? 'good'
                            : c.status === 'grace_period'
                              ? 'warn'
                              : c.status === 'suspended'
                                ? 'bad'
                                : 'info'
                        }
                      />
                    </td>
                    <td>
                      <div className="table-actions">
                        <Button
                          size="sm"
                          onClick={() => {
                            setIsNewConfig(false);
                            setConfiguringSchool(c);
                          }}
                        >
                          Configure
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            const sc = schoolsQuery.data?.find((s) => s.id === c.school_id);
                            if (sc) setGeneratingForSchool(sc);
                          }}
                        >
                          Bill Now
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Tab 3: Paystack Online Transactions */}
        {activeTab === 'paystack' && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date & Time</th>
                  <th>School</th>
                  <th>Reference</th>
                  <th className="num">Amount</th>
                  <th>Channel</th>
                  <th>Status</th>
                  <th>Gateway Response</th>
                </tr>
              </thead>
              <tbody>
                {paystackTxQuery.isLoading ? (
                  <tr>
                    <td colSpan={7}>
                      <Spinner />
                    </td>
                  </tr>
                ) : !paystackTxQuery.data?.length ? (
                  <tr>
                    <td colSpan={7}>
                      <EmptyState title="No Paystack transactions recorded yet" />
                    </td>
                  </tr>
                ) : (
                  paystackTxQuery.data.map((tx) => (
                    <tr key={tx.id}>
                      <td className="small">{formatDateTime(tx.created_at)}</td>
                      <td>
                        <strong>{tx.schools?.name || 'School'}</strong>
                      </td>
                      <td className="mono small">{tx.reference}</td>
                      <td className="num">
                        <strong>{formatMoney(tx.amount, tx.currency)}</strong>
                      </td>
                      <td>
                        <Badge
                          value={tx.channel === 'card' ? 'Bank Card' : tx.channel === 'mobile_money' ? 'Mobile Money' : 'Checkout'}
                          tone="info"
                        />
                      </td>
                      <td>
                        <Badge
                          value={tx.status}
                          tone={tx.status === 'success' ? 'good' : tx.status === 'failed' ? 'bad' : 'warn'}
                        />
                      </td>
                      <td className="small muted">{tx.gateway_response || 'Pending checkout verification'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Tab 4: Billing Reminders */}
        {activeTab === 'reminders' && (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Sent At</th>
                  <th>School</th>
                  <th>Reminder Type</th>
                  <th>Channel</th>
                  <th>Recipient</th>
                  <th>Message</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {remindersQuery.isLoading ? (
                  <tr>
                    <td colSpan={7}>
                      <Spinner />
                    </td>
                  </tr>
                ) : !remindersQuery.data?.length ? (
                  <tr>
                    <td colSpan={7}>
                      <EmptyState title="No reminders sent yet" />
                    </td>
                  </tr>
                ) : (
                  remindersQuery.data.map((r) => (
                    <tr key={r.id}>
                      <td className="small">{formatDateTime(r.sent_at)}</td>
                      <td>
                        <strong>{r.schools?.name || 'School'}</strong>
                      </td>
                      <td>
                        <Badge value={humanize(r.reminder_type)} />
                      </td>
                      <td>
                        <Badge value={r.channel.toUpperCase()} tone="info" />
                      </td>
                      <td className="mono small">{r.recipient_phone || r.recipient_email || '—'}</td>
                      <td className="small" style={{ maxWidth: 300 }}>
                        {r.message}
                      </td>
                      <td>
                        <Badge value={r.status} tone={r.status === 'sent' ? 'good' : 'bad'} />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Modals */}
      {configuringSchool && (
        <ConfigureBillingModal
          config={configuringSchool}
          schools={schoolsQuery.data ?? []}
          onClose={() => setConfiguringSchool(null)}
        />
      )}

      {isNewConfig && (
        <ConfigureBillingModal
          config={null}
          schools={schoolsQuery.data ?? []}
          onClose={() => setIsNewConfig(false)}
        />
      )}

      {generatingForSchool && (
        <GenerateInvoiceModal
          school={generatingForSchool}
          onClose={() => setGeneratingForSchool(null)}
        />
      )}

      {remindingBill && (
        <SendReminderModal
          bill={remindingBill}
          onClose={() => setRemindingBill(null)}
        />
      )}

      {paying && <PaymentModal bill={paying} onClose={() => setPaying(null)} />}
      {viewing && <PaymentsList bill={viewing} onClose={() => setViewing(null)} />}
      {terms && <TermsModal bill={terms} onClose={() => setTerms(null)} />}

      <ConfirmDialog
        open={confirmGenerateAll}
        title="Generate Term Invoices for All Schools"
        confirmLabel="Generate All Invoices"
        loading={generateAllTermsMutation.isPending}
        message="This will generate a term invoice for every active school that has an active term, snapshotting their active student count and applying their configured rate (default GHS 3.00/student). Already-issued invoices will remain safely preserved."
        onCancel={() => setConfirmGenerateAll(false)}
        onConfirm={() => generateAllTermsMutation.mutate()}
      />
    </>
  );
}

// -----------------------------------------------------------------------------
// Modal: Configure School Billing Arrangement
// -----------------------------------------------------------------------------
function ConfigureBillingModal({
  config,
  schools,
  onClose,
}: {
  config: SchoolBillingConfig | null;
  schools: SchoolOption[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();

  const [schoolId, setSchoolId] = useState(config?.school_id || schools[0]?.id || '');
  const [price, setPrice] = useState(String(config?.price_per_student ?? PRICE_PER_STUDENT_PER_TERM));
  const [startDate, setStartDate] = useState(config?.billing_start_date ?? todayISO());
  const [nextDate, setNextDate] = useState(config?.next_billing_date ?? '');
  const [dueDays, setDueDays] = useState(String(config?.due_days ?? 14));
  const [graceDays, setGraceDays] = useState(String(config?.grace_period_days ?? 7));
  const [discountType, setDiscountType] = useState<'none' | 'fixed' | 'percentage'>(config?.discount_type ?? 'none');
  const [discountValue, setDiscountValue] = useState(String(config?.discount_value ?? 0));
  const [passMarkup, setPassMarkup] = useState(config?.pass_fee_markup ?? true);
  const [markupPercent, setMarkupPercent] = useState(String(config?.fee_markup_percent ?? 3.0));
  const [autoCharge] = useState(config?.auto_charge_card ?? false);
  const [status, setStatus] = useState(config?.status ?? 'active');
  const [notes, setNotes] = useState(config?.notes ?? '');

  const save = useMutation({
    mutationFn: async () => {
      const p = Number(price);
      if (Number.isNaN(p) || p < 0) throw new Error('Enter a valid non-negative price per student');

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
      qc.invalidateQueries({ queryKey: ['admin_billing_configs'] });
      qc.invalidateQueries({ queryKey: ['admin_billing'] });
      onClose();
    },
    onError: (e) => toast(friendlyError(e), 'error'),
  });

  return (
    <Modal
      open
      wide
      title={config ? `Configure Billing · ${(config as any).schools?.name || 'School'}` : 'Configure New School Billing'}
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

      {!config && (
        <div style={{ marginBottom: 16 }}>
          <Select label="Select School" value={schoolId} onChange={(e) => setSchoolId(e.target.value)}>
            {schools.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.code})
              </option>
            ))}
          </Select>
        </div>
      )}

      <div className="form-grid">
        <Input
          label="Price per student per term (GH₵)"
          type="number"
          step="0.01"
          min="0"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          hint="Per-term rate for this school (default GHS 3.00)"
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
          hint="Expected date for the upcoming invoice"
        />
        <Input
          label="Payment Deadline (Days)"
          type="number"
          min="1"
          value={dueDays}
          onChange={(e) => setDueDays(e.target.value)}
          hint="Days given to pay invoice before due date"
        />
        <Input
          label="Grace Period (Days)"
          type="number"
          min="0"
          value={graceDays}
          onChange={(e) => setGraceDays(e.target.value)}
          hint="Days allowed after due date before suspension"
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
          placeholder="e.g. Custom price negotiated for 2026/2027 academic session..."
        />
      </div>
    </Modal>
  );
}

// -----------------------------------------------------------------------------
// Modal: Generate School Invoice
// -----------------------------------------------------------------------------
function GenerateInvoiceModal({
  school,
  onClose,
}: {
  school: SchoolOption;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();

  const [periodDate, setPeriodDate] = useState(todayISO());

  const configQuery = useQuery({
    queryKey: ['school_billing_config', school.id],
    queryFn: () =>
      unwrap<SchoolBillingConfig>(
        supabase.from('school_billing_configs').select('*').eq('school_id', school.id).maybeSingle()
      ),
  });

  const generate = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('generate_school_invoice', {
        p_school_id: school.id,
        p_period_date: periodDate,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast(`Invoice generated for ${school.name}`);
      qc.invalidateQueries({ queryKey: ['admin_billing'] });
      qc.invalidateQueries({ queryKey: ['admin_billing_configs'] });
      onClose();
    },
    onError: (e) => toast(friendlyError(e), 'error'),
  });

  const cfg = configQuery.data;

  return (
    <Modal
      open
      title={`Generate Invoice · ${school.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => generate.mutate()} loading={generate.isPending}>
            Generate & Issue Invoice
          </Button>
        </>
      }
    >
      {generate.error && <Alert tone="error">{friendlyError(generate.error)}</Alert>}

      <div className="card-plain" style={{ background: 'var(--subtle)', padding: 16, borderRadius: 8, marginBottom: 16 }}>
        <div className="kv">
          <span>Billing Model:</span>
          <strong>Per-Term Billing</strong>
        </div>
        <div className="kv">
          <span>Configured Price:</span>
          <strong>{formatMoney(cfg?.price_per_student ?? PRICE_PER_STUDENT_PER_TERM)} / student per term</strong>
        </div>
        <div className="kv">
          <span>Payment Processing Markup:</span>
          <strong>{cfg?.pass_fee_markup ? `${cfg.fee_markup_percent}% markup` : 'None'}</strong>
        </div>
      </div>

      <Input
        label="Term Invoice Date"
        type="date"
        value={periodDate}
        onChange={(e) => setPeriodDate(e.target.value)}
        hint="Invoice calculation snapshots active students and applies discounts/markups automatically without duplicate risk."
      />
    </Modal>
  );
}

// -----------------------------------------------------------------------------
// Modal: Send Billing Reminder
// -----------------------------------------------------------------------------
function SendReminderModal({
  bill,
  onClose,
}: {
  bill: BillingOverview;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();

  const [reminderType, setReminderType] = useState<'due_soon' | 'due_today' | 'failed' | 'grace_warning'>('due_soon');

  const send = useMutation({
    mutationFn: async () => {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;
      const res = await fetch('/api/billing/send-reminder', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          school_id: bill.school_id,
          billing_id: bill.id,
          reminder_type: reminderType,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to dispatch reminder');
      return data;
    },
    onSuccess: (data) => {
      if (data.duplicate_prevented) {
        toast('Reminder was previously recorded; duplicate dispatch skipped.', 'info');
      } else {
        toast(`Billing reminder dispatched to ${bill.school_name}!`);
      }
      qc.invalidateQueries({ queryKey: ['admin_billing_reminders'] });
      onClose();
    },
    onError: (e) => toast(friendlyError(e), 'error'),
  });

  return (
    <Modal
      open
      title={`Send Billing Reminder · ${bill.school_name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => send.mutate()} loading={send.isPending}>
            Dispatch Notification
          </Button>
        </>
      }
    >
      {send.error && <Alert tone="error">{friendlyError(send.error)}</Alert>}

      <p className="muted small">
        Period: {bill.period_label || bill.semester_name} · Outstanding: {formatMoney(bill.balance)}
      </p>

      <Select
        label="Notification Stage"
        value={reminderType}
        onChange={(e) => setReminderType(e.target.value as any)}
      >
        <option value="due_soon">Upcoming Payment Deadline (3 Days Before)</option>
        <option value="due_today">Payment Due Date (Today)</option>
        <option value="failed">Payment Failed Notice (Grace Period Active)</option>
        <option value="grace_warning">Grace Period Expiry Warning</option>
      </Select>

      <div style={{ marginTop: 16 }}>
        <Alert tone="info">
          The system logs reminders in the database and guarantees that duplicate reminders are not sent.
        </Alert>
      </div>
    </Modal>
  );
}

// -----------------------------------------------------------------------------
// Preserved: Record Offline Payment Modal
// -----------------------------------------------------------------------------
function PaymentModal({ bill, onClose }: { bill: BillingOverview; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [v, setV] = useState({
    amount: String(Math.max(0, Number(bill.balance)).toFixed(2)),
    method: 'mobile_money',
    reference: '',
    paid_on: todayISO(),
    notes: '',
  });
  const [confirmed, setConfirmed] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const m = useMutation({
    mutationFn: async () => {
      const parsed = paymentSchema.safeParse(v);
      if (!parsed.success) {
        setErrors(fieldErrors(parsed.error));
        throw new Error('Please fix the highlighted fields.');
      }
      if (!confirmed) throw new Error('Confirm that you have verified this payment.');
      const { error } = await supabase.rpc('record_payment', {
        p_billing_id: bill.id,
        p_amount: parsed.data.amount,
        p_method: parsed.data.method,
        p_reference: parsed.data.reference,
        p_paid_on: parsed.data.paid_on,
        p_notes: parsed.data.notes,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast('Payment recorded');
      qc.invalidateQueries({ queryKey: ['admin_billing'] });
      qc.invalidateQueries({ queryKey: ['payments_for'] });
      onClose();
    },
  });

  return (
    <Modal
      open
      title={`Record offline payment · ${bill.school_name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => m.mutate()} loading={m.isPending} disabled={!confirmed}>
            Record payment
          </Button>
        </>
      }
    >
      {m.error && <Alert tone="error">{friendlyError(m.error)}</Alert>}
      <p className="muted small">
        {bill.period_label || bill.semester_name} · balance {formatMoney(bill.balance)}
      </p>
      <div className="form-grid">
        <Input
          label="Amount (GH₵)"
          type="number"
          min={0.01}
          step="0.01"
          value={v.amount}
          onChange={(e) => setV({ ...v, amount: e.target.value })}
          error={errors.amount}
          required
        />
        <Input
          label="Date received"
          type="date"
          max={todayISO()}
          value={v.paid_on}
          onChange={(e) => setV({ ...v, paid_on: e.target.value })}
          error={errors.paid_on}
          required
        />
        <Select label="Method" value={v.method} onChange={(e) => setV({ ...v, method: e.target.value })}>
          <option value="mobile_money">Mobile money</option>
          <option value="bank_transfer">Bank transfer</option>
          <option value="cash">Cash</option>
          <option value="cheque">Cheque</option>
          <option value="card">Card</option>
          <option value="other">Other</option>
        </Select>
        <Input
          label="Reference / receipt no."
          value={v.reference}
          onChange={(e) => setV({ ...v, reference: e.target.value })}
          error={errors.reference}
          hint="Prevents recording the same receipt twice"
        />
      </div>
      <Textarea label="Notes" value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} />
      <label className="checkbox">
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        I have verified that this money was received (statement, MoMo confirmation or receipt).
      </label>
    </Modal>
  );
}

// -----------------------------------------------------------------------------
// Preserved: View Payments List Modal
// -----------------------------------------------------------------------------
function PaymentsList({ bill, onClose }: { bill: BillingOverview; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [voiding, setVoiding] = useState<string | null>(null);
  const [reason, setReason] = useState('');

  const payments = useQuery({
    queryKey: ['payments_for', bill.id],
    queryFn: () =>
      unwrap<
        {
          id: string;
          amount: number;
          method: string;
          reference: string | null;
          paid_on: string;
          status: string;
          void_reason: string | null;
          created_at: string;
          verification: string;
          provider: string | null;
        }[]
      >(supabase.from('payments').select('*').eq('billing_id', bill.id).order('created_at', { ascending: false })),
  });

  const v = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc('void_payment', { p_payment_id: voiding, p_reason: reason });
      if (error) throw error;
    },
    onSuccess: () => {
      toast('Payment voided');
      setVoiding(null);
      setReason('');
      qc.invalidateQueries({ queryKey: ['payments_for'] });
      qc.invalidateQueries({ queryKey: ['admin_billing'] });
    },
    onError: (e) => toast(friendlyError(e), 'error'),
  });

  return (
    <Modal
      open
      wide
      title={`Payments · ${bill.school_name} · ${bill.period_label || bill.semester_name}`}
      onClose={onClose}
      footer={<Button onClick={onClose}>Close</Button>}
    >
      {payments.isLoading ? (
        <Spinner />
      ) : !payments.data?.length ? (
        <EmptyState title="No payments recorded" />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Received</th>
                <th className="num">Amount</th>
                <th>Method</th>
                <th>Reference</th>
                <th>Verification</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {payments.data.map((p) => (
                <tr key={p.id}>
                  <td>
                    {formatDate(p.paid_on)}
                    <div className="muted small">recorded {formatDateTime(p.created_at)}</div>
                  </td>
                  <td className="num">{formatMoney(p.amount)}</td>
                  <td>
                    {humanize(p.method)}
                    {p.provider && <span className="muted small"> ({p.provider})</span>}
                  </td>
                  <td className="mono">{p.reference ?? '—'}</td>
                  <td>
                    <Badge value={humanize(p.verification)} />
                  </td>
                  <td>
                    <Badge value={p.status} />
                    {p.void_reason && <div className="muted small">{p.void_reason}</div>}
                  </td>
                  <td className="right">
                    {p.status === 'valid' && (
                      <Button size="sm" variant="ghost" onClick={() => setVoiding(p.id)}>
                        Void
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ConfirmDialog
        open={!!voiding}
        danger
        title="Void payment"
        confirmLabel="Void payment"
        loading={v.isPending}
        message="Voiding reverses this payment on the balance. The record is kept and the action is audited."
        onCancel={() => setVoiding(null)}
        onConfirm={() => v.mutate()}
      >
        <Textarea label="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
      </ConfirmDialog>
    </Modal>
  );
}

// -----------------------------------------------------------------------------
// Preserved: Terms Modal
// -----------------------------------------------------------------------------
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
      const { error } = await supabase.rpc('update_billing_terms', {
        p_billing_id: bill.id,
        p_price_per_student: p,
        p_due_date: due || null,
        p_notes: notes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast('Billing terms updated');
      qc.invalidateQueries({ queryKey: ['admin_billing'] });
      onClose();
    },
  });

  return (
    <Modal
      open
      title={`Billing terms · ${bill.school_name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => m.mutate()} loading={m.isPending}>
            Save
          </Button>
        </>
      }
    >
      {m.error && <Alert tone="error">{friendlyError(m.error)}</Alert>}
      <Input
        label="Price per student (GH₵)"
        type="number"
        min={0}
        step="0.01"
        value={price}
        onChange={(e) => setPrice(e.target.value)}
        hint={`Amount due becomes ${bill.student_count} × ${formatMoney(Number(price) || 0)} = ${formatMoney(
          bill.student_count * (Number(price) || 0)
        )}`}
      />
      <Input label="Due date" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
      <Textarea label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <p className="muted small">Changes are recorded in the audit log with old and new values.</p>
    </Modal>
  );
}
