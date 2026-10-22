import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { useToast } from '../../lib/toast';
import { friendlyError } from '../../lib/errors';
import { passwordSchema } from '../../lib/validation';
import { Button, Card, Input, PageHeader, Alert, Badge } from '../../components/ui';
import { humanize } from '../../lib/format';

export default function AccountPage() {
  const { ctx, refreshContext } = useAuth();
  const toast = useToast();
  const [fullName, setFullName] = useState(ctx?.profile?.full_name ?? '');
  const [phone, setPhone] = useState(ctx?.profile?.phone ?? '');
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pwError, setPwError] = useState<string | null>(null);

  const saveProfile = useMutation({
    mutationFn: async () => {
      if (fullName.trim().length < 2) throw new Error('Enter your full name');
      const { error } = await supabase.from('profiles').update({ full_name: fullName.trim(), phone: phone.trim() || null }).eq('id', ctx!.user_id);
      if (error) throw error;
    },
    onSuccess: async () => { toast('Profile saved'); await refreshContext(); },
    onError: (e) => toast(friendlyError(e), 'error'),
  });

  const changePassword = useMutation({
    mutationFn: async () => {
      const parsed = passwordSchema.safeParse(next);
      if (!parsed.success) throw new Error(parsed.error.issues[0].message);
      if (next !== confirm) throw new Error('New passwords do not match.');
      // Re-verify the current password before changing it
      const { error: reauth } = await supabase.auth.signInWithPassword({ email: ctx!.profile!.email!, password: current });
      if (reauth) throw new Error('Your current password is incorrect.');
      const { error } = await supabase.auth.updateUser({ password: next });
      if (error) throw error;
    },
    onSuccess: () => { toast('Password changed'); setCurrent(''); setNext(''); setConfirm(''); setPwError(null); },
    onError: (e) => setPwError(friendlyError(e)),
  });

  return (
    <>
      <PageHeader title="My account" subtitle={ctx?.profile?.email} />
      <div className="grid-2">
        <Card title="Profile">
          <form onSubmit={(e: FormEvent) => { e.preventDefault(); saveProfile.mutate(); }}>
            <Input label="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            <Input label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            <Button type="submit" loading={saveProfile.isPending}>Save profile</Button>
          </form>
          <h3 style={{ marginTop: 20 }}>Access</h3>
          <ul className="list-plain">
            {ctx?.is_super_admin && <li><Badge tone="info">Platform super admin</Badge></li>}
            {ctx?.memberships.map((m) => (
              <li key={m.school_id} className="row-between"><span>{m.school_name}</span><Badge value={m.role}>{humanize(m.role)}</Badge></li>
            ))}
          </ul>
        </Card>
        <Card title="Change password">
          <form onSubmit={(e: FormEvent) => { e.preventDefault(); changePassword.mutate(); }}>
            {pwError && <Alert tone="error">{pwError}</Alert>}
            <Input label="Current password" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
            <Input label="New password" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)}
              hint="At least 8 characters, with a letter and a number" required />
            <Input label="Confirm new password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
            <Button type="submit" loading={changePassword.isPending}>Change password</Button>
          </form>
        </Card>
      </div>
    </>
  );
}
