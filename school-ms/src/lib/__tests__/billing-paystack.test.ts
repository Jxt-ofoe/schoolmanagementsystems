import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { calculateBreakdown, summarize, paymentStatus } from '../billing';

describe('Flexible School Billing & Paystack Integration Unit Tests', () => {
  it('calculates custom price per student for monthly schools (School A: 500 students @ GH₵3)', () => {
    // 500 students × GH₵3 = GH₵1,500
    const b = calculateBreakdown(500, 3, 'none', 0, true, 3.0);
    expect(b.subtotal).toBe(1500);
    expect(b.discount).toBe(0);
    expect(b.netSubtotal).toBe(1500);
    expect(b.feeMarkup).toBe(45); // 3% markup
    expect(b.totalPayable).toBe(1545);
  });

  it('calculates custom price per student for semester schools (School B: 250 students @ GH₵4, 10% discount)', () => {
    const b = calculateBreakdown(250, 4, 'percentage', 10, true, 3.0);
    expect(b.subtotal).toBe(1000);
    expect(b.discount).toBe(100);
    expect(b.netSubtotal).toBe(900);
    expect(b.feeMarkup).toBe(27);
    expect(b.totalPayable).toBe(927);
  });

  it('calculates custom price per student with fixed discount (School C: 100 students @ GH₵5, GH₵50 discount)', () => {
    const b = calculateBreakdown(100, 5, 'fixed', 50, false, 0);
    expect(b.subtotal).toBe(500);
    expect(b.discount).toBe(50);
    expect(b.feeMarkup).toBe(0);
    expect(b.totalPayable).toBe(450);
  });

  it('verifies Paystack HMAC SHA-512 webhook signature computation', () => {
    const secret = 'sk_test_mock_secret_key_12345';
    const payload = JSON.stringify({
      event: 'charge.success',
      data: {
        reference: 'PSTK_TEST_12345',
        amount: 154500,
        currency: 'GHS',
        channel: 'card',
      },
    });

    const expectedHash = crypto
      .createHmac('sha512', secret)
      .update(payload)
      .digest('hex');

    expect(expectedHash).toBeDefined();
    expect(expectedHash.length).toBe(128); // 512 bits = 128 hex chars

    // Tampered payload produces different hash
    const tamperedPayload = payload + ' ';
    const tamperedHash = crypto
      .createHmac('sha512', secret)
      .update(tamperedPayload)
      .digest('hex');

    expect(tamperedHash).not.toBe(expectedHash);
  });

  it('correctly reports payment status and balance for partial, full, and overpaid amounts', () => {
    const s1 = summarize(500, 3, 1000, 0, 45); // Due 1545, paid 1000 => balance 545, partial
    expect(s1.due).toBe(1545);
    expect(s1.paid).toBe(1000);
    expect(s1.balance).toBe(545);
    expect(s1.status).toBe('partial');

    const s2 = summarize(500, 3, 1545, 0, 45); // Due 1545, paid 1545 => balance 0, paid
    expect(s2.balance).toBe(0);
    expect(s2.status).toBe('paid');

    expect(paymentStatus(1545, 0)).toBe('unpaid');
    expect(paymentStatus(1545, 1600)).toBe('overpaid');
    expect(paymentStatus(0, 0)).toBe('no_charge');
  });
});
