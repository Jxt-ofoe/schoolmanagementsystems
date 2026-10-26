import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { isLocalStack } from '../lib/supabase';
import { humanize } from '../lib/format';

interface NavItem { to: string; label: string; icon: ReactNode; end?: boolean }

const i = (d: string) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);
const icons = {
  home: i('M3 11 12 4l9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z'),
  school: i('M12 3 2 8l10 5 10-5-10-5Zm-6 8v5c0 2 3 4 6 4s6-2 6-4v-5'),
  money: i('M3 7h18v10H3zM12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM6 12h.01M18 12h.01'),
  gear: i('M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'),
  log: i('M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM14 3v6h6M8 13h8M8 17h5'),
  users: i('M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8'),
  grid: i('M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z'),
  book: i('M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14zM4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5'),
  teacher: i('M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1'),
  calendar: i('M3 6h18v15H3zM16 3v4M8 3v4M3 10h18'),
  check: i('M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11'),
  chart: i('M3 3v18h18M7 15l4-4 3 3 5-6'),
  report: i('M6 2h9l5 5v15H6zM9 13h6M9 17h6M9 9h2'),
  exam: i('M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v0a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2v0m1 9 2 2 4-4'),
  table: i('M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18'),
  promote: i('M13 7l5 5m0 0l-5 5m5-5H6'),
  fee: i('M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6'),
  renew: i('M21 12a9 9 0 1 1-2.6-6.4L21 8m0-6v6h-6'),
};

function navFor(isSuperAdmin: boolean, role: string | undefined): { section: string; items: NavItem[] }[] {
  const sections: { section: string; items: NavItem[] }[] = [];
  if (isSuperAdmin) {
    sections.push({ section: 'Platform', items: [
      { to: '/admin', label: 'Overview', icon: icons.home, end: true },
      { to: '/admin/schools', label: 'Schools', icon: icons.school },
      { to: '/admin/billing', label: 'Billing', icon: icons.money },
      { to: '/admin/renewals', label: 'Renewals & Invoices', icon: icons.renew },
      { to: '/admin/settings', label: 'Settings', icon: icons.gear },
      { to: '/admin/audit', label: 'Audit log', icon: icons.log },
    ] });
  }
  if (role === 'headmaster') {
    sections.push({ section: 'Academic', items: [
      { to: '/school', label: 'Dashboard', icon: icons.home, end: true },
      { to: '/school/students', label: 'Students', icon: icons.users },
      { to: '/school/examinations', label: 'Examinations', icon: icons.exam },
      { to: '/school/consolidated', label: 'Consolidated Results', icon: icons.table },
      { to: '/school/reports/terminal', label: 'Terminal Reports', icon: icons.report },
      { to: '/school/promotions', label: 'Student Promotion', icon: icons.promote },
      { to: '/school/fees', label: 'Fees & Payments', icon: icons.fee },
      { to: '/school/attendance', label: 'Attendance', icon: icons.check },
      { to: '/school/grades', label: 'Grades Overview', icon: icons.chart },
      { to: '/school/reports', label: 'Analytics Reports', icon: icons.report },
    ] });
    sections.push({ section: 'Setup', items: [
      { to: '/school/teachers', label: 'Teachers', icon: icons.teacher },
      { to: '/school/classes', label: 'Classes', icon: icons.grid },
      { to: '/school/subjects', label: 'Subjects', icon: icons.book },
      { to: '/school/academic', label: 'Academic calendar', icon: icons.calendar },
      { to: '/school/billing', label: 'Subscription Billing', icon: icons.money },
      { to: '/school/settings', label: 'School settings', icon: icons.gear },
    ] });
  }
  if (role === 'teacher') {
    sections.push({ section: 'Teaching', items: [
      { to: '/teach', label: 'My dashboard', icon: icons.home, end: true },
      { to: '/teach/students', label: 'My students', icon: icons.users },
      { to: '/teach/consolidated', label: 'Class Results', icon: icons.table },
      { to: '/teach/reports', label: 'Terminal Reports', icon: icons.report },
      { to: '/teach/grades', label: 'Enter Grades', icon: icons.chart },
      { to: '/teach/attendance', label: 'Attendance', icon: icons.check },
    ] });
  }
  return sections;
}


export function Layout() {
  const { ctx, active, setActiveSchool, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => setOpen(false), [location.pathname]);

  const sections = navFor(!!ctx?.is_super_admin, active?.role);
  const name = ctx?.profile?.full_name || ctx?.profile?.email || 'Account';

  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">Skip to content</a>
      <header className="topbar">
        <button className="menu-btn" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <svg width="22" height="22" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M3 6h18M3 12h18M3 18h18" /></svg>
        </button>
        <div className="brand">
          <img src="/favicon.svg" alt="" width="28" height="28" />
          <span>{active?.school_name ?? 'School Management'}</span>
        </div>
        <div className="topbar-right">
          {isLocalStack && <span className="badge badge-warn" title="Running against the local development stack">Local dev</span>}
        </div>
      </header>

      <aside className={`sidebar ${open ? 'open' : ''}`} aria-label="Main navigation">
        <div className="sidebar-brand">
          <img src="/favicon.svg" alt="" width="32" height="32" />
          <div>
            <strong>School MS</strong>
            <small>{ctx?.is_super_admin ? 'Platform admin' : humanize(active?.role)}</small>
          </div>
        </div>
        {(ctx?.memberships.length ?? 0) > 1 && (
          <div className="school-switch">
            <label htmlFor="school-switch">School</label>
            <select id="school-switch" value={active?.school_id} onChange={(e) => {
              setActiveSchool(e.target.value);
              const m = ctx!.memberships.find((x) => x.school_id === e.target.value);
              navigate(m?.role === 'headmaster' ? '/school' : '/teach');
            }}>
              {ctx!.memberships.map((m) => <option key={m.school_id} value={m.school_id}>{m.school_name} ({m.role})</option>)}
            </select>
          </div>
        )}
        <nav>
          {sections.map((s) => (
            <div key={s.section} className="nav-section">
              <div className="nav-heading">{s.section}</div>
              {s.items.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                  {item.icon}<span>{item.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          <NavLink to="/account" className="nav-link">{icons.teacher}<span className="truncate">{name}</span></NavLink>
          <button className="nav-link as-button" onClick={async () => { await signOut(); navigate('/login'); }}>
            {i('M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9')}<span>Sign out</span>
          </button>
        </div>
      </aside>
      {open && <div className="scrim" onClick={() => setOpen(false)} aria-hidden />}

      <main id="main" className="main">
        {active && active.school_status !== 'active' && !ctx?.is_super_admin && (
          <div className="alert alert-warn">
            This school is currently <strong>{active.school_status}</strong>. Access to school records is paused.
            Headmasters can still view billing; contact the platform administrator to reactivate.
          </div>
        )}
        <Outlet />
      </main>
    </div>
  );
}
