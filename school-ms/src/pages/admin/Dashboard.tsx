import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { unwrap, usePlatformSettings } from '../../lib/queries';
import { PRICE_PER_STUDENT_PER_TERM } from '../../lib/billing';
import { formatMoney } from '../../lib/format';
import { Alert, Card, ErrorBox, PageHeader, Spinner, StatCard } from '../../components/ui';

interface PlatformDash {
  schools_total: number; schools_active: number; schools_inactive: number; students_active: number; registered_current: number; teachers: number;
  billing_current: { records: number; due: number; paid: number; balance: number; renewed: number; pending: number; overdue: number };
  schools_without_billing: number;
}

export default function AdminDashboard() {
  const settings = usePlatformSettings();
  const q = useQuery({ queryKey: ['platform_dashboard'], queryFn: () => unwrap<PlatformDash>(supabase.rpc('platform_dashboard')) });
  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  const b = d.billing_current;
  const currentPrice = settings.data?.price_per_student ?? PRICE_PER_STUDENT_PER_TERM;

  return (
    <>
      <PageHeader title="Platform overview" subtitle={`Current price: ${formatMoney(currentPrice)} per student per term`} />
      {d.schools_without_billing > 0 && <Alert tone="warn"><span>{d.schools_without_billing} active school(s) have a current term without a billing record.</span><Link to="/admin/billing">Generate billing →</Link></Alert>}
      <div className="stats">
        <StatCard label="Schools" value={d.schools_total} hint={`${d.schools_active} active · ${d.schools_inactive} inactive`} />
        <StatCard label="Active students" value={d.students_active} />
        <StatCard label="Registered this term" value={d.registered_current} hint="unique, across all schools" />
        <StatCard label="Teachers" value={d.teachers} />
      </div>
      <Card title="Current term billing" actions={<Link to="/admin/billing" className="small">Billing →</Link>}>
        <div className="kv"><span>Billing records</span><strong>{b.records}</strong></div>
        <div className="kv"><span>Total due</span><strong>{formatMoney(b.due)}</strong></div>
        <div className="kv"><span>Total paid</span><strong>{formatMoney(b.paid)}</strong></div>
        <div className="kv"><span>Outstanding</span><strong>{formatMoney(b.balance)}</strong></div>
        <div className="kv"><span>Renewed (fully paid)</span><strong>{b.renewed}</strong></div>
        <div className="kv"><span>Pending</span><strong>{b.pending}</strong></div>
        <div className="kv"><span>Overdue</span><strong style={{ color: b.overdue ? 'var(--red)' : undefined }}>{b.overdue}</strong></div>
      </Card>
    </>
  );
}
