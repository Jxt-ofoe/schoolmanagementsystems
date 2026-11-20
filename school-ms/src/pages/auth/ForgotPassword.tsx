import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Button, Input, Alert } from '../../components/ui';
import { emailSchema } from '../../lib/validation';
import { LiquidGlassBackground } from '../../components/LiquidGlassBackground';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) return setError('Enter a valid email address.');
    setBusy(true);
    const { error: err } = await supabase.auth.resetPasswordForEmail(parsed.data, {
      redirectTo: `${window.location.origin}/set-password`,
    });
    setBusy(false);
    // Always show the same message so the form cannot be used to discover accounts
    if (err && err.status !== 400 && err.status !== 404) setError(err.message);
    else setSent(true);
  }

  return (
    <div className="auth-page">
      <LiquidGlassBackground />
      <form className="auth-card" onSubmit={submit} noValidate>
        <img src="/favicon.svg" width="44" height="44" alt="" />
        <h1>Reset your password</h1>
        {sent ? (
          <Alert tone="success">If an account exists for {email}, a reset link is on its way. Check your inbox.</Alert>
        ) : (
          <>
            <p className="muted">Enter your email and we will send you a secure link to set a new password.</p>
            {error && <Alert tone="error">{error}</Alert>}
            <Input label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <Button type="submit" size="lg" loading={busy}>Send reset link</Button>
          </>
        )}
        <div className="auth-links"><Link to="/login">Back to sign in</Link></div>
      </form>
    </div>
  );
}
