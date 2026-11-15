import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useSchool } from '../../lib/auth';
import { semesterLabel, unwrap, usePlatformSettings, useSemesters } from '../../lib/queries';
import { formatDate, formatDateTime, formatMoney, humanize, todayISO } from '../../lib/format';
import { calculateBreakdown, summarize, PRICE_PER_STUDENT_PER_TERM, getTermGraceStatus, isSchoolSuspended } from '../../lib/billing';
import { useToast } from '../../lib/toast';
import type {
  BillingOverview,
  SchoolBillingConfig,
} from '../../lib/types';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBox,
  Input,
  Modal,
  PageHeader,
  Spinner,
  StatCard,
} from '../../components/ui';

declare global {
  interface Window {
    PaystackPop?: any;
  }
}

export default function SchoolBillingPage() {
  const { schoolId } = useSchool();

  const [payingBill, setPayingBill] = useState<BillingOverview | null>(null);

  // Queries
  const schoolQuery = useQuery({
    queryKey: ['school_info', schoolId],
    queryFn: () => unwrap<{ id: string; name: string; code: string; email: string | null; phone: string | null; status: string }>(
      supabase.from('schools').select('id, name, code, email, phone, status').eq('id', schoolId).single()
    ),
  });

  const configQuery = useQuery({
    queryKey: ['school_billing_config', schoolId],
    queryFn: async () => {
      try {
        return await unwrap<SchoolBillingConfig>(
          supabase.from('school_billing_configs').select('*').eq('school_id', schoolId).maybeSingle()
        );
      } catch (err: any) {
        if (err?.code === 'PGRST205' || err?.message?.includes('schema cache')) return null;
        throw err;
      }
    },
  });

  const settings = usePlatformSettings();
  const semesters = useSemesters(schoolId);
  const current = semesters.data?.find((s) => s.is_current);

  const bills = useQuery({
    queryKey: ['billing', schoolId],
    queryFn: () =>
      unwrap<BillingOverview[]>(
        supabase.from('billing_overview').select('*').eq('school_id', schoolId).order('created_at', { ascending: false })
      ),
  });

  const payments = useQuery({
    queryKey: ['payments', schoolId],
    queryFn: () =>
      unwrap<
        {
          id: string;
          billing_id: string;
          amount: number;
          method: string;
          reference: string | null;
          paid_on: string;
          status: string;
          verification: string;
          provider: string | null;
          created_at: string;
        }[]
      >(
        supabase
          .from('payments')
          .select('id, billing_id, amount, method, reference, paid_on, status, verification, provider, created_at')
          .eq('school_id', schoolId)
          .order('paid_on', { ascending: false })
      ),
  });

  const liveCount = useQuery({
    queryKey: ['billable_count', current?.id],
    enabled: !!current,
    queryFn: () => unwrap<number>(supabase.rpc('billable_student_count', { p_semester_id: current!.id })),
  });

  const activeStudentCount = useQuery({
    queryKey: ['active_students_count', schoolId],
    queryFn: async () => {
      const { count } = await supabase
        .from('students')
        .select('*', { count: 'exact', head: true })
        .eq('school_id', schoolId)
        .eq('enrollment_status', 'active');
      return count ?? 0;
    },
  });

  const cfg = configQuery.data;
  const allBills = bills.data ?? [];
  const mainBills = allBills.filter((b) => !b.is_topup);
  const topupBills = allBills.filter((b) => b.is_topup);

  // Find active / current invoice
  const currentBill = mainBills.find((b) => b.is_current) || mainBills[0];
  const price = Number(cfg?.price_per_student ?? currentBill?.price_per_student ?? settings.data?.price_per_student ?? PRICE_PER_STUDENT_PER_TERM);

  // Active student count (fixed snapshot on current invoice if available, else active students count)
  const count = currentBill?.student_count ?? activeStudentCount.data ?? liveCount.data ?? 0;

  // Breakdown calculation
  const discountType = cfg?.discount_type ?? 'none';
  const discountVal = Number(cfg?.discount_value ?? 0);
  const passMarkup = cfg?.pass_fee_markup !== false;
  const markupPct = Number(cfg?.fee_markup_percent ?? 3.0);

  const breakdown = calculateBreakdown(count, price, discountType, discountVal, passMarkup, markupPct);
  const estimate = summarize(count, price, Number(currentBill?.amount_paid ?? 0), breakdown.discount, breakdown.feeMarkup);

  const suspended = isSchoolSuspended(schoolQuery.data?.status, cfg?.status);
  const graceStatus = getTermGraceStatus(current?.starts_on, 30);
  const inGracePeriod = graceStatus.inGrace && !currentBill;

  // Outstanding bills (main or topup)
  const unpaidBills = allBills.filter((b) => Number(b.balance) > 0);
  const primaryUnpaidBill = unpaidBills[0];

  const handlePayEstimated = () => {
    const estimatedBillPlaceholder: BillingOverview = {
      id: 'current',
      school_id: schoolId,
      school_name: schoolQuery.data?.name || 'School',
      school_code: schoolQuery.data?.code || 'SCH',
      school_status: schoolQuery.data?.status || 'active',
      semester_id: current?.id ?? null,
      semester_name: current?.name ?? null,
      academic_year_name: null,
      period_label: current ? semesterLabel(current) : 'Current Term',
      billing_frequency: 'term',
      student_count: count,
      price_per_student: price,
      currency: 'GHS',
      amount_due: estimate.subtotal,
      amount_paid: 0,
      balance: estimate.balance,
      total_payable: estimate.totalPayable,
      discount_amount: estimate.discount,
      fee_markup_amount: estimate.feeMarkup,
      due_date: null,
      notes: null,
      last_calculated_at: null,
      payment_status: 'unpaid',
      renewal_status: 'pending',
      is_current: true,
      is_topup: false,
    };
    setPayingBill(estimatedBillPlaceholder);
  };

  return (
    <>
      <PageHeader
        title="School Billing & Subscription"
        subtitle={`Your agreed billing rate is ${formatMoney(price)} per student per term. Teachers never pay.`}
        actions={
          primaryUnpaidBill ? (
            <Button onClick={() => setPayingBill(primaryUnpaidBill)}>
              💳 Pay Outstanding Bill ({formatMoney(primaryUnpaidBill.balance)})
            </Button>
          ) : !currentBill && count > 0 ? (
            <Button onClick={() => handlePayEstimated()}>
              💳 Pay with Paystack ({formatMoney(estimate.totalPayable)})
            </Button>
          ) : undefined
        }
      />

      {/* 1. Grace Period Banner: Term start 30-day grace period */}
      {inGracePeriod && (
        <Alert tone="warn">
          ℹ️ <strong>30-Day Grace Period Active:</strong> Your grace period ends on{' '}
          <strong>{formatDate(graceStatus.graceEnd?.toISOString().slice(0, 10))}</strong>. Register all students before then.
          No invoice is issued yet. On Day 30, the student count will be snapshotted and the term invoice issued.
        </Alert>
      )}

      {/* 2. School Suspended Alert if overdue */}
      {suspended && (
        <Alert tone="error">
          🚨 <strong>School Access Suspended:</strong> An overdue term or top-up invoice is unpaid. Platform access to school records is paused.
          Please settle your outstanding invoice immediately to restore full access.
        </Alert>
      )}

      {/* 3. Warning banner from Day 30 invoice issue until paid */}
      {!suspended && !inGracePeriod && currentBill && Number(currentBill.balance) > 0 && (
        <Alert tone="warn">
          ⚠️ <strong>Term Invoice Issued:</strong> Your term invoice of{' '}
          <strong>{formatMoney(currentBill.total_payable || currentBill.amount_due)}</strong> was issued on{' '}
          {formatDate(currentBill.issue_date || currentBill.created_at)}. Payment is due on{' '}
          <strong>{formatDate(currentBill.due_date)}</strong>. Please pay before the due date to avoid school suspension.
        </Alert>
      )}

      {/* Account Overview Card */}
      <Card title="Billing Arrangement & Account Overview">
        <div className="stats">
          <StatCard
            label="Rate per Student"
            value={<span style={{ color: 'var(--primary)', fontWeight: 'bold' }}>{formatMoney(price)}</span>}
            hint="GHS 3.00 standard per term"
          />
          <StatCard
            label="Billing Frequency"
            value={
              <Badge
                value="Per Term"
                tone="good"
              />
            }
            hint="One invoice per term + post-snapshot top-ups"
          />
          <StatCard
            label="Subscription Status"
            value={
              <Badge
                value={suspended ? 'suspended' : inGracePeriod ? 'grace_period' : (currentBill && Number(currentBill.balance) > 0 ? 'awaiting_payment' : 'active')}
                tone={suspended ? 'bad' : inGracePeriod ? 'warn' : (currentBill && Number(currentBill.balance) > 0 ? 'warn' : 'good')}
              />
            }
            hint={inGracePeriod ? `Grace ends: ${formatDate(graceStatus.graceEnd?.toISOString().slice(0, 10))}` : currentBill?.due_date ? `Due: ${formatDate(currentBill.due_date)}` : 'Active'}
          />
          <StatCard
            label="Outstanding Balance"
            value={formatMoney(unpaidBills.reduce((acc, b) => acc + Number(b.balance), 0))}
            tone={unpaidBills.length > 0 ? 'warn' : 'good'}
            hint={primaryUnpaidBill?.due_date ? `Due ${formatDate(primaryUnpaidBill.due_date)}` : 'All clear'}
          />
        </div>

        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div className="muted small">
            <span>Flow terms: </span>
            <strong>30-day term start grace period</strong>
            <span> · </span>
            <strong>Day 30 snapshot invoice</strong>
            <span> · </span>
            <strong>7-day payment deadline</strong>
            {cfg?.pending_topup_count ? (
              <>
                <span> · </span>
                <span style={{ color: 'var(--warn)', fontWeight: 600 }}>
                  +{cfg.pending_topup_count} Pending Top-up Students
                </span>
              </>
            ) : null}
          </div>
          <div className="muted small">
            <em>Per-term billing at GHS 3.00 per student per term.</em>
          </div>
        </div>
      </Card>

      <div style={{ height: 16 }} />

      {/* 2. Current Invoice Card with Transparent Breakdown */}
      <Card
        title={currentBill ? `Current Term Invoice · ${currentBill.period_label || 'Current Term'}` : `Estimated Bill · ${current ? semesterLabel(current) : 'Current Term'}`}
        actions={
          currentBill && Number(currentBill.balance) > 0 ? (
            <Button size="sm" onClick={() => setPayingBill(currentBill)}>
              Pay with Paystack →
            </Button>
          ) : !currentBill && count > 0 ? (
            <Button size="sm" onClick={() => handlePayEstimated()}>
              Pay with Paystack →
            </Button>
          ) : undefined
        }
      >
        <div className="stats">
          <StatCard
            label="Active Students (Term Snapshot)"
            value={count}
            hint={currentBill?.snapshot_date ? `Snapshotted: ${formatDate(currentBill.snapshot_date)}` : 'Active students count'}
          />
          <StatCard
            label="Base Term Bill"
            value={formatMoney(currentBill ? currentBill.amount_due : estimate.subtotal)}
            hint={`${count} students × ${formatMoney(price)} = ${formatMoney(count * price)}`}
          />
          <StatCard
            label="Total Payable"
            value={formatMoney(currentBill ? (currentBill.total_payable ?? currentBill.amount_due) : estimate.totalPayable)}
            tone="good"
            hint={passMarkup ? `Includes itemized ${markupPct}% processing fee` : 'Net payable'}
          />
          <StatCard
            label="Balance Remaining"
            value={formatMoney(currentBill ? currentBill.balance : estimate.balance)}
            tone={Number(currentBill?.balance ?? estimate.balance) > 0 ? 'warn' : 'good'}
          />
        </div>

        {/* Transparent Breakdown Display */}
        <div style={{ background: 'var(--subtle)', padding: 16, borderRadius: 8, marginTop: 16 }}>
          <h4 style={{ margin: '0 0 10px', fontSize: '0.95rem' }}>Calculation & Invoice Breakdown</h4>
          <div className="kv" style={{ fontSize: '1.05rem', marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
            <span><strong>Term Bill Calculation:</strong></span>
            <strong style={{ color: 'var(--primary)' }}>
              {count} students × {formatMoney(price)} = {formatMoney(count * price)}
            </strong>
          </div>
          <div className="kv">
            <span>Base Subscription:</span>
            <strong>{formatMoney(currentBill ? currentBill.amount_due : breakdown.subtotal)}</strong>
          </div>
          {(Number(currentBill?.discount_amount) > 0 || breakdown.discount > 0) && (
            <div className="kv" style={{ color: 'var(--green)' }}>
              <span>Special Platform Discount applied:</span>
              <strong>- {formatMoney(currentBill?.discount_amount ?? breakdown.discount)}</strong>
            </div>
          )}
          {passMarkup && (
            <div className="kv">
              <span>Paystack Payment Processing Fee ({markupPct}%):</span>
              <strong>+ {formatMoney(currentBill?.fee_markup_amount ?? breakdown.feeMarkup)}</strong>
            </div>
          )}
          <div className="kv" style={{ borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 8 }}>
            <span><strong>Total Amount Payable:</strong></span>
            <strong style={{ fontSize: '1.15rem', color: 'var(--primary)' }}>
              {formatMoney(currentBill ? (currentBill.total_payable ?? currentBill.amount_due) : breakdown.totalPayable)}
            </strong>
          </div>
          <div className="kv">
            <span>Amount Already Paid:</span>
            <span style={{ color: 'var(--green)' }}>{formatMoney(currentBill?.amount_paid ?? 0)}</span>
          </div>
          <div className="kv">
            <span><strong>Outstanding Balance:</strong></span>
            <strong style={{ fontSize: '1.15rem', color: Number(currentBill?.balance ?? estimate.balance) > 0 ? 'var(--warn)' : 'var(--green)' }}>
              {formatMoney(currentBill ? currentBill.balance : estimate.balance)}
            </strong>
          </div>
        </div>

        {/* Prominent Direct Payment Action Banner */}
        {currentBill && Number(currentBill.balance) > 0 && (
          <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, background: 'rgba(20, 108, 67, 0.08)', padding: '14px 18px', borderRadius: 8, border: '1px solid rgba(20, 108, 67, 0.25)' }}>
            <div>
              <strong style={{ fontSize: '1rem', color: 'var(--green-900)' }}>Term Invoice Outstanding</strong>
              <div className="muted small">Payment of {formatMoney(currentBill.balance)} is due on {formatDate(currentBill.due_date)}.</div>
            </div>
            <Button onClick={() => setPayingBill(currentBill)}>
              Pay with Paystack ({formatMoney(currentBill.total_payable ?? currentBill.balance)}) →
            </Button>
          </div>
        )}

        {!currentBill && count > 0 && (
          <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, background: 'rgba(20, 108, 67, 0.08)', padding: '14px 18px', borderRadius: 8, border: '1px solid rgba(20, 108, 67, 0.25)' }}>
            <div>
              <strong style={{ fontSize: '1rem', color: 'var(--green-900)' }}>Ready to settle your term bill?</strong>
              <div className="muted small">You don't have to wait for the 30-day grace period to expire. You can pay now for your {count} active student(s).</div>
            </div>
            <Button onClick={() => handlePayEstimated()}>
              Pay with Paystack ({formatMoney(estimate.totalPayable)}) →
            </Button>
          </div>
        )}
      </Card>

      <div style={{ height: 16 }} />

      {/* Top-up Invoices Section */}
      <Card
        title={`Top-up Invoices · Students Added After Snapshot (${topupBills.length})`}
        padded={false}
      >
        <div style={{ padding: '12px 16px 0', borderBottom: '1px solid var(--border)' }}>
          <p className="muted small" style={{ margin: '0 0 10px' }}>
            Students registered after the Day 30 snapshot are billed via top-up invoices (due 7 days after issue).
          </p>
        </div>
        {!topupBills.length ? (
          <div style={{ padding: 16 }}>
            <p className="muted" style={{ margin: 0 }}>
              No top-up invoices. Any student enrolled after the Day 30 snapshot will automatically generate a top-up invoice.
            </p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Invoice #</th>
                  <th>Description</th>
                  <th className="num">Students</th>
                  <th className="num">Rate</th>
                  <th className="num">Calculation</th>
                  <th className="num">Total</th>
                  <th className="num">Balance</th>
                  <th>Status</th>
                  <th>Issued</th>
                  <th>Due Date</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {topupBills.map((b) => (
                  <tr key={b.id}>
                    <td className="mono small">{b.invoice_number || 'TOP-UP'}</td>
                    <td>{b.period_label || 'Top-up Invoice'}</td>
                    <td className="num">+{b.student_count}</td>
                    <td className="num">{formatMoney(b.price_per_student)}</td>
                    <td className="num muted" style={{ fontSize: '0.85rem' }}>
                      {b.student_count} × {formatMoney(b.price_per_student)} = {formatMoney(b.student_count * b.price_per_student)}
                    </td>
                    <td className="num"><strong>{formatMoney(b.total_payable ?? b.amount_due)}</strong></td>
                    <td className="num"><strong style={{ color: Number(b.balance) > 0 ? 'var(--warn)' : 'var(--green)' }}>{formatMoney(b.balance)}</strong></td>
                    <td><Badge value={b.payment_status} /></td>
                    <td className="small">{formatDate(b.issue_date || b.created_at)}</td>
                    <td className="small">
                      <span style={{ color: b.due_date && b.due_date < todayISO() && Number(b.balance) > 0 ? 'var(--red)' : undefined }}>
                        {formatDate(b.due_date)}
                      </span>
                    </td>
                    <td>
                      {Number(b.balance) > 0 && (
                        <Button size="sm" onClick={() => setPayingBill(b)}>
                          Pay Top-up
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div style={{ height: 16 }} />

      {/* 3. Invoices History Table */}
      <Card title="Invoice History" padded={false}>
        <ErrorBox error={bills.error} />
        {bills.isLoading ? (
          <Spinner />
        ) : !bills.data?.length ? (
          <EmptyState title="No invoices yet" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Period / Type</th>
                  <th>Calculation</th>
                  <th className="num">Active / Top-up Students</th>
                  <th className="num">Due</th>
                  <th className="num">Paid</th>
                  <th className="num">Balance</th>
                  <th>Status</th>
                  <th>Due Date</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {bills.data.map((b) => (
                  <tr key={b.id}>
                    <td>
                      <strong>{b.period_label || b.semester_name || 'Term Invoice'}</strong>
                      {b.invoice_number && <div className="mono muted small">{b.invoice_number}</div>}
                      {b.snapshot_date && <div className="muted" style={{ fontSize: '0.78rem' }}>Snapshot: {formatDate(b.snapshot_date)}</div>}
                    </td>
                    <td className="muted small">
                      {b.student_count} students × {formatMoney(b.price_per_student)} = {formatMoney(b.student_count * b.price_per_student)}
                    </td>
                    <td className="num">
                      <span style={{ fontWeight: 600 }}>{b.is_topup ? `+${b.student_count}` : b.student_count}</span>
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
                    <td className="small">{formatDate(b.due_date)}</td>
                    <td>
                      {Number(b.balance) > 0 && (
                        <Button size="sm" onClick={() => setPayingBill(b)}>
                          Pay with Paystack
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div style={{ height: 16 }} />

      {/* 4. Payments Received Table */}
      <Card title="Payment History & Receipts" padded={false}>
        {payments.isLoading ? (
          <Spinner />
        ) : !payments.data?.length ? (
          <EmptyState title="No payments recorded yet">
            Online Paystack payments and verified offline records appear here automatically.
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th className="num">Amount</th>
                  <th>Method</th>
                  <th>Reference</th>
                  <th>Verification</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {payments.data.map((p) => (
                  <tr key={p.id}>
                    <td>
                      {formatDate(p.paid_on)}
                      <div className="muted small">recorded {formatDateTime(p.created_at)}</div>
                    </td>
                    <td className="num">
                      <strong>{formatMoney(p.amount)}</strong>
                    </td>
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
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Paystack Checkout Modal */}
      {payingBill && (
        <PaystackCheckoutModal
          bill={payingBill}
          school={schoolQuery.data}
          config={configQuery.data}
          onClose={() => setPayingBill(null)}
        />
      )}
    </>
  );
}

// -----------------------------------------------------------------------------
// Interactive Paystack Checkout Modal
// -----------------------------------------------------------------------------
function PaystackCheckoutModal({
  bill,
  school,
  config,
  onClose,
}: {
  bill: BillingOverview;
  school?: any;
  config?: SchoolBillingConfig | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();

  const [email, setEmail] = useState(school?.email || '');
  const [saveCard, setSaveCard] = useState(config?.auto_charge_card ?? false);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Accurate breakdown
  const outstandingGHS = Math.max(1.0, Number(bill.balance));
  const passMarkup = config?.pass_fee_markup !== false;
  const markupPercent = Number(config?.fee_markup_percent ?? 3.0);
  const feeMarkup = passMarkup ? Math.round(outstandingGHS * (markupPercent / 100) * 100) / 100 : 0;
  const totalPayable = Math.round((outstandingGHS + feeMarkup) * 100) / 100;

  const handleCheckout = async () => {
    if (!email || !email.includes('@')) {
      setErrorMsg('Please enter a valid email address to receive your payment receipt');
      return;
    }

    setLoading(true);
    setErrorMsg(null);

    try {
      const { data: session } = await supabase.auth.getSession();
      const token = session.session?.access_token;

      // 1. Initialize Paystack checkout via serverless backend
      const initRes = await fetch('/api/billing/paystack-init', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          school_id: bill.school_id,
          billing_id: bill.id,
          email,
          callback_url: window.location.href,
        }),
      });

      const initData = await initRes.json();
      if (!initRes.ok || initData.status !== 'success') {
        throw new Error(initData.error || 'Failed to initialize Paystack checkout');
      }

      const { reference, access_code, public_key, authorization_url, amount_in_pesewas } = initData.data;

      // 2. Open Paystack Inline Checkout Popup
      if (window.PaystackPop && public_key) {
        const handler = window.PaystackPop.setup({
          key: public_key,
          email,
          amount: amount_in_pesewas,
          currency: 'GHS',
          ref: reference,
          access_code: access_code,
          channels: ['card', 'mobile_money'],
          metadata: {
            school_id: bill.school_id,
            billing_id: bill.id,
            save_card_for_recurring: saveCard,
          },
          callback: async (response: any) => {
            // Strictly enforce rule: only the webhook marks an invoice as paid, never the redirect.
            setLoading(true);
            try {
              const ref = response.reference || reference;
              // Poll verify endpoint: only webhook marks invoice as paid!
              let attempts = 0;
              let paidConfirmed = false;
              while (attempts < 5 && !paidConfirmed) {
                const verifyRes = await fetch('/api/billing/paystack-verify', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                  },
                  body: JSON.stringify({ reference: ref }),
                });

                const verifyData = await verifyRes.json();
                if (verifyData.paid) {
                  paidConfirmed = true;
                  break;
                }
                attempts++;
                if (attempts < 5) {
                  await new Promise((r) => setTimeout(r, 1500));
                }
              }

              if (paidConfirmed) {
                toast('Payment successful! Confirmed by Paystack webhook.');
              } else {
                toast('Payment authorized by Paystack! The webhook is processing your invoice update.');
              }

              qc.invalidateQueries({ queryKey: ['billing'] });
              qc.invalidateQueries({ queryKey: ['payments'] });
              qc.invalidateQueries({ queryKey: ['school_billing_config'] });
              qc.invalidateQueries({ queryKey: ['school_info'] });
              qc.invalidateQueries({ queryKey: ['my_context'] });
              onClose();
            } catch (vErr: any) {
              setErrorMsg(vErr.message);
            } finally {
              setLoading(false);
            }
          },
          onClose: () => {
            setLoading(false);
          },
        });

        handler.openIframe();
      } else if (authorization_url) {
        // Fallback to Paystack Hosted Checkout redirect
        window.location.href = authorization_url;
      } else {
        // Test mode simulation verification
        const verifyRes = await fetch('/api/billing/paystack-verify', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ reference }),
        });

        const verifyData = await verifyRes.json();
        if (!verifyRes.ok || verifyData.status !== 'success') {
          throw new Error(verifyData.error || 'Test verification failed');
        }

        toast('Payment completed successfully!');
        qc.invalidateQueries({ queryKey: ['billing'] });
        qc.invalidateQueries({ queryKey: ['payments'] });
        qc.invalidateQueries({ queryKey: ['school_billing_config'] });
        qc.invalidateQueries({ queryKey: ['school_info'] });
        onClose();
      }
    } catch (err: any) {
      setErrorMsg(err.message || 'An error occurred during checkout');
      setLoading(false);
    }
  };

  return (
    <Modal
      open
      title="Pay with Paystack"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleCheckout} loading={loading}>
            Proceed to Secure Payment ({formatMoney(totalPayable)})
          </Button>
        </>
      }
    >
      {errorMsg && <Alert tone="error">{errorMsg}</Alert>}

      {/* Transparent Checkout Breakdown */}
      <div style={{ background: 'var(--subtle)', padding: 16, borderRadius: 8, marginBottom: 16 }}>
        <h4 style={{ margin: '0 0 12px', fontSize: '1rem' }}>Checkout Breakdown</h4>
        <div className="kv">
          <span>Subscription Balance Due:</span>
          <strong>{formatMoney(outstandingGHS)}</strong>
        </div>
        {passMarkup && (
          <div className="kv">
            <span>Payment Processing Fee ({markupPercent}%):</span>
            <span>+ {formatMoney(feeMarkup)}</span>
          </div>
        )}
        <div className="kv" style={{ borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 8 }}>
          <span><strong>Total Amount Payable:</strong></span>
          <strong style={{ fontSize: '1.25rem', color: 'var(--primary)' }}>
            {formatMoney(totalPayable)}
          </strong>
        </div>
        <p className="muted small" style={{ margin: '8px 0 0' }}>
          * Payment fees are itemized transparently. No hidden charges are added.
        </p>
      </div>

      <div className="form-grid">
        <Input
          label="Receipt Email Address"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="e.g. headmaster@school.com"
          hint="Paystack will send an official payment confirmation receipt to this email."
          required
        />
      </div>

      <div style={{ marginTop: 16 }}>
        <div style={{ padding: 12, border: '1px solid var(--border)', borderRadius: 8, background: '#fff' }}>
          <strong>Accepted Payment Methods:</strong>
          <ul style={{ margin: '6px 0 0', paddingLeft: 20, fontSize: '0.9rem', color: 'var(--muted)' }}>
            <li>💳 <strong>Bank Cards:</strong> Visa, Mastercard (Debit or Credit)</li>
            <li>📱 <strong>Mobile Money:</strong> MTN MoMo, Telecel Cash, AirtelTigo Money</li>
          </ul>
        </div>
      </div>

      {config?.billing_frequency === 'monthly' && (
        <div style={{ marginTop: 14 }}>
          <label className="checkbox" style={{ display: 'block' }}>
            <input
              type="checkbox"
              checked={saveCard}
              onChange={(e) => setSaveCard(e.target.checked)}
            />
            <strong>Authorize automatic recurring card renewal for monthly billing</strong>
          </label>
          <span className="muted small" style={{ display: 'block', marginLeft: 24, marginTop: 2 }}>
            If paying with a card, your card will be securely tokenized by Paystack for automatic renewal at the beginning of each billing month.
          </span>
        </div>
      )}
    </Modal>
  );
}
