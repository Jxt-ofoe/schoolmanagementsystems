import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { usePlatformSettings } from '../../lib/queries';
import { PRICE_PER_STUDENT_PER_TERM } from '../../lib/billing';
import { settingsSchema, fieldErrors } from '../../lib/validation';
import { friendlyError } from '../../lib/errors';
import { formatDateTime, formatMoney } from '../../lib/format';
import { useToast } from '../../lib/toast';
import { Alert, Button, Card, ConfirmDialog, Input, PageHeader, Spinner } from '../../components/ui';

export default function AdminSettings() {
  const settings = usePlatformSettings();
  const qc = useQueryClient();
  const toast = useToast();
  const [v, setV] = useState({ price_per_student: PRICE_PER_STUDENT_PER_TERM.toFixed(2), billing_due_days: '14', void_grace_days: '14' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (settings.data) setV({ price_per_student: Number(settings.data.price_per_student ?? PRICE_PER_STUDENT_PER_TERM).toFixed(2), billing_due_days: String(settings.data.billing_due_days ?? 14), void_grace_days: String(settings.data.void_grace_days ?? 14) });
  }, [settings.data]);
  const m = useMutation({
    mutationFn: async () => {
      const parsed = settingsSchema.safeParse(v);
      if (!parsed.success) { setErrors(fieldErrors(parsed.error)); throw new Error('Please fix the highlighted fields.'); }
      const { data, error } = await supabase.from('platform_settings').update(parsed.data).eq('id', true).select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('You do not have permission to change platform settings.');
    },
    onSuccess: () => { toast('Platform settings saved'); setConfirm(false); qc.invalidateQueries({ queryKey: ['platform_settings'] }); },
    onError: () => setConfirm(false),
  });
  if (settings.isLoading) return <Spinner />;
  return (
    <>
      <PageHeader title="Platform settings" />
      <Card title="Pricing & billing rules">
        <form onSubmit={(e) => { e.preventDefault(); setConfirm(true); }} style={{ maxWidth: 520 }}>
          {m.error && <Alert tone="error">{friendlyError(m.error)}</Alert>}
          <Input label="Price per student per term (GH₵)" type="number" min={0} step="0.01" value={v.price_per_student}
            onChange={(e) => setV({ ...v, price_per_student: e.target.value })} error={errors.price_per_student}
            hint="Applies to term billing records generated from now on. Already-issued invoices keep their original price." />
          <Input label="Payment due (days after billing)" type="number" min={0} max={365} value={v.billing_due_days} onChange={(e) => setV({ ...v, billing_due_days: e.target.value })} error={errors.billing_due_days} />
          <Input label="Registration void grace period (days)" type="number" min={0} max={90} value={v.void_grace_days} onChange={(e) => setV({ ...v, void_grace_days: e.target.value })} error={errors.void_grace_days}
            hint="Headmasters may void a mistaken registration within this many days." />
          <Button type="submit">Save settings</Button>
          <p className="muted small" style={{ marginTop: 10 }}>Last updated {formatDateTime(settings.data?.updated_at)}. Every change is audited.</p>
        </form>
      </Card>
      <ConfirmDialog open={confirm} title="Save platform settings" confirmLabel="Save" loading={m.isPending}
        message={`New term billing records will use ${formatMoney(Number(v.price_per_student) || 0)} per student per term. Existing invoices remain unchanged.`}
        onCancel={() => setConfirm(false)} onConfirm={() => m.mutate()} />
    </>
  );
}
