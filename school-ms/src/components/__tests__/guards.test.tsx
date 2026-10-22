import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { vi } from 'vitest';
import { RequireAuth, RequireRole, RoleHome } from '../guards';
import { safeRedirect } from '../../pages/auth/Login';

const state: Record<string, unknown> = {};
vi.mock('../../lib/auth', () => ({ useAuth: () => state }));
const base = { loading: false, ctxLoading: false, ctxError: null, recovery: false, signOut: vi.fn(), setActiveSchool: vi.fn(), refreshContext: vi.fn() };
const setAuth = (s: Record<string, unknown>) => { for (const k of Object.keys(state)) delete state[k]; Object.assign(state, base, s); };
const session = { user: { id: 'u1' } };
const member = (role: string) => ({ school_id: 's1', school_name: 'Test School', role, status: 'active', school_status: 'active' });

function Where() { const l = useLocation(); return <div data-testid="where">{l.pathname + l.search}</div>; }
function renderAt(path: string, el: JSX.Element) {
  return render(<MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/login" element={<Where />} /><Route path="/admin" element={<Where />} /><Route path="/school" element={<Where />} /><Route path="/teach" element={<Where />} />
    <Route path="*" element={el} />
  </Routes></MemoryRouter>);
}

describe('protected routes', () => {
  it('redirects anonymous users to /login with ?next=', () => {
    setAuth({ session: null, ctx: null, active: null });
    renderAt('/school/students?q=ama', <RequireAuth><p>secret</p></RequireAuth>);
    expect(screen.getByTestId('where').textContent).toBe('/login?next=%2Fschool%2Fstudents%3Fq%3Dama');
    expect(screen.queryByText('secret')).toBeNull();
  });
  it('renders children for signed-in users', () => {
    setAuth({ session, ctx: { is_super_admin: false, memberships: [member('teacher')] }, active: member('teacher') });
    renderAt('/teach/class/c1', <RequireAuth><p>secret</p></RequireAuth>);
    expect(screen.getByText('secret')).toBeInTheDocument();
  });
  it('shows Access denied when a teacher opens a headmaster page', () => {
    setAuth({ session, ctx: { is_super_admin: false }, active: member('teacher') });
    renderAt('/school/billing', <RequireRole need="headmaster"><p>billing</p></RequireRole>);
    expect(screen.getByText('Access denied')).toBeInTheDocument();
    expect(screen.queryByText('billing')).toBeNull();
  });
  it('blocks headmasters from platform admin pages', () => {
    setAuth({ session, ctx: { is_super_admin: false }, active: member('headmaster') });
    renderAt('/admin/billing', <RequireRole need="super_admin"><p>admin</p></RequireRole>);
    expect(screen.getByText('Access denied')).toBeInTheDocument();
  });
  it('lets headmasters open shared attendance/grade pages', () => {
    setAuth({ session, ctx: { is_super_admin: false }, active: member('headmaster') });
    renderAt('/attendance/c1', <RequireRole need="teacher"><p>register</p></RequireRole>);
    expect(screen.getByText('register')).toBeInTheDocument();
  });
  it.each([[{ is_super_admin: true }, null, '/admin'], [{ is_super_admin: false }, member('headmaster'), '/school'], [{ is_super_admin: false }, member('teacher'), '/teach']])(
    'sends each role to its home (%#)', (ctx, active, home) => {
      setAuth({ session, ctx, active });
      renderAt('/', <RoleHome />);
      expect(screen.getByTestId('where').textContent).toBe(home);
    });
});

describe('safeRedirect (login ?next=)', () => {
  it.each([['/school/students', '/school/students'], [null, '/'], ['https://evil.com', '/'], ['//evil.com', '/'], ['/\\evil.com', '/'], ['/login?next=/x', '/']])(
    '%s → %s', (input, out) => expect(safeRedirect(input)).toBe(out));
});
