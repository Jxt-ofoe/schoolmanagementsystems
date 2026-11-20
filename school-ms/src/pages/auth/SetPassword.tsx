import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { Button, Input, Alert, Spinner } from '../../components/ui';
import { passwordSchema } from '../../lib/validation';
import { LiquidGlassBackground } from '../../components/LiquidGlassBackground';

/**
 * Landing page for both invitation links and password-reset links.
 * Supabase Auth places a short-lived session in the URL; supabase-js picks it up.
 */
export function SetPasswordPage() {
  const { session, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const hashError = new URLSearchParams(window.location.hash.slice(1)).get('error_description');

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = passwordSchema.safeParse(password);
    if (!parsed.success) return setError(parsed.error.issues[0].message);
    if (password !== confirm) return setError('Passwords do not match.');
    setBusy(true);
    const { error: err } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (err) return setError(err.message);
    await signOut();
    navigate('/login?reset=done', { replace: true });
  }

  if (loading) return <div className="auth-page"><LiquidGlassBackground /><div className="auth-card"><Spinner /></div></div>;

  return (
    <div className="auth-page">
      <LiquidGlassBackground />
      <form className="auth-card" onSubmit={submit} noValidate>
        <img src="/favicon.svg" width="44" height="44" alt="" />
        <h1>Set your password</h1>
        {!session ? (
          <>
            <Alert tone="error">{hashError ?? 'This link is invalid or has expired.'}</Alert>
            <p className="muted">Request a new link and open it on this device.</p>
            <div className="auth-links"><Link to="/forgot-password">Request a new link</Link></div>
          </>
        ) : (
          <>
            <p className="muted">Signed in as <strong>{session.user.email}</strong>. Choose a password only you know.</p>
            {error && <Alert tone="error">{error}</Alert>}
            <Input label="New password" type="password" autoComplete="new-password" value={password}
              onChange={(e) => setPassword(e.target.value)} hint="At least 8 characters, with a letter and a number" required />
            <Input label="Confirm password" type="password" autoComplete="new-password" value={confirm}
              onChange={(e) => setConfirm(e.target.value)} required />
            <Button type="submit" size="lg" loading={busy}>Save password</Button>
          </>
        )}
      </form>
    </div>
  );
}
