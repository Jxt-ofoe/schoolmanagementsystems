import { describe, it, expect } from 'vitest';
import { computeFeeSummary, generateReceiptNumber } from '../fees';

describe('computeFeeSummary', () => {
  it('correctly calculates total, discounts, net charged, paid, and balance', () => {
    const charges = [
      { amount: 150.00, discount_amount: 0 },
      { amount: 50.00, discount_amount: 10.00 },
      { amount: 100.00, discount_amount: 20.00 },
    ];
    const payments = [
      { amount: 100.00, status: 'valid' as const },
      { amount: 70.00, status: 'valid' as const },
      { amount: 50.00, status: 'reversed' as const }, // Reversed payment excluded
    ];

    const summary = computeFeeSummary(charges, payments);
    expect(summary.totalCharged).toBe(300.00);
    expect(summary.totalDiscounted).toBe(30.00);
    expect(summary.netCharged).toBe(270.00);
    expect(summary.totalPaid).toBe(170.00);
    expect(summary.balance).toBe(100.00);
  });

  it('handles empty charges and payments gracefully', () => {
    const summary = computeFeeSummary([], []);
    expect(summary.totalCharged).toBe(0);
    expect(summary.netCharged).toBe(0);
    expect(summary.totalPaid).toBe(0);
    expect(summary.balance).toBe(0);
  });
});

describe('generateReceiptNumber', () => {
  it('generates a formatted receipt number with prefix', () => {
    const rec = generateReceiptNumber('jasikan-forest');
    expect(rec).toMatch(/^JAS-\d{6}-\d{4}$/);
  });
});
