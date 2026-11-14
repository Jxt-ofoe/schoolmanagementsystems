/**
 * Billing rules: Per-term billing for all schools.
 * Database is source of truth; this mirrors it for UI calculations, breakdown, and display.
 */

export const PRICE_PER_STUDENT_PER_TERM = 3; // Default GHS 3 per student per term
export const DEFAULT_SNAPSHOT_WEEK = 2; // Week 2 of term for student snapshot

export type PaymentStatus = 'no_charge' | 'unpaid' | 'partial' | 'paid' | 'overpaid';

export interface Registration { student_id: string; status: 'registered' | 'withdrawn' | 'transferred_out' | 'voided' }

/** Unique students with a non-voided registration. */
export function billableCount(regs: Registration[]): number {
  return new Set(regs.filter((r) => r.status !== 'voided').map((r) => r.student_id)).size;
}

const toPesewas = (n: number) => Math.round(Number(n) * 100);

export function amountDue(count: number, pricePerStudent = PRICE_PER_STUDENT_PER_TERM): number {
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

export function calculateBreakdown(
  count: number,
  pricePerStudent = PRICE_PER_STUDENT_PER_TERM,
  discountType: 'none' | 'fixed' | 'percentage' = 'none',
  discountValue = 0,
  passFeeMarkup = true,
  feeMarkupPercent = 3.0
) {
  const subtotal = amountDue(count, pricePerStudent);
  let discount = 0;
  if (discountType === 'percentage' && discountValue > 0) {
    discount = Math.round(subtotal * (discountValue / 100) * 100) / 100;
  } else if (discountType === 'fixed' && discountValue > 0) {
    discount = Math.min(subtotal, discountValue);
  }
  const netSubtotal = Math.max(0, subtotal - discount);
  const feeMarkup = passFeeMarkup ? Math.round(netSubtotal * (feeMarkupPercent / 100) * 100) / 100 : 0;
  const totalPayable = Math.round((netSubtotal + feeMarkup) * 100) / 100;
  return { subtotal, discount, netSubtotal, feeMarkup, feeMarkupPercent, totalPayable };
}

export function summarize(count: number, price = PRICE_PER_STUDENT_PER_TERM, paid = 0, discount = 0, feeMarkup = 0) {
  const due = amountDue(count, price);
  const net = Math.max(0, due - discount);
  const total = Math.round((net + feeMarkup) * 100) / 100;
  const targetDue = (discount > 0 || feeMarkup > 0) ? total : due;
  return {
    count,
    price,
    subtotal: due,
    due: targetDue,
    discount,
    feeMarkup,
    totalPayable: targetDue,
    paid,
    balance: (toPesewas(targetDue) - toPesewas(paid)) / 100,
    status: paymentStatus(targetDue, paid),
    formula: `${count} students × GHS ${price.toFixed(2)} = GHS ${due.toFixed(2)}`,
  };
}
