import { amountDue, billableCount, calculateBreakdown, paymentStatus, summarize, PRICE_PER_STUDENT_PER_TERM, type Registration } from '../billing';

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
  it('uses the configured price (default GHS 3)', () => {
    expect(PRICE_PER_STUDENT_PER_TERM).toBe(3);
    expect(amountDue(10, 3)).toBe(30); // School A with 10 students: 10 * 3 = 30
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
    const s = summarize(10, 3, 0);
    expect(s).toMatchObject({ count: 10, due: 30, balance: 30, status: 'unpaid', formula: '10 students × GHS 3.00 = GHS 30.00' });
  });

  it('supports flexible pricing per school (e.g. GH₵3, GH₵4, GH₵5)', () => {
    // School A: 500 students @ GH₵3
    expect(amountDue(500, 3)).toBe(1500);
    // School B: 250 students @ GH₵4
    expect(amountDue(250, 4)).toBe(1000);
    // School C: 120 students @ GH₵5
    expect(amountDue(120, 5)).toBe(600);
  });

  it('calculates transparent breakdown with optional discount and 3% markup', () => {
    // 500 students @ GH₵3 = GH₵1500 subtotal
    // No discount, 3% markup = GH₵45.00 => Total = GH₵1545.00
    const b1 = calculateBreakdown(500, 3, 'none', 0, true, 3.0);
    expect(b1.subtotal).toBe(1500);
    expect(b1.discount).toBe(0);
    expect(b1.netSubtotal).toBe(1500);
    expect(b1.feeMarkup).toBe(45);
    expect(b1.totalPayable).toBe(1545);

    // 10% percentage discount: GH₵1500 - 10% (GH₵150) = GH₵1350 net
    // 3% markup on GH₵1350 = GH₵40.50 => Total = GH₵1390.50
    const b2 = calculateBreakdown(500, 3, 'percentage', 10, true, 3.0);
    expect(b2.subtotal).toBe(1500);
    expect(b2.discount).toBe(150);
    expect(b2.netSubtotal).toBe(1350);
    expect(b2.feeMarkup).toBe(40.5);
    expect(b2.totalPayable).toBe(1390.5);

    // Fixed discount: GH₵200 off
    const b3 = calculateBreakdown(500, 3, 'fixed', 200, false, 0);
    expect(b3.subtotal).toBe(1500);
    expect(b3.discount).toBe(200);
    expect(b3.netSubtotal).toBe(1300);
    expect(b3.feeMarkup).toBe(0);
    expect(b3.totalPayable).toBe(1300);
  });
});

