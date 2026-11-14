import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useSchool } from '../../lib/auth';
import { semesterLabel, unwrap, usePlatformSettings, useSemesters } from '../../lib/queries';
import { formatDate, formatDateTime, formatMoney, humanize } from '../../lib/format';
import { calculateBreakdown, summarize, PRICE_PER_STUDENT_PER_TERM } from '../../lib/billing';
import { useToast } from '../../lib/toast';
import type {
  BillingOverview,
  SchoolBillingConfig,
  PaymentAuthorization,
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

  const cardAuthQuery = useQuery({
    queryKey: ['school_card_auth', schoolId],
    queryFn: async () => {
      try {
        return await unwrap<PaymentAuthorization>(
          supabase.from('payment_authorizations').select('*').eq('school_id', schoolId).eq('reusable', true).maybeSingle()
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

  // Find active / current invoice
  const currentBill = bills.data?.[0]; // Most recent invoice
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

  const billingStatus = cfg?.status || schoolQuery.data?.status || 'active';

  return (
    <>
      <PageHeader
        title="School Billing & Subscription"
        subtitle={`Your agreed billing rate is ${formatMoney(price)} per student per term. Teachers never pay.`}
        actions={
          currentBill && Number(currentBill.balance) > 0 ? (
            <Button onClick={() => setPayingBill(currentBill)}>
              💳 Pay Outstanding Bill via Paystack
            </Button>
          ) : undefined
        }
      />

      {/* Subscription Status Alert if grace period or overdue */}
      {billingStatus === 'grace_period' && (
        <Alert tone="warn">
          <strong>Grace Period Active:</strong> Your subscription payment is pending. Please complete your payment before{' '}
          {formatDate(cfg?.grace_period_end) || 'the deadline'} to ensure uninterrupted platform access.
        </Alert>
      )}

      {billingStatus === 'payment_overdue' && (
        <Alert tone="error">
          <strong>Payment Overdue:</strong> The payment deadline has passed. Please settle your invoice immediately.
        </Alert>
      )}

      {/* 1. School Billing Arrangement Overview */}
      <Card title="Billing Arrangement & Account Overview">
        <div className="stats">
          <StatCard
            label="Rate per Student"
            value={<span style={{ color: 'var(--primary)', fontWeight: 'bold' }}>{formatMoney(price)}</span>}
            hint="Per term billing rate"
          />
          <StatCard
            label="Billing Frequency"
            value={
              <Badge
                value="Per Term"
                tone="good"
              />
            }
            hint="One invoice generated per academic term"
          />
          <StatCard
            label="Subscription Status"
            value={
              <Badge
                value={billingStatus}
                tone={billingStatus === 'active' ? 'good' : billingStatus === 'grace_period' ? 'warn' : 'bad'}
              />
            }
            hint={cfg?.next_billing_date ? `Next billing: ${formatDate(cfg.next_billing_date)}` : undefined}
          />
          <StatCard
            label="Outstanding Balance"
            value={formatMoney(currentBill ? currentBill.balance : estimate.balance)}
            tone={Number(currentBill?.balance ?? estimate.balance) > 0 ? 'warn' : 'good'}
            hint={currentBill?.due_date ? `Due ${formatDate(currentBill.due_date)}` : undefined}
          />
        </div>

        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div className="muted small">
            <span>Payment terms: </span>
            <strong>{cfg?.due_days ?? 14} days deadline</strong>
            <span> · </span>
            <strong>{cfg?.grace_period_days ?? 7} days grace period</strong>
            {cardAuthQuery.data && (
              <>
                <span> · </span>
                <span style={{ color: 'var(--primary)' }}>
                  💳 Saved Card for Auto-Renewal: {cardAuthQuery.data.card_type?.toUpperCase()} •••• {cardAuthQuery.data.last4} ({cardAuthQuery.data.bank || 'Bank'})
                </span>
              </>
            )}
          </div>
          <div className="muted small">
            <em>Custom pricing and billing arrangements are configured by the Platform Super Admin.</em>
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
                  <th>Period</th>
                  <th>Billing Model</th>
                  <th className="num">Active Students</th>
                  <th className="num">Due</th>
                  <th className="num">Paid</th>
                  <th className="num">Balance</th>
                  <th>Status</th>
                  <th>Deadline</th>
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
                    <td>
                      <Badge
                        value={b.billing_frequency === 'monthly' ? 'Monthly (Legacy)' : 'Per Term'}
                        tone={b.billing_frequency === 'monthly' ? 'muted' : 'good'}
                      />
                    </td>
                    <td className="num">{b.student_count}</td>
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
            // Verify payment securely on backend
            setLoading(true);
            try {
              const verifyRes = await fetch('/api/billing/paystack-verify', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                  reference: response.reference || reference,
                }),
              });

              const verifyData = await verifyRes.json();
              if (!verifyRes.ok || verifyData.status !== 'success') {
                throw new Error(verifyData.error || 'Payment verification failed server-side');
              }

              toast('Payment successful! Your invoice has been updated and subscription is active.');
              qc.invalidateQueries({ queryKey: ['billing'] });
              qc.invalidateQueries({ queryKey: ['payments'] });
              qc.invalidateQueries({ queryKey: ['school_billing_config'] });
              qc.invalidateQueries({ queryKey: ['school_info'] });
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
