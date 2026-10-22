import { toCsv } from '../csv';
import { addDays, classLabel, formatMoney, humanize, ilikePattern, slugify, todayISO } from '../format';

describe('toCsv', () => {
  it('escapes quotes, commas and newlines', () => {
    expect(toCsv([{ a: 'x,y', b: 'say "hi"', c: 'l1\nl2' }])).toBe('a,b,c\r\n"x,y","say ""hi""","l1\nl2"');
  });
  it('neutralises spreadsheet formulas', () => {
    expect(toCsv([{ a: '=HYPERLINK("x")' }, { a: '+1' }, { a: '-2' }, { a: '@SUM(1)' }])).toBe('a\r\n"\'=HYPERLINK(""x"")"\r\n\'+1\r\n\'-2\r\n\'@SUM(1)');
  });
  it('uses provided column labels and order', () => {
    expect(toCsv([{ x: 1, y: null }], [{ key: 'y', label: 'Why' }, { key: 'x', label: 'Ex' }])).toBe('Why,Ex\r\n,1');
  });
});

describe('format helpers', () => {
  it('escapes LIKE wildcards and PostgREST filter separators', () => {
    expect(ilikePattern(' Ama ')).toBe('%ama%');
    expect(ilikePattern('100%_\\')).toBe('%100\\%\\_\\\\%');
    expect(ilikePattern('a,b(c)')).toBe('%a b c %');
  });
  it('formats money in cedis', () => {
    expect(formatMoney(300)).toMatch(/300\.00/);
    expect(formatMoney(null)).toMatch(/0\.00/);
  });
  it('handles dates in local time', () => {
    expect(todayISO(new Date(2026, 9, 22, 23, 30))).toBe('2026-10-22');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
  it('labels classes and humanises codes', () => {
    expect(classLabel({ name: 'JHS 1', section: 'A' })).toContain('A');
    expect(classLabel({ name: 'Basic 4' })).toBe('Basic 4');
    expect(humanize('not_started')).toBe('Not Started');
    expect(slugify('St. Mary\'s Senior High!')).toBe('st-marys-senior-high');
  });
});
