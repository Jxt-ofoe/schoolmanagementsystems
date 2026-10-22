import {
  useEffect, useId, useRef, useState,
  type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from 'react';
import { friendlyError } from '../lib/errors';
import { humanize } from '../lib/format';

/* ------------------------------------------------------------------ buttons */
type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
export function Button({
  variant = 'primary', loading, children, className = '', size, ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean; size?: 'sm' | 'lg' }) {
  return (
    <button
      className={`btn btn-${variant} ${size ? `btn-${size}` : ''} ${className}`}
      disabled={loading || rest.disabled}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <span className="spinner spinner-sm" aria-hidden />}
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------- fields */
export function Field({ label, error, hint, children, required, htmlFor }: {
  label: string; error?: string | null; hint?: string; children: ReactNode; required?: boolean; htmlFor?: string;
}) {
  return (
    <div className={`field ${error ? 'field-error' : ''}`}>
      <label htmlFor={htmlFor}>{label}{required && <span className="req" aria-hidden> *</span>}</label>
      {children}
      {hint && !error && <small className="hint">{hint}</small>}
      {error && <small className="error-text" role="alert">{error}</small>}
    </div>
  );
}

export function Input({ label, error, hint, required, ...rest }: InputHTMLAttributes<HTMLInputElement> & {
  label: string; error?: string | null; hint?: string;
}) {
  const id = useId();
  return (
    <Field label={label} error={error} hint={hint} required={required} htmlFor={rest.id ?? id}>
      <input id={rest.id ?? id} aria-invalid={!!error || undefined} required={required} {...rest} />
    </Field>
  );
}

export function Select({ label, error, hint, required, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & {
  label: string; error?: string | null; hint?: string; children: ReactNode;
}) {
  const id = useId();
  return (
    <Field label={label} error={error} hint={hint} required={required} htmlFor={rest.id ?? id}>
      <select id={rest.id ?? id} aria-invalid={!!error || undefined} required={required} {...rest}>{children}</select>
    </Field>
  );
}

export function Textarea({ label, error, hint, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string; error?: string | null; hint?: string;
}) {
  const id = useId();
  return (
    <Field label={label} error={error} hint={hint} htmlFor={rest.id ?? id}>
      <textarea id={rest.id ?? id} aria-invalid={!!error || undefined} rows={3} {...rest} />
    </Field>
  );
}

/* ------------------------------------------------------------------ layout */
export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        {back && <div className="back-link">{back}</div>}
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className = '', padded = true }: {
  title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; padded?: boolean;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <header className="card-header">
          {title && <h2>{title}</h2>}
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      <div className={padded ? 'card-body' : ''}>{children}</div>
    </section>
  );
}

export function StatCard({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'good' | 'warn' | 'bad' }) {
  return (
    <div className={`stat ${tone ? `stat-${tone}` : ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

const toneFor: Record<string, string> = {
  active: 'good', submitted: 'good', paid: 'good', renewed: 'good', present: 'good', registered: 'good', valid: 'good', open: 'good',
  draft: 'warn', partial: 'warn', pending: 'warn', late: 'warn', suspended: 'warn', planned: 'info', overpaid: 'info',
  excused: 'info', no_charge: 'neutral', not_applicable: 'neutral', graduated: 'info', closed: 'neutral',
  not_started: 'bad', unpaid: 'bad', overdue: 'bad', absent: 'bad', inactive: 'bad', withdrawn: 'neutral',
  transferred_out: 'neutral', voided: 'neutral', disabled: 'bad',
};
export function Badge({ value, tone, children }: { value?: string; tone?: string; children?: ReactNode }) {
  const t = tone ?? (value ? toneFor[value] : undefined) ?? 'neutral';
  return <span className={`badge badge-${t}`}>{children ?? humanize(value)}</span>;
}

/* ------------------------------------------------------------------ states */
export function Spinner({ label = 'Loading…' }: { label?: string }) {
  return <div className="loading" role="status"><span className="spinner" aria-hidden /> <span>{label}</span></div>;
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <svg width="40" height="40" viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M8 14h8" />
      </svg>
      <h3>{title}</h3>
      {children && <p className="muted">{children}</p>}
      {action}
    </div>
  );
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <div className="alert alert-error" role="alert">
      <span>{friendlyError(error)}</span>
      {onRetry && <Button variant="secondary" size="sm" onClick={onRetry}>Try again</Button>}
    </div>
  );
}

export function Alert({ tone = 'info', children }: { tone?: 'info' | 'warn' | 'error' | 'success'; children: ReactNode }) {
  return <div className={`alert alert-${tone}`} role={tone === 'error' || tone === 'warn' ? 'alert' : 'status'}>{children}</div>;
}

/* ------------------------------------------------------------------ modal */
export function Modal({ open, title, onClose, children, footer, wide }: {
  open: boolean; title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const first = ref.current?.querySelector<HTMLElement>('input, select, textarea, button:not(.modal-close)');
    first?.focus();
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      prev?.focus?.();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <header className="modal-header">
          <h2>{title}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', danger, onConfirm, onCancel, loading, children }: {
  open: boolean; title: string; message: ReactNode; confirmLabel?: string; danger?: boolean;
  onConfirm: () => void; onCancel: () => void; loading?: boolean; children?: ReactNode;
}) {
  return (
    <Modal open={open} title={title} onClose={onCancel}
      footer={<>
        <Button variant="secondary" onClick={onCancel} disabled={loading}>Cancel</Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>{confirmLabel}</Button>
      </>}>
      <p>{message}</p>
      {children}
    </Modal>
  );
}

/* ------------------------------------------------------------------ table helpers */
export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return <div className="pagination muted">{total} record{total === 1 ? '' : 's'}</div>;
  const from = page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);
  return (
    <nav className="pagination" aria-label="Pagination">
      <span className="muted">{from}–{to} of {total}</span>
      <div>
        <Button variant="secondary" size="sm" disabled={page === 0} onClick={() => onPage(page - 1)}>Previous</Button>
        <span className="page-num">Page {page + 1} / {pages}</span>
        <Button variant="secondary" size="sm" disabled={page + 1 >= pages} onClick={() => onPage(page + 1)}>Next</Button>
      </div>
    </nav>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} className={value === t.id ? 'active' : ''} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function ProgressBar({ value, max, label }: { value: number; max: number; label?: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className="progress-bar" style={{ width: `${pct}%` }} />
      <span>{label ?? `${pct}%`}</span>
    </div>
  );
}

/** Debounced value for search boxes. */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function SearchBox({ value, onChange, placeholder, label = 'Search' }: { value: string; onChange: (v: string) => void; placeholder?: string; label?: string }) {
  return (
    <div className="searchbox">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      <input type="search" aria-label={label} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
