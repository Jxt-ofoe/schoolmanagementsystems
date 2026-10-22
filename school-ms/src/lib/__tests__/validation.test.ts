import { academicYearSchema, assessmentSchema, fieldErrors, inviteSchema, passwordSchema, paymentSchema, semesterSchema, settingsSchema, studentSchema } from '../validation';

const student = { admission_number: 'ADM/001', first_name: 'Ama', last_name: 'Mensah', gender: 'female' as const, admission_date: '2026-09-01' };

describe('validation schemas', () => {
  it('accepts a minimal valid student and normalises blanks to null', () => {
    const r = studentSchema.parse({ ...student, guardian_email: ' A@B.COM ', other_names: '' });
    expect(r.guardian_email).toBe('a@b.com');
    expect(r.other_names).toBeNull();
  });
  it('rejects bad admission numbers, future DOB and bad phones', () => {
    const r = studentSchema.safeParse({ ...student, admission_number: 'ADM 001', date_of_birth: '2999-01-01', guardian_phone: 'call me' });
    expect(r.success).toBe(false);
    if (!r.success) expect(Object.keys(fieldErrors(r.error)).sort()).toEqual(['admission_number', 'date_of_birth', 'guardian_phone']);
  });
  it('enforces password strength', () => {
    expect(passwordSchema.safeParse('short1').success).toBe(false);
    expect(passwordSchema.safeParse('longpassword').success).toBe(false);
    expect(passwordSchema.safeParse('longpassw0rd').success).toBe(true);
  });
  it('validates invites', () => {
    expect(inviteSchema.safeParse({ full_name: 'Kofi Boateng', email: 'KOFI@school.edu.gh' }).data?.email).toBe('kofi@school.edu.gh');
    expect(inviteSchema.safeParse({ full_name: 'K', email: 'nope' }).success).toBe(false);
  });
  it('validates date ranges for years and semesters', () => {
    expect(academicYearSchema.safeParse({ name: '2026/27', starts_on: '2026-09-01', ends_on: '2026-08-01' }).success).toBe(false);
    const sem = { academic_year_id: 'x', name: 'Semester 1', starts_on: '2026-09-01', ends_on: '2026-12-20' };
    expect(semesterSchema.safeParse({ ...sem, registration_deadline: '2026-09-30' }).success).toBe(true);
    expect(semesterSchema.safeParse({ ...sem, registration_deadline: '2027-01-30' }).success).toBe(false);
  });
  it('rejects invalid assessments', () => {
    const a = { name: 'Exam', category: 'exam', max_score: '100', weight: '70' };
    expect(assessmentSchema.safeParse(a).success).toBe(true);
    expect(assessmentSchema.safeParse({ ...a, max_score: '0' }).success).toBe(false);
    expect(assessmentSchema.safeParse({ ...a, weight: '101' }).success).toBe(false);
  });
  it('rejects non-positive or future payments and negative prices', () => {
    expect(paymentSchema.safeParse({ amount: '0', method: 'cash', paid_on: '2026-01-01' }).success).toBe(false);
    expect(paymentSchema.safeParse({ amount: '10', method: 'cash', paid_on: '2999-01-01' }).success).toBe(false);
    expect(settingsSchema.safeParse({ price_per_student: '-1', billing_due_days: '30', void_grace_days: '14' }).success).toBe(false);
  });
});
