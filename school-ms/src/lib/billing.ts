/**
 * Billing rules (see docs/BILLING_POLICY.md). The database is the source of
 * truth; this mirrors it for estimates and display.
 */
export type PaymentStatus = 'no_charge' | 'unpaid' | 'partial' | 'paid' | 'overpaid';

export interface Registration { student_id: string; status: 'registered' | 'withdrawn' | 'transferred_out' | 'voided' }

/** Unique students with a non-voided registration. */
export function billableCount(regs: Registration[]): number {
  return new Set(regs.filter((r) => r.status !== 'voided').map((r) => r.student_id)).size;
}

const toPesewas = (n: number) => Math.round(Number(n) * 100);

export function amountDue(count: number, pricePerStudent: number): number {
  return (count * toPesewas(pricePerStudent)) / 100;
}

export function paymentStatus(due: number, paid: number): PaymentStatus {
  const d = toPesewas(due);
  const p = toPesewas(paid);
  if (d === 0) return 'no_charge';
  if (p <= 0) return 'unpaid';
  if (p < d) return 'partial';
  if (p === d) return 'paid';
  return 'overpaid';
}

export function summarize(count: number, price: number, paid: number) {
  const due = amountDue(count, price);
  return {
    count,
    price,
    due,
    paid,
    balance: (toPesewas(due) - toPesewas(paid)) / 100,
    status: paymentStatus(due, paid),
    formula: `${count} × ${price.toFixed(2)}`,
  };
}
