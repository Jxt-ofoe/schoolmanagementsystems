import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { Spinner, Button, Alert } from './ui';

/** Redirects anonymous visitors to /login, remembering where they wanted to go. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading, ctxLoading, ctxError, signOut } = useAuth();
  const location = useLocation();
  if (loading || ctxLoading) return <div className="center-page"><Spinner /></div>;
  if (!session) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  if (ctxError) {
    return (
      <div className="center-page">
        <Alert tone="error">Could not load your account: {ctxError}</Alert>
        <Button variant="secondary" onClick={() => signOut()}>Sign out</Button>
      </div>
    );
  }
  return <>{children}</>;
}

type Need = 'super_admin' | 'headmaster' | 'teacher';

export function RequireRole({ need, children }: { need: Need; children: ReactNode }) {
  const { ctx, active } = useAuth();
  const ok =
    need === 'super_admin' ? !!ctx?.is_super_admin
      : ctx?.is_super_admin ? true
      : need === 'headmaster' ? active?.role === 'headmaster'
        : active?.role === 'teacher' || active?.role === 'headmaster';
  if (!ok) return <Forbidden />;
  return <>{children}</>;
}

export function Forbidden() {
  return (
    <div className="center-page">
      <h1>Access denied</h1>
      <p className="muted">Your account does not have permission to view this page.</p>
      <a className="btn btn-secondary" href="/">Go to my home page</a>
    </div>
  );
}

export function NotFound() {
  return (
    <div className="center-page">
      <h1>Page not found</h1>
      <p className="muted">The page you are looking for does not exist or has moved.</p>
      <a className="btn btn-secondary" href="/">Go to my home page</a>
    </div>
  );
}

/** Sends a signed-in user to the right home for their role. */
export function RoleHome() {
  const { ctx, active } = useAuth();
  if (ctx?.is_super_admin) return <Navigate to="/admin" replace />;
  if (active?.role === 'headmaster') return <Navigate to="/school" replace />;
  if (active?.role === 'teacher') return <Navigate to="/teach" replace />;
  return <NoAccess />;
}

function NoAccess() {
  const { signOut, ctx } = useAuth();
  return (
    <div className="center-page">
      <h1>No school access yet</h1>
      <p className="muted">
        You are signed in as {ctx?.profile?.email}, but your account is not linked to an active school.
        Ask your headmaster or the platform administrator to invite you.
      </p>
      <Button variant="secondary" onClick={() => signOut()}>Sign out</Button>
    </div>
  );
}
