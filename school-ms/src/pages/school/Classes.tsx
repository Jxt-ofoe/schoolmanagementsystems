import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useSchool } from '../../lib/auth';
import { unwrap, useClasses } from '../../lib/queries';
import { classSchema, fieldErrors } from '../../lib/validation';
import { friendlyError } from '../../lib/errors';
import { useToast } from '../../lib/toast';
import { classLabel } from '../../lib/format';
import type { ClassRow } from '../../lib/types';
import { Alert, Badge, Button, Card, ConfirmDialog, EmptyState, ErrorBox, Input, Modal, PageHeader, Spinner } from '../../components/ui';

export default function ClassesPage() {
  const { schoolId } = useSchool();
  const qc = useQueryClient();
  const toast = useToast();
  const classes = useClasses(schoolId, { includeInactive: true });
  const counts = useQuery({
    queryKey: ['class_counts', schoolId],
    queryFn: () => unwrap<{ class_id: string | null; active: number; total: number }[]>(supabase.rpc('class_student_counts', { p_school_id: schoolId })),
  });
  const [editing, setEditing] = useState<ClassRow | 'new' | null>(null);
  const [deleting, setDeleting] = useState<ClassRow | null>(null);
  const countOf = (id: string) => counts.data?.find((c) => c.class_id === id);

  const toggle = useMutation({
    mutationFn: async (c: ClassRow) => unwrap(supabase.from('classes').update({ is_active: !c.is_active }).eq('id', c.id).select('id')),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['classes'] }); toast('Class updated'); },
    onError: (e) => toast(friendlyError(e), 'error'),
  });
  const del = useMutation({
    mutationFn: async (c: ClassRow) => {
      const { error } = await supabase.from('classes').delete().eq('id', c.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['classes'] }); toast('Class deleted'); setDeleting(null); },
    onError: (e) => { toast(friendlyError(e), 'error'); setDeleting(null); },
  });

  return (
    <>
      <PageHeader title="Classes" subtitle="Create your school's own classes and sections. Order controls how they are listed."
        actions={<Button onClick={() => setEditing('new')}>+ New class</Button>} />
      <Card padded={false}>
        <ErrorBox error={classes.error} onRetry={() => classes.refetch()} />
        {classes.isLoading ? <Spinner /> : !classes.data?.length ? (
          <EmptyState title="No classes yet" action={<Button onClick={() => setEditing('new')}>Create a class</Button>}>
            Examples: KG 1, Class 1, Class 2 A, JHS 1 Gold.
          </EmptyState>
        ) : (
          <div className="table-wrap"><table>
            <thead><tr><th>Order</th><th>Class</th><th className="num">Active students</th><th className="num">Capacity</th><th>Status</th><th></th></tr></thead>
            <tbody>{classes.data.map((c) => (
              <tr key={c.id}>
                <td className="muted">{c.level_order}</td>
                <td><Link to={`/school/students/class/${c.id}`}>{classLabel(c)}</Link></td>
                <td className="num">{countOf(c.id)?.active ?? 0}</td>
                <td className="num">{c.capacity ?? '—'}</td>
                <td><Badge value={c.is_active ? 'active' : 'inactive'}>{c.is_active ? 'Active' : 'Archived'}</Badge></td>
                <td><div className="table-actions">
                  <Button size="sm" variant="secondary" onClick={() => setEditing(c)}>Edit</Button>
                  <Button size="sm" variant="ghost" onClick={() => toggle.mutate(c)}>{c.is_active ? 'Archive' : 'Restore'}</Button>
                  <Button size="sm" variant="ghost" onClick={() => setDeleting(c)} disabled={(countOf(c.id)?.total ?? 0) > 0}
                    title={(countOf(c.id)?.total ?? 0) > 0 ? 'Move students out first, or archive the class' : undefined}>Delete</Button>
                </div></td>
              </tr>))}
            </tbody>
          </table></div>
        )}
      </Card>
      {editing && <ClassModal schoolId={schoolId} cls={editing === 'new' ? null : editing} nextOrder={(classes.data?.length ?? 0) + 1} onClose={() => setEditing(null)} />}
      <ConfirmDialog open={!!deleting} danger title="Delete class" confirmLabel="Delete" loading={del.isPending}
        message={`Delete ${deleting ? classLabel(deleting) : ''}? Its teacher assignments and attendance history will also be removed. Archive instead if you want to keep history.`}
        onCancel={() => setDeleting(null)} onConfirm={() => deleting && del.mutate(deleting)} />
    </>
  );
}

function ClassModal({ schoolId, cls, nextOrder, onClose }: { schoolId: string; cls: ClassRow | null; nextOrder: number; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [v, setV] = useState({ name: cls?.name ?? '', section: cls?.section ?? '', level_order: String(cls?.level_order ?? nextOrder), capacity: cls?.capacity ? String(cls.capacity) : '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: async () => {
      const parsed = classSchema.safeParse(v);
      if (!parsed.success) { setErrors(fieldErrors(parsed.error)); throw new Error('Please fix the highlighted fields.'); }
      setErrors({});
      const q = cls ? supabase.from('classes').update(parsed.data).eq('id', cls.id) : supabase.from('classes').insert({ ...parsed.data, school_id: schoolId });
      const { error } = await q;
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['classes'] }); toast(cls ? 'Class updated' : 'Class created'); onClose(); },
  });
  return (
    <Modal open title={cls ? 'Edit class' : 'New class'} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => m.mutate()} loading={m.isPending}>Save</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        {m.error && <Alert tone="error">{friendlyError(m.error)}</Alert>}
        <div className="form-grid">
          <Input label="Class name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} error={errors.name} placeholder="Class 1" required />
          <Input label="Section / stream" value={v.section} onChange={(e) => setV({ ...v, section: e.target.value })} error={errors.section} placeholder="A (optional)" />
          <Input label="Display order" type="number" min={0} value={v.level_order} onChange={(e) => setV({ ...v, level_order: e.target.value })} error={errors.level_order} />
          <Input label="Capacity" type="number" min={1} value={v.capacity} onChange={(e) => setV({ ...v, capacity: e.target.value })} error={errors.capacity} placeholder="Optional" />
        </div>
      </form>
    </Modal>
  );
}
