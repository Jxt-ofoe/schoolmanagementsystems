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

export type ScoreStatus = 'present' | 'absent' | 'exempted' | 'missing';

export interface ScoreItem {
  score: number | null;
  status?: ScoreStatus;
  remark?: string | null;
}

export interface CalcResult {
  total: number;
  weightTotal: number;
  percentage: number | null;
  entered: number;
  complete: boolean;
  grade: string | null;
  remark: string | null;
  hasMissing?: boolean;
  absentCount?: number;
  exemptedCount?: number;
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
  scores: Record<string, number | ScoreItem | null | undefined>,
  bands: CalcBand[],
): CalcResult {
  let total = 0;
  let weightTotal = 0;
  let entered = 0;
  let absentCount = 0;
  let exemptedCount = 0;
  let hasMissing = false;

  for (const a of assessments) {
    const rawEntry = scores[a.id];
    let scoreVal: number | null = null;
    let statusVal: ScoreStatus = 'present';

    if (rawEntry !== null && rawEntry !== undefined) {
      if (typeof rawEntry === 'object' && 'status' in rawEntry) {
        statusVal = rawEntry.status ?? 'present';
        scoreVal = rawEntry.score;
      } else if (typeof rawEntry === 'number') {
        scoreVal = rawEntry;
      }
    }

    if (statusVal === 'exempted') {
      exemptedCount += 1;
      entered += 1;
      // Exempted assessment does not count toward weight total or total score
      continue;
    }

    weightTotal += Number(a.weight);

    if (statusVal === 'absent') {
      absentCount += 1;
      entered += 1;
      // Absent contributes 0
    } else if (statusVal === 'missing' || scoreVal === null || scoreVal === undefined) {
      hasMissing = true;
      // Missing mark: not entered or explicitly missing
    } else {
      entered += 1;
      total += (Number(scoreVal) / Number(a.max_score)) * Number(a.weight);
    }
  }

  total = round2(total);
  const percentage = weightTotal > 0 ? round2((total * 100) / weightTotal) : null;
  const band = gradeFor(percentage, bands);
  const complete = assessments.length > 0 && entered === assessments.length && !hasMissing;

  return {
    total,
    weightTotal: round2(weightTotal),
    percentage,
    entered,
    complete,
    grade: band?.grade ?? null,
    remark: band?.remark ?? null,
    hasMissing,
    absentCount,
    exemptedCount,
  };
}

export function remainingWeight(assessments: CalcAssessment[], excludeId?: string): number {
  return round2(100 - assessments.filter((a) => a.id !== excludeId).reduce((s, a) => s + Number(a.weight), 0));
}

export interface RankableItem {
  id: string;
  score: number | null | undefined;
  isProvisional?: boolean;
}

/**
 * Calculates rank/position based on configured tie ranking policy:
 * - 'dense': 1, 2, 2, 3 (ties share rank, subsequent incremented by 1)
 * - 'standard': 1, 2, 2, 4 (ties share rank, subsequent skips)
 * - 'none': all ranks null
 *
 * First position goes to the item with the highest score.
 * Items with null, undefined, or NaN score receive position: null.
 */
export function computePositions<T extends RankableItem>(
  items: T[],
  policy: 'dense' | 'standard' | 'none' = 'dense'
): (T & { position: number | null })[] {
  if (policy === 'none' || !items.length) {
    return items.map((it) => ({ ...it, position: null }));
  }

  // Separate valid scored items from unscored items
  const scored: T[] = [];
  const unscoredIds = new Set<string>();

  for (const it of items) {
    if (it.score !== null && it.score !== undefined && !Number.isNaN(Number(it.score))) {
      scored.push(it);
    } else {
      unscoredIds.add(it.id);
    }
  }

  if (!scored.length) {
    return items.map((it) => ({ ...it, position: null }));
  }

  // Sort descending by score: highest score receives first position
  const sorted = [...scored].sort((a, b) => Number(b.score) - Number(a.score));
  const rankMap = new Map<string, number | null>();

  let currentRank = 1;
  for (let i = 0; i < sorted.length; i++) {
    const item = sorted[i];
    if (i > 0) {
      if (Number(item.score) === Number(sorted[i - 1].score)) {
        // Tied
        rankMap.set(item.id, rankMap.get(sorted[i - 1].id) ?? currentRank);
        continue;
      } else {
        currentRank = policy === 'dense' ? (rankMap.get(sorted[i - 1].id) ?? 0) + 1 : i + 1;
      }
    }
    rankMap.set(item.id, currentRank);
  }

  return items.map((it) => ({
    ...it,
    position: unscoredIds.has(it.id) ? null : (rankMap.get(it.id) ?? null),
  }));
}

/**
 * Returns ordinal string suffix, e.g. 1 -> "1st", 2 -> "2nd", 3 -> "3rd", 4 -> "4th", 21 -> "21st"
 */
export function ordinalSuffix(n: number): string {
  const abs = Math.abs(Math.round(n));
  const j = abs % 10;
  const k = abs % 100;
  if (j === 1 && k !== 11) return `${abs}st`;
  if (j === 2 && k !== 12) return `${abs}nd`;
  if (j === 3 && k !== 13) return `${abs}rd`;
  return `${abs}th`;
}

/**
 * Formats a position number nicely, e.g.
 * formatPosition(1) => "1st"
 * formatPosition(1, 35) => "1st of 35"
 * formatPosition(null) => "—"
 */
export function formatPosition(position: number | null | undefined, total?: number | null): string {
  if (position === null || position === undefined || position <= 0) return '—';
  const ord = ordinalSuffix(position);
  if (total && total > 0) {
    return `${ord} of ${total}`;
  }
  return ord;
}


