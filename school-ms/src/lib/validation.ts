import { z } from 'zod';

const optionalText = (max: number) =>
  z.string().trim().max(max, `Must be at most ${max} characters`).optional().transform((v) => (v ? v : null));

export const passwordSchema = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(72, 'Use at most 72 characters')
  .regex(/[A-Za-z]/, 'Include at least one letter')
  .regex(/[0-9]/, 'Include at least one number');

export const emailSchema = z.string().trim().toLowerCase().email('Enter a valid email address').max(150);

export const studentSchema = z.object({
  admission_number: z.string().trim().min(1, 'Admission number is required')
    .max(30).regex(/^[A-Za-z0-9/_.-]+$/, 'Use letters, numbers, / _ . or - only'),
  first_name: z.string().trim().min(1, 'First name is required').max(60),
  last_name: z.string().trim().min(1, 'Last name is required').max(60),
  other_names: optionalText(80),
  gender: z.enum(['male', 'female', '']).transform((v) => (v === '' ? null : v)),
  date_of_birth: z.string().optional().transform((v) => (v ? v : null))
    .refine((v) => !v || v <= new Date().toISOString().slice(0, 10), 'Date of birth cannot be in the future'),
  current_class_id: z.string().optional().transform((v) => (v ? v : null)),
  admission_date: z.string().min(1, 'Admission date is required'),
  guardian_name: optionalText(120),
  guardian_relationship: optionalText(40),
  guardian_phone: z.string().trim().optional().transform((v) => (v ? v : null))
    .refine((v) => !v || /^[0-9+() -]{7,20}$/.test(v), 'Enter a valid phone number'),
  guardian_email: z.string().trim().optional().transform((v) => (v ? v.toLowerCase() : null))
    .refine((v) => !v || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), 'Enter a valid email'),
  address: optionalText(300),
  notes: optionalText(1000),
});
export type StudentInput = z.input<typeof studentSchema>;

export const classSchema = z.object({
  name: z.string().trim().min(1, 'Class name is required').max(60),
  section: optionalText(20),
  level_order: z.coerce.number().int().min(0).max(1000),
  capacity: z.union([z.literal(''), z.coerce.number().int().min(1).max(1000)]).transform((v) => (v === '' ? null : v)),
});

export const subjectSchema = z.object({
  name: z.string().trim().min(1, 'Subject name is required').max(80),
  code: z.string().trim().optional().transform((v) => (v ? v.toUpperCase() : null))
    .refine((v) => !v || /^[A-Za-z0-9-]{1,15}$/.test(v), 'Code: up to 15 letters, numbers or -'),
});

export const inviteSchema = z.object({
  full_name: z.string().trim().min(2, 'Enter the full name').max(120),
  email: emailSchema,
});

export const createStaffSchema = z.object({
  full_name: z.string().trim().min(2, 'Enter the full name').max(120),
  email: emailSchema,
  password: z.string().min(8, 'Password must be at least 8 characters'),
});

export const schoolSchema = z.object({
  name: z.string().trim().min(2, 'School name is required').max(150),
  code: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{1,39}$/, 'Lowercase letters, numbers and dashes (2–40)'),
  region: optionalText(80),
  email: z.string().trim().optional().transform((v) => (v ? v : null))
    .refine((v) => !v || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), 'Enter a valid email'),
  phone: optionalText(30),
  address: optionalText(300),
  status: z.enum(['pending', 'active', 'suspended', 'inactive']),
});

export const academicYearSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(40),
  starts_on: z.string().min(1, 'Start date is required'),
  ends_on: z.string().min(1, 'End date is required'),
}).refine((v) => v.ends_on > v.starts_on, { message: 'End date must be after start date', path: ['ends_on'] });

export const semesterSchema = z.object({
  academic_year_id: z.string().min(1, 'Choose an academic year'),
  name: z.string().trim().min(1, 'Name is required').max(40),
  starts_on: z.string().min(1, 'Start date is required'),
  ends_on: z.string().min(1, 'End date is required'),
  registration_deadline: z.string().optional().transform((v) => (v ? v : null)),
}).refine((v) => v.ends_on > v.starts_on, { message: 'End date must be after start date', path: ['ends_on'] })
  .refine((v) => !v.registration_deadline || (v.registration_deadline >= v.starts_on && v.registration_deadline <= v.ends_on),
    { message: 'Deadline must fall within the semester', path: ['registration_deadline'] });

export const assessmentSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  category: z.enum(['class_score', 'exam', 'other']),
  max_score: z.coerce.number().positive('Must be greater than 0').max(1000),
  weight: z.coerce.number().min(0).max(100, 'Weight cannot exceed 100'),
  assessment_date: z.string().optional().transform((v) => (v ? v : null)),
});

export const paymentSchema = z.object({
  amount: z.coerce.number().positive('Amount must be greater than 0').max(10_000_000),
  method: z.enum(['cash', 'mobile_money', 'bank_transfer', 'cheque', 'card', 'other']),
  reference: optionalText(100),
  paid_on: z.string().min(1).refine((v) => v <= new Date().toISOString().slice(0, 10), 'Cannot be in the future'),
  notes: optionalText(500),
});

export const settingsSchema = z.object({
  price_per_student: z.coerce.number().min(0, 'Cannot be negative').max(100000),
  billing_due_days: z.coerce.number().int().min(0).max(365),
  void_grace_days: z.coerce.number().int().min(0).max(90),
});

/** Flatten zod errors to { field: message }. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_form';
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
