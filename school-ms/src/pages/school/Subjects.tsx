import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useSchool } from '../../lib/auth';
import { useSubjects } from '../../lib/queries';
import { subjectSchema, fieldErrors } from '../../lib/validation';
import { friendlyError } from '../../lib/errors';
import { useToast } from '../../lib/toast';
import type { SubjectRow } from '../../lib/types';
import { Alert, Badge, Button, Card, ConfirmDialog, EmptyState, ErrorBox, Input, Modal, PageHeader, Spinner } from '../../components/ui';

export default function SubjectsPage() {
  const { schoolId } = useSchool();
  const qc = useQueryClient();
  const toast = useToast();
  const subjects = useSubjects(schoolId, { includeInactive: true });
  const [editing, setEditing] = useState<SubjectRow | 'new' | null>(null);
  const [deleting, setDeleting] = useState<SubjectRow | null>(null);

  const toggle = useMutation({
    mutationFn: async (s: SubjectRow) => {
      const { error } = await supabase.from('subjects').update({ is_active: !s.is_active }).eq('id', s.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['subjects'] }),
    onError: (e) => toast(friendlyError(e), 'error'),
  });
  const del = useMutation({
    mutationFn: async (s: SubjectRow) => {
      const { error } = await supabase.from('subjects').delete().eq('id', s.id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['subjects'] }); toast('Subject deleted'); setDeleting(null); },
    onError: (e) => { toast(friendlyError(e), 'error'); setDeleting(null); },
  });

  return (
    <>
      <PageHeader title="Subjects" actions={<Button onClick={() => setEditing('new')}>+ New subject</Button>} />
      <Card padded={false}>
        <ErrorBox error={subjects.error} onRetry={() => subjects.refetch()} />
        {subjects.isLoading ? <Spinner /> : !subjects.data?.length ? (
          <EmptyState title="No subjects yet" action={<Button onClick={() => setEditing('new')}>Add a subject</Button>}>
            For example: English Language, Mathematics, Integrated Science, Social Studies.
          </EmptyState>
        ) : (
          <div className="table-wrap"><table>
            <thead><tr><th>Subject</th><th>Code</th><th>Status</th><th></th></tr></thead>
            <tbody>{subjects.data.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td><td className="mono">{s.code ?? '—'}</td>
                <td><Badge value={s.is_active ? 'active' : 'inactive'}>{s.is_active ? 'Active' : 'Archived'}</Badge></td>
                <td><div className="table-actions">
                  <Button size="sm" variant="secondary" onClick={() => setEditing(s)}>Edit</Button>
                  <Button size="sm" variant="ghost" onClick={() => toggle.mutate(s)}>{s.is_active ? 'Archive' : 'Restore'}</Button>
                  <Button size="sm" variant="ghost" onClick={() => setDeleting(s)}>Delete</Button>
                </div></td>
              </tr>))}
            </tbody>
          </table></div>
        )}
      </Card>
      {editing && <SubjectModal schoolId={schoolId} subject={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog open={!!deleting} danger title="Delete subject" confirmLabel="Delete" loading={del.isPending}
        message={`Delete ${deleting?.name}? This is blocked if assessments exist for it — archive it instead to keep grade history.`}
        onCancel={() => setDeleting(null)} onConfirm={() => deleting && del.mutate(deleting)} />
    </>
  );
}

function SubjectModal({ schoolId, subject, onClose }: { schoolId: string; subject: SubjectRow | null; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [v, setV] = useState({ name: subject?.name ?? '', code: subject?.code ?? '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: async () => {
      const parsed = subjectSchema.safeParse(v);
      if (!parsed.success) { setErrors(fieldErrors(parsed.error)); throw new Error('Please fix the highlighted fields.'); }
      const q = subject ? supabase.from('subjects').update(parsed.data).eq('id', subject.id) : supabase.from('subjects').insert({ ...parsed.data, school_id: schoolId });
      const { error } = await q;
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['subjects'] }); toast('Subject saved'); onClose(); },
  });
  return (
    <Modal open title={subject ? 'Edit subject' : 'New subject'} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => m.mutate()} loading={m.isPending}>Save</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        {m.error && <Alert tone="error">{friendlyError(m.error)}</Alert>}
        <Input label="Subject name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} error={errors.name} required />
        <Input label="Code" value={v.code} onChange={(e) => setV({ ...v, code: e.target.value })} error={errors.code} placeholder="MATH (optional)" />
      </form>
    </Modal>
  );
}
