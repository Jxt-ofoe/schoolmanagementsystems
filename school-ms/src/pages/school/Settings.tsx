import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth, useSchool } from '../../lib/auth';
import { useGradeBands, useSchoolDetails } from '../../lib/queries';
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
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [confirmDeleteLogo, setConfirmDeleteLogo] = useState(false);

  const school = useSchoolDetails(schoolId);

  const [v, setV] = useState({ name: '', email: '', phone: '', address: '', region: '', motto: '' });
  useEffect(() => {
    if (school.data) {
      setV({
        name: school.data.name,
        email: school.data.email ?? '',
        phone: school.data.phone ?? '',
        address: school.data.address ?? '',
        region: school.data.region ?? '',
        motto: school.data.motto ?? '',
      });
    }
  }, [school.data]);

  const m = useMutation({
    mutationFn: async () => {
      if (v.name.trim().length < 2) throw new Error('School name is required');
      const clean = Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x.trim() || null]));
      const { error } = await supabase.from('schools').update(clean).eq('id', schoolId);
      if (error) throw error;
    },
    onSuccess: async () => {
      toast('School profile saved');
      qc.invalidateQueries({ queryKey: ['school', schoolId] });
      qc.invalidateQueries({ queryKey: ['school_details', schoolId] });
      await refreshContext();
    },
  });

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 3 * 1024 * 1024) {
      toast('Image file exceeds 3MB limit. Please select a smaller file.', 'error');
      return;
    }

    setUploading(true);
    try {
      const reader = new FileReader();
      const base64Promise = new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
      });
      reader.readAsDataURL(file);
      const dataUrl = await base64Promise;

      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;

      const res = await fetch('/api/school/logo', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          school_id: schoolId,
          file: dataUrl,
          content_type: file.type,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Failed to upload school logo');
      }

      toast('School logo uploaded successfully!');
      qc.invalidateQueries({ queryKey: ['school', schoolId] });
      qc.invalidateQueries({ queryKey: ['school_details', schoolId] });
      qc.invalidateQueries({ queryKey: ['my_context'] });
      await refreshContext();
    } catch (err: any) {
      toast(friendlyError(err), 'error');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRemoveLogo = async () => {
    setUploading(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;

      const res = await fetch('/api/school/logo', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          school_id: schoolId,
          remove: true,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Failed to remove school logo');
      }

      toast('School logo removed');
      setConfirmDeleteLogo(false);
      qc.invalidateQueries({ queryKey: ['school', schoolId] });
      qc.invalidateQueries({ queryKey: ['school_details', schoolId] });
      qc.invalidateQueries({ queryKey: ['my_context'] });
      await refreshContext();
    } catch (err: any) {
      toast(friendlyError(err), 'error');
    } finally {
      setUploading(false);
    }
  };

  if (school.isLoading) return <Card title="School profile"><Spinner /></Card>;

  const logoUrl = school.data?.logo_url;

  return (
    <Card title="School profile">
      {/* School Logo Section */}
      <div style={{
        padding: '16px',
        marginBottom: '20px',
        background: 'var(--surface-sunken, #f8fafc)',
        borderRadius: 'var(--radius, 8px)',
        border: '1px solid var(--line, #e2e8f0)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '18px', flexWrap: 'wrap' }}>
          <div style={{
            width: 80,
            height: 80,
            borderRadius: 10,
            border: '2px dashed var(--line, #cbd5e1)',
            background: '#ffffff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
            flexShrink: 0,
          }}>
            {logoUrl ? (
              <img
                src={logoUrl}
                alt={school.data?.name || 'School Logo'}
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              />
            ) : (
              <div style={{ textAlign: 'center', color: 'var(--muted, #64748b)' }}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M12 3 2 8l10 5 10-5-10-5Zm-6 8v5c0 2 3 4 6 4s6-2 6-4v-5" />
                </svg>
              </div>
            )}
          </div>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontWeight: 600, fontSize: '0.95rem', marginBottom: 2 }}>
              Official School Logo
            </div>
            <div style={{ fontSize: '0.82rem', color: 'var(--muted, #64748b)', marginBottom: 10 }}>
              {logoUrl ? 'Custom logo active. Displayed on terminal reports, receipts, and navigation.' : 'No custom logo uploaded yet. Default system emblem is used.'}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input
                type="file"
                ref={fileInputRef}
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                onChange={handleFileSelect}
                style={{ display: 'none' }}
              />
              <Button
                type="button"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                loading={uploading}
              >
                {logoUrl ? '📷 Change Logo' : '📤 Upload School Logo'}
              </Button>
              {logoUrl && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmDeleteLogo(true)}
                  disabled={uploading}
                >
                  Remove
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

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

      <ConfirmDialog
        open={confirmDeleteLogo}
        danger
        title="Remove school logo"
        confirmLabel="Remove Logo"
        loading={uploading}
        message="Are you sure you want to remove the custom school logo? The school will revert to the default emblem."
        onCancel={() => setConfirmDeleteLogo(false)}
        onConfirm={handleRemoveLogo}
      />
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
