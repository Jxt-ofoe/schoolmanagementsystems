import { amountDue, billableCount, paymentStatus, summarize, type Registration } from '../billing';

describe('billing: unique registered students × configured price', () => {
  it('counts each student once and excludes voided registrations', () => {
    const regs: Registration[] = [
      { student_id: 's1', status: 'registered' }, { student_id: 's1', status: 'registered' }, // duplicate row
      { student_id: 's2', status: 'withdrawn' },       // withdrawn after registering stays billable
      { student_id: 's3', status: 'transferred_out' }, // stays billable
      { student_id: 's4', status: 'voided' },          // mistake, not billable
    ];
    expect(billableCount(regs)).toBe(3);
  });
  it('uses the configured price (default GH₵2)', () => {
    expect(amountDue(150, 2)).toBe(300);
    expect(amountDue(150, 2.5)).toBe(375);
    expect(amountDue(3, 0.1)).toBe(0.3); // no float drift
  });
  it('derives payment status and balance', () => {
    expect(paymentStatus(0, 0)).toBe('no_charge');
    expect(paymentStatus(300, 0)).toBe('unpaid');
    expect(paymentStatus(300, 100)).toBe('partial');
    expect(paymentStatus(300, 300)).toBe('paid');
    expect(paymentStatus(300, 301)).toBe('overpaid');
    const s = summarize(150, 2, 120.1);
    expect(s).toMatchObject({ count: 150, due: 300, balance: 179.9, status: 'partial', formula: '150 × 2.00' });
  });
});
