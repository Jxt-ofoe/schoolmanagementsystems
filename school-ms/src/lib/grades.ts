/**
 * Grade calculation rules (mirrors public.class_subject_results in SQL):
 *   contribution_i = score_i / max_i × weight_i
 *   total          = Σ contribution_i               (out of Σ weight)
 *   percentage     = total / Σ weight × 100
 *   grade          = band with the highest min_score ≤ percentage
 * Missing scores contribute 0 and mark the result as incomplete.
 */
export interface CalcAssessment { id: string; max_score: number; weight: number }
export interface CalcBand { min_score: number; grade: string; remark?: string | null }

export interface CalcResult {
  total: number;
  weightTotal: number;
  percentage: number | null;
  entered: number;
  complete: boolean;
  grade: string | null;
  remark: string | null;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function validateScore(raw: string, max: number): { value: number | null; error: string | null } {
  const t = raw.trim();
  if (t === '') return { value: null, error: null };
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return { value: null, error: 'Enter a number (up to 2 decimals)' };
  const v = Number(t);
  if (v < 0 || v > max) return { value: null, error: `Must be between 0 and ${max}` };
  return { value: v, error: null };
}

export function gradeFor(percentage: number | null, bands: CalcBand[]): CalcBand | null {
  if (percentage === null) return null;
  const sorted = [...bands].sort((a, b) => Number(b.min_score) - Number(a.min_score));
  return sorted.find((b) => Number(b.min_score) <= percentage) ?? null;
}

export function computeResult(
  assessments: CalcAssessment[],
  scores: Record<string, number | null | undefined>,
  bands: CalcBand[],
): CalcResult {
  let total = 0;
  let weightTotal = 0;
  let entered = 0;
  for (const a of assessments) {
    weightTotal += Number(a.weight);
    const s = scores[a.id];
    if (s !== null && s !== undefined) {
      entered += 1;
      total += (Number(s) / Number(a.max_score)) * Number(a.weight);
    }
  }
  total = round2(total);
  const percentage = weightTotal > 0 ? round2((total * 100) / weightTotal) : null;
  const band = gradeFor(percentage, bands);
  return {
    total,
    weightTotal: round2(weightTotal),
    percentage,
    entered,
    complete: assessments.length > 0 && entered === assessments.length,
    grade: band?.grade ?? null,
    remark: band?.remark ?? null,
  };
}

export function remainingWeight(assessments: CalcAssessment[], excludeId?: string): number {
  return round2(100 - assessments.filter((a) => a.id !== excludeId).reduce((s, a) => s + Number(a.weight), 0));
}
