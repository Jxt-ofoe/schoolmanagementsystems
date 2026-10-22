export function formatMoney(amount: number | string | null | undefined, currency = 'GHS'): string {
  const n = Number(amount ?? 0);
  try {
    return new Intl.NumberFormat('en-GH', { style: 'currency', currency, minimumFractionDigits: 2 }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

export function formatDate(d: string | null | undefined): string {
  if (!d) return '—';
  const date = d.length === 10 ? new Date(`${d}T00:00:00`) : new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatDateTime(d: string | null | undefined): string {
  if (!d) return '—';
  const date = new Date(d);
  return date.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Local calendar date as YYYY-MM-DD (not UTC-shifted). */
export function todayISO(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return todayISO(d);
}

export function classLabel(c: { name: string; section?: string | null } | null | undefined): string {
  if (!c) return 'Unplaced';
  return c.section ? `${c.name} ${c.section}` : c.name;
}

export function studentName(s: { first_name: string; last_name: string; other_names?: string | null }): string {
  return [s.first_name, s.other_names, s.last_name].filter(Boolean).join(' ');
}

export function humanize(s: string | null | undefined): string {
  if (!s) return '';
  return s.replace(/[_.]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Escape user input for PostgREST ilike filters (%, _, commas and parentheses). */
export function ilikePattern(q: string): string {
  const cleaned = q.trim().toLowerCase().replace(/[%_\\]/g, (c) => `\\${c}`).replace(/[,()]/g, ' ');
  return `%${cleaned}%`;
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f'’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
}
