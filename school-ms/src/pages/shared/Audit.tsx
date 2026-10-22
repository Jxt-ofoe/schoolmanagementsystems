import { Fragment, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { unwrap } from '../../lib/queries';
import { formatDateTime, humanize } from '../../lib/format';
import type { AuditLog } from '../../lib/types';
import { Badge, Button, Card, EmptyState, ErrorBox, Input, PageHeader, Pagination, Select, Spinner } from '../../components/ui';

const PAGE = 30;
const ENTITIES = ['student', 'enrollment', 'class', 'subject', 'teacher_assignment', 'membership', 'attendance', 'attendance_record', 'assessment', 'score',
  'semester', 'academic_year', 'grading_band', 'school', 'billing', 'payment', 'platform_settings', 'platform_admin'];

export default function AuditPage({ scope }: { scope: 'platform' | 'school' }) {
  const { active } = useAuth();
  const [entity, setEntity] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  const schoolId = scope === 'school' ? active?.school_id : undefined;

  const logs = useQuery({
    queryKey: ['audit', scope, schoolId, entity, from, to, page],
    queryFn: async () => {
      let q = supabase.from('audit_logs').select('*', { count: 'exact' });
      if (schoolId) q = q.eq('school_id', schoolId);
      if (entity) q = q.eq('entity_type', entity);
      if (from) q = q.gte('created_at', `${from}T00:00:00`);
      if (to) q = q.lte('created_at', `${to}T23:59:59`);
      const { data, error, count } = await q.order('created_at', { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1);
      if (error) throw error;
      return { rows: data as AuditLog[], count: count ?? 0 };
    },
  });
  const actorIds = [...new Set((logs.data?.rows ?? []).map((l) => l.actor_id).filter(Boolean))] as string[];
  const actors = useQuery({
    queryKey: ['audit_actors', actorIds.join(',')],
    enabled: actorIds.length > 0,
    queryFn: () => unwrap<{ id: string; full_name: string; email: string | null }[]>(supabase.from('profiles').select('id, full_name, email').in('id', actorIds)),
  });
  const actorName = (id: string | null) => {
    if (!id) return 'System';
    const p = actors.data?.find((a) => a.id === id);
    return p ? (p.full_name || p.email || 'User') : 'User';
  };

  return (
    <>
      <PageHeader title="Audit log" subtitle={scope === 'platform' ? 'All recorded actions across the platform' : 'Recorded actions in your school. Entries cannot be edited or deleted.'} />
      <div className="filters">
        <Select label="Record type" value={entity} onChange={(e) => { setEntity(e.target.value); setPage(0); }}>
          <option value="">All</option>{ENTITIES.map((e) => <option key={e} value={e}>{humanize(e)}</option>)}
        </Select>
        <Input label="From" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(0); }} />
        <Input label="To" type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(0); }} />
      </div>
      <Card padded={false}>
        <ErrorBox error={logs.error} onRetry={() => logs.refetch()} />
        {logs.isLoading ? <Spinner /> : !logs.data?.rows.length ? <EmptyState title="No audit entries" /> : (
          <>
            <div className="table-wrap"><table>
              <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Record</th><th></th></tr></thead>
              <tbody>{logs.data.rows.map((l) => (
                <Fragment key={l.id}>
                  <tr>
                    <td className="nowrap small">{formatDateTime(l.created_at)}</td>
                    <td>{actorName(l.actor_id)} {l.actor_role && <Badge tone="neutral">{humanize(l.actor_role)}</Badge>}</td>
                    <td>{humanize(l.action)}</td>
                    <td className="small muted mono truncate" style={{ maxWidth: 160 }}>{l.entity_id}</td>
                    <td className="right"><Button size="sm" variant="ghost" onClick={() => setOpen(open === l.id ? null : l.id)}>{open === l.id ? 'Hide' : 'Details'}</Button></td>
                  </tr>
                  {open === l.id && <tr><td colSpan={5}><pre className="meta">{JSON.stringify(l.metadata, null, 2)}</pre></td></tr>}
                </Fragment>))}
              </tbody>
            </table></div>
            <Pagination page={page} pageSize={PAGE} total={logs.data.count} onPage={setPage} />
          </>
        )}
      </Card>
    </>
  );
}
