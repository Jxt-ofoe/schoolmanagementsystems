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
  school_logo_url?: string | null;
}

export interface School {
  id: string;
  name: string;
  code: string;
  status: 'pending' | 'active' | 'suspended' | 'inactive';
  email: string | null;
  phone: string | null;
  address: string | null;
  region: string | null;
  motto: string | null;
  logo_url?: string | null;
  created_at?: string;
  updated_at?: string;
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

export interface SchoolBillingConfig {
  id: string;
  school_id: string;
  pricing_model: 'per_student' | 'flat_rate';
  price_per_student: number;
  flat_rate_amount: number;
  billing_frequency: 'monthly' | 'semester';
  billing_start_date: string;
  next_billing_date: string | null;
  due_days: number;
  grace_period_days: number;
  discount_type: 'none' | 'fixed' | 'percentage';
  discount_value: number;
  pass_fee_markup: boolean;
  fee_markup_percent: number;
  auto_charge_card: boolean;
  status: 'active' | 'payment_pending' | 'payment_overdue' | 'grace_period' | 'suspended' | 'cancelled';
  grace_period_end: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface BillingOverview {
  id: string;
  school_id: string;
  school_name: string;
  school_code: string;
  school_status: string;
  config_status?: string | null;
  billing_frequency?: 'monthly' | 'semester';
  billing_month?: string | null;
  period_label?: string | null;
  semester_id: string | null;
  semester_name: string | null;
  academic_year_name: string | null;
  is_current: boolean;
  student_count: number;
  price_per_student: number;
  currency: string;
  amount_due: number;
  discount_amount?: number;
  fee_markup_amount?: number;
  total_payable?: number;
  amount_paid: number;
  balance: number;
  due_date: string | null;
  grace_period_end?: string | null;
  invoice_number?: string | null;
  notes: string | null;
  last_calculated_at: string | null;
  payment_status: 'no_charge' | 'unpaid' | 'partial' | 'paid' | 'overpaid';
  renewal_status: 'not_applicable' | 'renewed' | 'overdue' | 'pending' | 'suspended';
}

export interface PaymentAuthorization {
  id: string;
  school_id: string;
  authorization_code: string;
  card_type: string | null;
  last4: string | null;
  exp_month: string | null;
  exp_year: string | null;
  bank: string | null;
  channel: string;
  reusable: boolean;
  customer_email: string | null;
  is_default: boolean;
  created_at: string;
}

export interface PaystackTransaction {
  id: string;
  school_id: string | null;
  billing_id: string | null;
  reference: string;
  event_type: string;
  amount: number;
  currency: string;
  channel: string | null;
  status: 'pending' | 'success' | 'failed';
  gateway_response: string | null;
  paid_at: string | null;
  customer_email: string | null;
  authorization_code: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface BillingReminder {
  id: string;
  school_id: string;
  billing_id: string | null;
  reminder_type: 'due_soon' | 'due_today' | 'failed' | 'grace_warning' | 'auto_renewal_notice';
  recipient_phone: string | null;
  recipient_email: string | null;
  channel: 'sms' | 'email' | 'in_app';
  message: string;
  status: 'sent' | 'failed';
  sent_at: string;
}

export interface PlatformBillingMetrics {
  total_schools: number;
  active_schools: number;
  monthly_schools: number;
  semester_schools: number;
  total_paid: number;
  total_due: number;
  outstanding: number;
  overdue_schools: number;
  grace_period_schools: number;
  suspended_schools: number;
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

export type ExaminationType = 'mid_term' | 'end_of_term' | 'mock' | 'class_test' | 'continuous_assessment' | 'other';
export type ExaminationStatus = 'draft' | 'open' | 'submitted' | 'reviewed' | 'approved' | 'published';

export interface Examination {
  id: string;
  school_id: string;
  academic_year_id: string;
  semester_id: string;
  name: string;
  exam_type: ExaminationType;
  start_date: string | null;
  end_date: string | null;
  status: ExaminationStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  classes?: { class_id: string }[];
  subjects?: { subject_id: string }[];
  academic_years?: { name: string } | null;
  semesters?: { name: string } | null;
}

export type SubmissionStatus = 'draft' | 'submitted' | 'reviewed' | 'approved' | 'returned';

export interface SubjectResultSubmission {
  id: string;
  school_id: string;
  semester_id: string;
  class_id: string;
  subject_id: string;
  examination_id: string | null;
  status: SubmissionStatus;
  submitted_by: string | null;
  submitted_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  feedback: string | null;
  teacher_name?: string | null;
  created_at: string;
  updated_at: string;
}

export interface SchoolGradingConfig {
  school_id: string;
  pass_mark: number;
  show_position: boolean;
  tie_ranking_policy: 'dense' | 'standard' | 'none';
  continuous_assessment_weight: number;
  exam_weight: number;
  conduct_options: string[];
  attitude_options: string[];
  interest_options: string[];
  next_term_begins: string | null;
  headmaster_remarks_template: string | null;
  updated_at: string;
}

export interface TerminalReport {
  id: string;
  school_id: string;
  student_id: string;
  academic_year_id: string;
  semester_id: string;
  class_id: string;
  examination_id: string | null;
  status: 'draft' | 'reviewed' | 'approved' | 'published';
  total_score: number;
  average_score: number;
  overall_grade: string | null;
  position: number | null;
  total_students: number;
  subjects_count: number;
  incomplete_subjects: number;
  attendance_present: number;
  attendance_absent: number;
  attendance_total: number;
  conduct: string | null;
  attitude: string | null;
  interest: string | null;
  class_teacher_remarks: string | null;
  headmaster_remarks: string | null;
  promotion_recommendation: 'promoted' | 'promoted_on_probation' | 'repeat' | 'withdrawn' | 'graduated' | null;
  next_class_id: string | null;
  next_term_begins: string | null;
  snapshot_data: Record<string, unknown>;
  needs_regeneration: boolean;
  published_at: string | null;
  published_by: string | null;
  created_at: string;
  updated_at: string;
  student?: Student;
}

export interface FeeCategory {
  id: string;
  school_id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
}

export interface FeeStructure {
  id: string;
  school_id: string;
  academic_year_id: string;
  semester_id: string;
  class_id: string | null;
  category_id: string;
  name: string;
  amount: number;
  due_date: string | null;
  created_at: string;
  updated_at: string;
  category?: FeeCategory;
  class?: ClassRow;
}

export interface StudentFeeCharge {
  id: string;
  school_id: string;
  student_id: string;
  semester_id: string;
  fee_structure_id: string | null;
  category_id: string;
  description: string;
  amount: number;
  discount_amount: number;
  discount_reason: string | null;
  net_amount: number;
  created_by: string | null;
  created_at: string;
  category?: FeeCategory;
}

export type FeePaymentMethod = 'cash' | 'mobile_money' | 'bank_transfer' | 'cheque' | 'card' | 'other';

export interface StudentFeePayment {
  id: string;
  school_id: string;
  student_id: string;
  semester_id: string;
  receipt_number: string;
  amount: number;
  method: FeePaymentMethod;
  reference: string | null;
  paid_on: string;
  notes: string | null;
  status: 'valid' | 'reversed';
  reversal_reason: string | null;
  reversed_at: string | null;
  reversed_by: string | null;
  recorded_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface StudentFeeStatement {
  student_id: string;
  total_charged: number;
  total_discounted: number;
  net_charged: number;
  total_paid: number;
  balance: number;
  charges: StudentFeeCharge[];
  payments: StudentFeePayment[];
}

export type PromotionDecision = 'promoted' | 'promoted_on_probation' | 'repeated' | 'graduated' | 'withdrawn';

export interface StudentPromotion {
  id: string;
  school_id: string;
  from_academic_year_id: string;
  to_academic_year_id: string;
  from_class_id: string;
  to_class_id: string | null;
  student_id: string;
  decision: PromotionDecision;
  notes: string | null;
  promoted_by: string | null;
  promoted_at: string;
}

export interface ConsolidatedSubjectResult {
  subject_id: string;
  subject_name: string;
  total: number;
  percentage: number | null;
  grade: string | null;
  remark: string | null;
  scores_entered: number;
  assessments_count: number;
}

export interface ConsolidatedStudentRow {
  student_id: string;
  admission_number: string;
  student_name: string;
  subject_results: ConsolidatedSubjectResult[];
  overall_total?: number;
  overall_average?: number | null;
  overall_grade?: string | null;
  position?: number | null;
  is_incomplete?: boolean;
}

export type SmsProvider = 'arkesel' | 'hubtel' | 'custom';
export type TemplateCategory = 'exam' | 'report_card' | 'fee' | 'attendance' | 'general';
export type CommunicationChannel = 'sms' | 'whatsapp';
export type SmsStatus = 'pending' | 'sent' | 'delivered' | 'failed';
export type WhatsAppShareStatus = 'pdf_generated' | 'whatsapp_opened' | 'marked_as_sent';

export interface CommunicationSettings {
  id: string;
  school_id: string;
  provider: SmsProvider;
  sms_sender_id: string;
  sms_api_key: string | null;
  sms_api_secret: string | null;
  school_signature: string | null;
  sms_rate_per_unit: number;
  is_sms_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface MessageTemplate {
  id: string;
  school_id: string;
  name: string;
  title?: string;
  category: TemplateCategory;
  content: string;
  is_default: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CommunicationBatch {
  id: string;
  school_id: string;
  channel: CommunicationChannel;
  title: string;
  filter_type: 'all' | 'class' | 'selected';
  target_class_id: string | null;
  total_recipients: number;
  successful_count: number;
  failed_count: number;
  estimated_cost: number;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  created_by: string | null;
  created_at: string;
}

export interface SmsLog {
  id: string;
  school_id: string;
  batch_id: string | null;
  student_id: string | null;
  recipient_name: string;
  recipient_phone: string;
  message: string;
  units: number;
  estimated_cost: number;
  status: SmsStatus;
  provider: string;
  provider_message_id: string | null;
  error_message: string | null;
  sent_by: string | null;
  created_at: string;
  student?: Student;
}

export interface WhatsAppReportShare {
  id: string;
  school_id: string;
  student_id: string;
  terminal_report_id: string | null;
  semester_id: string;
  class_id: string;
  parent_name: string;
  parent_phone: string;
  message: string | null;
  status: WhatsAppShareStatus;
  notes: string | null;
  shared_by: string | null;
  created_at: string;
  updated_at: string;
  student?: Student;
}


