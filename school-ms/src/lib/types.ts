export type Role = 'headmaster' | 'teacher';
export type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused';
export type EnrollmentStatus = 'active' | 'suspended' | 'withdrawn' | 'transferred_out' | 'graduated';

export interface Membership {
  membership_id: string;
  school_id: string;
  role: Role;
  status: 'active' | 'disabled';
  school_name: string;
  school_code: string;
  school_status: 'pending' | 'active' | 'suspended' | 'inactive';
}

export interface Profile {
  id: string;
  email: string | null;
  full_name: string;
  phone: string | null;
}

export interface MyContext {
  user_id: string;
  is_super_admin: boolean;
  profile: Profile | null;
  memberships: Membership[];
}

export interface ClassRow {
  id: string;
  school_id: string;
  name: string;
  section: string | null;
  level_order: number;
  capacity: number | null;
  is_active: boolean;
}

export interface SubjectRow {
  id: string;
  school_id: string;
  name: string;
  code: string | null;
  is_active: boolean;
}

export interface Student {
  id: string;
  school_id: string;
  admission_number: string;
  first_name: string;
  last_name: string;
  other_names: string | null;
  gender: 'male' | 'female' | null;
  date_of_birth: string | null;
  current_class_id: string | null;
  enrollment_status: EnrollmentStatus;
  admission_date: string;
  guardian_name: string | null;
  guardian_relationship: string | null;
  guardian_phone: string | null;
  guardian_email: string | null;
  address: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Semester {
  id: string;
  school_id: string;
  academic_year_id: string;
  name: string;
  starts_on: string;
  ends_on: string;
  registration_deadline: string | null;
  status: 'planned' | 'open' | 'closed';
  is_current: boolean;
  academic_years?: { name: string } | null;
}

export interface Assessment {
  id: string;
  school_id: string;
  semester_id: string;
  class_id: string;
  subject_id: string;
  name: string;
  category: 'class_score' | 'exam' | 'other';
  max_score: number;
  weight: number;
  assessment_date: string | null;
}

export interface GradeBand {
  id: string;
  scale_id: string;
  min_score: number;
  max_score: number;
  grade: string;
  remark: string | null;
  grade_point: number | null;
}

export interface BillingOverview {
  id: string;
  school_id: string;
  school_name: string;
  school_code: string;
  school_status: string;
  semester_id: string;
  semester_name: string;
  academic_year_name: string;
  is_current: boolean;
  student_count: number;
  price_per_student: number;
  currency: string;
  amount_due: number;
  amount_paid: number;
  balance: number;
  due_date: string | null;
  notes: string | null;
  last_calculated_at: string | null;
  payment_status: 'no_charge' | 'unpaid' | 'partial' | 'paid' | 'overpaid';
  renewal_status: 'not_applicable' | 'renewed' | 'overdue' | 'pending';
}

export interface AuditLog {
  id: number;
  school_id: string | null;
  actor_id: string | null;
  actor_role: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}
