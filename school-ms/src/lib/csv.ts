export function toCsv(rows: Record<string, unknown>[], columns?: { key: string; label: string }[]): string {
  const cols = columns ?? (rows[0] ? Object.keys(rows[0]).map((k) => ({ key: k, label: k })) : []);
  const esc = (v: unknown) => {
    if (v === null || v === undefined) return '';
    let s = String(v);
    // neutralise spreadsheet formula injection
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.map((c) => esc(c.label)).join(',')];
  for (const r of rows) lines.push(cols.map((c) => esc(r[c.key])).join(','));
  return lines.join('\r\n');
}

export function downloadCsv(filename: string, rows: Record<string, unknown>[], columns?: { key: string; label: string }[]) {
  const blob = new Blob(['\ufeff' + toCsv(rows, columns)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
