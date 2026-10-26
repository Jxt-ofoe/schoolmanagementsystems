import { computePositions, computeResult, gradeFor, remainingWeight, validateScore } from '../grades';

const bands = [
  { min_score: 80, grade: 'A', remark: 'Excellent' }, { min_score: 70, grade: 'B', remark: 'Very good' },
  { min_score: 60, grade: 'C' }, { min_score: 50, grade: 'D' }, { min_score: 40, grade: 'E' }, { min_score: 0, grade: 'F', remark: 'Fail' },
];

describe('validateScore (invalid grades are rejected)', () => {
  it('accepts values within 0..max, including bounds and 2 decimals', () => {
    expect(validateScore('0', 20)).toEqual({ value: 0, error: null });
    expect(validateScore('20', 20)).toEqual({ value: 20, error: null });
    expect(validateScore(' 12.75 ', 20)).toEqual({ value: 12.75, error: null });
  });
  it('treats empty as "not entered"', () => expect(validateScore('  ', 20)).toEqual({ value: null, error: null }));
  it.each(['21', '20.01', '-1', 'abc', '1e2', '12.345', '1,5', 'NaN', 'Infinity'])('rejects %s', (raw) => {
    const r = validateScore(raw, 20);
    expect(r.value).toBeNull();
    expect(r.error).toBeTruthy();
  });
});

describe('computeResult', () => {
  const list = [{ id: 'cw', max_score: 20, weight: 30 }, { id: 'ex', max_score: 100, weight: 70 }];
  it('weights each assessment by score/max × weight', () => {
    const r = computeResult(list, { cw: 15, ex: 80 }, bands);
    expect(r.total).toBe(78.5);           // 15/20*30 = 22.5 ; 80/100*70 = 56
    expect(r.weightTotal).toBe(100);
    expect(r.percentage).toBe(78.5);
    expect(r.grade).toBe('B');
    expect(r.complete).toBe(true);
    expect(r.entered).toBe(2);
  });
  it('marks missing scores as incomplete and counts them as 0', () => {
    const r = computeResult(list, { cw: 20 }, bands);
    expect(r.total).toBe(30);
    expect(r.complete).toBe(false);
    expect(r.entered).toBe(1);
    expect(r.grade).toBe('F');
  });
  it('normalises to percentage when weights do not sum to 100', () => {
    const r = computeResult([{ id: 'a', max_score: 50, weight: 40 }], { a: 45 }, bands);
    expect(r.total).toBe(36);
    expect(r.percentage).toBe(90);
    expect(r.grade).toBe('A');
    expect(r.remark).toBe('Excellent');
  });
  it('returns null percentage with no assessments', () => {
    const r = computeResult([], {}, bands);
    expect(r.percentage).toBeNull();
    expect(r.grade).toBeNull();
    expect(r.complete).toBe(false);
  });
  it('picks the band with the highest min ≤ percentage, at boundaries', () => {
    expect(gradeFor(80, bands)?.grade).toBe('A');
    expect(gradeFor(79.99, bands)?.grade).toBe('B');
    expect(gradeFor(0, bands)?.grade).toBe('F');
  });
});

describe('remainingWeight', () => {
  const list = [{ id: 'a', max_score: 10, weight: 30 }, { id: 'b', max_score: 10, weight: 45.5 }];
  it('is 100 minus existing weights', () => expect(remainingWeight(list)).toBe(24.5));
  it('excludes the assessment being edited', () => expect(remainingWeight(list, 'b')).toBe(70));
});

describe('computeResult with absent / exempted / missing', () => {
  const list = [
    { id: 'cw', max_score: 20, weight: 30 },
    { id: 'ex', max_score: 100, weight: 70 },
  ];

  it('handles absent student by counting 0 and tracking absent count', () => {
    const r = computeResult(list, {
      cw: { score: 15, status: 'present' },
      ex: { score: null, status: 'absent' },
    }, bands);
    expect(r.total).toBe(22.5);
    expect(r.absentCount).toBe(1);
    expect(r.complete).toBe(true);
  });

  it('normalizes weight when an assessment is exempted', () => {
    const r = computeResult(list, {
      cw: { score: 18, status: 'present' },
      ex: { score: null, status: 'exempted' },
    }, bands);
    // cw is 18/20 * 30 = 27. Ex is exempted, so total weight is 30. Percentage is 27/30 * 100 = 90%
    expect(r.total).toBe(27);
    expect(r.weightTotal).toBe(30);
    expect(r.percentage).toBe(90);
    expect(r.grade).toBe('A');
    expect(r.exemptedCount).toBe(1);
    expect(r.complete).toBe(true);
  });

  it('flags missing assessments as incomplete', () => {
    const r = computeResult(list, {
      cw: { score: 15, status: 'present' },
      ex: { score: null, status: 'missing' },
    }, bands);
    expect(r.hasMissing).toBe(true);
    expect(r.complete).toBe(false);
  });
});

describe('computePositions', () => {
  it('computes dense positions correctly (ties share rank, subsequent incremented by 1)', () => {
    const students = [
      { id: 's1', score: 85 },
      { id: 's2', score: 92 },
      { id: 's3', score: 85 },
      { id: 's4', score: 70 },
    ];
    const ranked = computePositions(students, 'dense');
    expect(ranked.find((s) => s.id === 's2')?.position).toBe(1);
    expect(ranked.find((s) => s.id === 's1')?.position).toBe(2);
    expect(ranked.find((s) => s.id === 's3')?.position).toBe(2);
    expect(ranked.find((s) => s.id === 's4')?.position).toBe(3);
  });

  it('computes standard competition positions correctly (ties share rank, subsequent skips)', () => {
    const students = [
      { id: 's1', score: 85 },
      { id: 's2', score: 92 },
      { id: 's3', score: 85 },
      { id: 's4', score: 70 },
    ];
    const ranked = computePositions(students, 'standard');
    expect(ranked.find((s) => s.id === 's2')?.position).toBe(1);
    expect(ranked.find((s) => s.id === 's1')?.position).toBe(2);
    expect(ranked.find((s) => s.id === 's3')?.position).toBe(2);
    expect(ranked.find((s) => s.id === 's4')?.position).toBe(4);
  });

  it('returns null positions when policy is none', () => {
    const students = [{ id: 's1', score: 85 }];
    const ranked = computePositions(students, 'none');
    expect(ranked[0].position).toBeNull();
  });
});

