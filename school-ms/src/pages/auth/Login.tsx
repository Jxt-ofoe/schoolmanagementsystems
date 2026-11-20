import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { Button, Input, Alert } from '../../components/ui';
import { emailSchema } from '../../lib/validation';

import { AuthFooter } from '../../components/auth-footer';
import { LiquidGlassBackground } from '../../components/LiquidGlassBackground';

/** Only same-site relative paths are allowed after login (prevents open redirects). */
export function safeRedirect(next: string | null): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\') || /[\u0000-\u001f]/.test(next)) return '/';
  if (next.startsWith('/login')) return '/';
  return next;
}

export function LoginPage() {
  const { session, loading } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const next = params.get('next');
  const safeNext = safeRedirect(next);

  if (!loading && session) return <Navigate to={safeNext} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) return setError('Enter a valid email address.');
    if (!password) return setError('Enter your password.');
    setBusy(true);
    const { error: err } = await supabase.auth.signInWithPassword({ email: parsed.data, password });
    setBusy(false);
    if (err) {
      // Do not reveal whether the email exists
      setError(err.message.toLowerCase().includes('invalid') ? 'Incorrect email or password.' : err.message);
      return;
    }
    navigate(safeNext, { replace: true });
  }

  return (
    <div className="auth-page">
      <LiquidGlassBackground />
      <form className="auth-card" onSubmit={submit} noValidate>
        <img src="/favicon.svg" width="44" height="44" alt="" />
        <h1>Sign in</h1>
        <p className="muted">School Management System</p>
        {params.get('reset') === 'done' && <Alert tone="success">Password updated. Sign in with your new password.</Alert>}
        {error && <Alert tone="error">{error}</Alert>}
        <Input label="Email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <Input label="Password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <Button type="submit" size="lg" loading={busy}>Sign in</Button>
        <div className="auth-links"><Link to="/forgot-password">Forgot your password?</Link></div>
        <p className="muted small" style={{ marginTop: 16, textAlign: 'center' }}>
          Accounts are created by invitation from your headmaster or the platform administrator.
        </p>
        <AuthFooter />
      </form>
    </div>
  );
}
