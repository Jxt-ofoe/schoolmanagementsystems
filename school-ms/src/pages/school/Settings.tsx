import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth, useSchool } from '../../lib/auth';
import { unwrap, useGradeBands } from '../../lib/queries';
import { friendlyError } from '../../lib/errors';
import { useToast } from '../../lib/toast';
import type { GradeBand } from '../../lib/types';
import { Alert, Button, Card, ConfirmDialog, Input, Modal, PageHeader, Spinner } from '../../components/ui';

export default function SchoolSettingsPage() {
  return (
    <>
      <PageHeader title="School settings" />
      <div className="grid-2"><SchoolProfile /><GradingScale /></div>
    </>
  );
}

function SchoolProfile() {
  const { schoolId } = useSchool();
  const { refreshContext } = useAuth();
  const toast = useToast();
  const school = useQuery({
    queryKey: ['school', schoolId],
    queryFn: () => unwrap<{ name: string; code: string; email: string | null; phone: string | null; address: string | null; region: string | null; motto: string | null; status: string }>(
      supabase.from('schools').select('*').eq('id', schoolId).single()),
  });
  const [v, setV] = useState({ name: '', email: '', phone: '', address: '', region: '', motto: '' });
  useEffect(() => {
    if (school.data) setV({ name: school.data.name, email: school.data.email ?? '', phone: school.data.phone ?? '', address: school.data.address ?? '', region: school.data.region ?? '', motto: school.data.motto ?? '' });
  }, [school.data]);
  const m = useMutation({
    mutationFn: async () => {
      if (v.name.trim().length < 2) throw new Error('School name is required');
      const clean = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x.trim() || null]));
      const { error } = await supabase.from('schools').update(clean).eq('id', schoolId);
      if (error) throw error;
    },
    onSuccess: async () => { toast('School profile saved'); await refreshContext(); },
  });
  if (school.isLoading) return <Card title="School profile"><Spinner /></Card>;
  return (
    <Card title="School profile">
      <form onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        {m.error && <Alert tone="error">{friendlyError(m.error)}</Alert>}
        <Input label="School name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} required />
        <Input label="Motto" value={v.motto} onChange={(e) => setV({ ...v, motto: e.target.value })} />
        <div className="form-grid">
          <Input label="Email" type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} />
          <Input label="Phone" type="tel" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} />
        </div>
        <Input label="Region" value={v.region} onChange={(e) => setV({ ...v, region: e.target.value })} />
        <Input label="Address" value={v.address} onChange={(e) => setV({ ...v, address: e.target.value })} />
        <p className="muted small">School code: <span className="mono">{school.data?.code}</span> · status and code are managed by the platform administrator.</p>
        <Button type="submit" loading={m.isPending}>Save profile</Button>
      </form>
    </Card>
  );
}

function GradingScale() {
  const { schoolId } = useSchool();
  const bands = useGradeBands(schoolId);
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<GradeBand | 'new' | null>(null);
  const [deleting, setDeleting] = useState<GradeBand | null>(null);
  const del = useMutation({
    mutationFn: async (b: GradeBand) => { const { error } = await supabase.from('grading_scale_bands').delete().eq('id', b.id); if (error) throw error; },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['grade_bands'] }); toast('Band removed'); setDeleting(null); },
    onError: (e) => { toast(friendlyError(e), 'error'); setDeleting(null); },
  });
  return (
    <Card title="Grading scale" padded={false} actions={<Button size="sm" onClick={() => setEditing('new')} disabled={!bands.data?.scaleId}>+ Band</Button>}>
      {bands.isLoading ? <Spinner /> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Grade</th><th className="num">From %</th><th className="num">To %</th><th>Remark</th><th></th></tr></thead>
          <tbody>{bands.data?.bands.map((b) => (
            <tr key={b.id}><td><strong>{b.grade}</strong></td><td className="num">{Number(b.min_score)}</td><td className="num">{Number(b.max_score)}</td><td>{b.remark}</td>
              <td><div className="table-actions"><Button size="sm" variant="ghost" onClick={() => setEditing(b)}>Edit</Button><Button size="sm" variant="ghost" onClick={() => setDeleting(b)}>Delete</Button></div></td></tr>))}
          </tbody>
        </table></div>
      )}
      <p className="muted small" style={{ padding: '0 16px 12px' }}>A student receives the band with the highest “From %” at or below their percentage. Changes apply to all results immediately.</p>
      {editing && bands.data?.scaleId && <BandModal scaleId={bands.data.scaleId} schoolId={schoolId} band={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog open={!!deleting} danger title="Delete grade band" confirmLabel="Delete" loading={del.isPending}
        message={`Remove grade ${deleting?.grade}? Results in this range will fall to the next lower band.`} onCancel={() => setDeleting(null)} onConfirm={() => deleting && del.mutate(deleting)} />
    </Card>
  );
}

function BandModal({ scaleId, schoolId, band, onClose }: { scaleId: string; schoolId: string; band: GradeBand | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [v, setV] = useState({ grade: band?.grade ?? '', min_score: String(band?.min_score ?? ''), max_score: String(band?.max_score ?? ''), remark: band?.remark ?? '' });
  const m = useMutation({
    mutationFn: async () => {
      const min = Number(v.min_score); const max = Number(v.max_score);
      if (!v.grade.trim()) throw new Error('Grade is required');
      if (Number.isNaN(min) || Number.isNaN(max) || min < 0 || max > 100 || min > max) throw new Error('Enter a valid range between 0 and 100');
      const payload = { grade: v.grade.trim(), min_score: min, max_score: max, remark: v.remark.trim() || null };
      const q = band ? supabase.from('grading_scale_bands').update(payload).eq('id', band.id)
        : supabase.from('grading_scale_bands').insert({ ...payload, scale_id: scaleId, school_id: schoolId });
      const { error } = await q;
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['grade_bands'] }); toast('Band saved'); onClose(); },
  });
  return (
    <Modal open title={band ? 'Edit band' : 'New band'} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => m.mutate()} loading={m.isPending}>Save</Button></>}>
      {m.error && <Alert tone="error">{friendlyError(m.error)}</Alert>}
      <div className="form-grid">
        <Input label="Grade" value={v.grade} onChange={(e) => setV({ ...v, grade: e.target.value })} required />
        <Input label="Remark" value={v.remark} onChange={(e) => setV({ ...v, remark: e.target.value })} />
        <Input label="From %" type="number" min={0} max={100} step="0.01" value={v.min_score} onChange={(e) => setV({ ...v, min_score: e.target.value })} required />
        <Input label="To %" type="number" min={0} max={100} step="0.01" value={v.max_score} onChange={(e) => setV({ ...v, max_score: e.target.value })} required />
      </div>
    </Modal>
  );
}
