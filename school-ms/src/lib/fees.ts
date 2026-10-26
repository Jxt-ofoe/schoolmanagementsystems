import type { StudentFeeCharge, StudentFeePayment } from './types';

export interface FeeSummary {
  totalCharged: number;
  totalDiscounted: number;
  netCharged: number;
  totalPaid: number;
  balance: number;
}

const toPesewas = (n: number) => Math.round((Number(n) || 0) * 100);

export function computeFeeSummary(
  charges: Pick<StudentFeeCharge, 'amount' | 'discount_amount'>[],
  payments: Pick<StudentFeePayment, 'amount' | 'status'>[],
): FeeSummary {
  let totalCharged = 0;
  let totalDiscounted = 0;

  for (const c of charges) {
    totalCharged += toPesewas(c.amount);
    totalDiscounted += toPesewas(c.discount_amount || 0);
  }

  let totalPaid = 0;
  for (const p of payments) {
    if (p.status === 'valid') {
      totalPaid += toPesewas(p.amount);
    }
  }

  const netCharged = Math.max(0, totalCharged - totalDiscounted);
  const balance = netCharged - totalPaid;

  return {
    totalCharged: totalCharged / 100,
    totalDiscounted: totalDiscounted / 100,
    netCharged: netCharged / 100,
    totalPaid: totalPaid / 100,
    balance: balance / 100,
  };
}

export function generateReceiptNumber(schoolCode: string): string {
  const dateStr = new Date().toISOString().slice(2, 10).replace(/-/g, '');
  const rand = Math.floor(1000 + Math.random() * 9000);
  const prefix = schoolCode ? schoolCode.slice(0, 3).toUpperCase() : 'REC';
  return `${prefix}-${dateStr}-${rand}`;
}
