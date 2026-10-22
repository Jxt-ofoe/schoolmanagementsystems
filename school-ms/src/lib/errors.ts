interface PgLikeError { code?: string; message?: string; details?: string | null; hint?: string | null }

const constraintMessages: Record<string, string> = {
  students_admission_uq: 'That admission number is already used by another student in this school.',
  students_identity_uq: 'A student with the same first name, last name and date of birth already exists.',
  classes_unique_name: 'A class with this name and section already exists.',
  subjects_unique_name: 'A subject with this name already exists.',
  teacher_assignments_class_teacher_uq: 'This teacher is already the class teacher for that class.',
  teacher_assignments_subject_uq: 'This teacher is already assigned to that subject in that class.',
  attendance_records_student_id_class_id_attendance_date_key: 'Attendance for this student on this date already exists.',
  student_enrollments_student_id_semester_id_key: 'This student is already registered for that semester.',
  payments_reference_uq: 'A payment with this reference has already been recorded.',
  academic_years_school_id_name_key: 'An academic year with this name already exists.',
  semesters_academic_year_id_name_key: 'A semester with this name already exists in that academic year.',
  schools_code_key: 'That school code is already taken.',
  assessments_semester_id_class_id_subject_id_name_key: 'An assessment with this name already exists for this class and subject.',
  grading_scale_bands_scale_id_grade_key: 'That grade letter already exists in the scale.',
  grading_scale_bands_scale_id_min_score_key: 'Another band already starts at that minimum score.',
};

export function friendlyError(err: unknown): string {
  if (!err) return 'Something went wrong.';
  if (typeof err === 'string') return err;
  const e = err as PgLikeError & { name?: string };
  const msg = e.message ?? '';
  const constraint = Object.keys(constraintMessages).find((k) => msg.includes(k) || e.details?.includes(k));
  if (constraint) return constraintMessages[constraint];
  switch (e.code) {
    case '23505': return 'This record already exists.';
    case '23503':
      if (msg.includes('update or delete')) return 'This record is still in use (for example, students are assigned to it). Remove those links first or archive it instead.';
      return 'A linked record was not found in this school.';
    case '42501': return msg && !msg.includes('row-level security') && !msg.includes('permission denied')
      ? msg : 'You do not have permission to do that.';
    case '23514':
      if (msg.includes('violates check constraint')) {
        const m = msg.match(/check constraint "\w+?_(\w+?)_check"/);
        return m ? `Invalid value for ${m[1].replace(/_/g, ' ')}.` : 'One of the values is not valid.';
      }
      return msg;
    case 'P0002': return msg || 'Not found.';
    case 'PGRST116': return 'Record not found, or you do not have access to it.';
    case '22P02': return 'Invalid identifier or value.';
    default:
      if (msg.includes('Failed to fetch')) return 'Network error — check your connection and try again.';
      return msg || 'Something went wrong.';
  }
}
