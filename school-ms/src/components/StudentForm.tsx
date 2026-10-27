import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { studentSchema, fieldErrors } from '../lib/validation';
import { friendlyError } from '../lib/errors';
import { useToast } from '../lib/toast';
import { classLabel, todayISO } from '../lib/format';
import type { ClassRow, Student } from '../lib/types';
import { Alert, Button, Input, Modal, Select, Textarea } from './ui';

interface Props {
  open: boolean;
  onClose: () => void;
  schoolId: string;
  classes: ClassRow[];
  student?: Student | null;
  defaultClassId?: string;
  currentSemesterId?: string | null;
  onSaved?: (id: string) => void;
}

export function StudentForm({ open, onClose, schoolId, classes, student, defaultClassId, currentSemesterId, onSaved }: Props) {
  const editing = !!student;
  const qc = useQueryClient();
  const toast = useToast();
  const [values, setValues] = useState(() => ({
    admission_number: student?.admission_number ?? '',
    first_name: student?.first_name ?? '',
    last_name: student?.last_name ?? '',
    other_names: student?.other_names ?? '',
    gender: (student?.gender ?? '') as '' | 'male' | 'female',
    date_of_birth: student?.date_of_birth ?? '',
    current_class_id: student?.current_class_id ?? defaultClassId ?? '',
    admission_date: student?.admission_date ?? todayISO(),
    guardian_name: student?.guardian_name ?? '',
    guardian_relationship: student?.guardian_relationship ?? '',
    guardian_phone: student?.guardian_phone ?? '',
    guardian_email: student?.guardian_email ?? '',
    address: student?.address ?? '',
    notes: student?.notes ?? '',
  }));
  const [register, setRegister] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof values) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [k]: e.target.value }));

  // Auto-generate admission number query for new students
  const nextAdmQuery = useQuery({
    queryKey: ['next_admission_number', schoolId],
    enabled: open && !editing,
    queryFn: async () => {
      const { count } = await supabase
        .from('students')
        .select('*', { count: 'exact', head: true })
        .eq('school_id', schoolId);

      const { data: latest } = await supabase
        .from('students')
        .select('admission_number')
        .eq('school_id', schoolId)
        .order('created_at', { ascending: false })
        .limit(1);

      const nextSeq = (count ?? 0) + 1;
      const latestAdm = latest?.[0]?.admission_number;

      // If existing format in this school is purely digits (e.g. 00001), continue that sequence
      if (latestAdm && /^\d+$/.test(latestAdm)) {
        const width = Math.max(latestAdm.length, 5);
        return String(nextSeq).padStart(width, '0');
      }

      // If existing format has prefix like ADM-2026-0001 or ASES-2026-0001
      const m = latestAdm?.match(/^([A-Za-z0-9]+)-(\d{4})-(\d+)$/);
      if (m) {
        const prefix = m[1];
        const year = new Date().getFullYear();
        const width = m[3].length;
        return `${prefix}-${year}-${String(nextSeq).padStart(width, '0')}`;
      }

      // Default to school code or ADM + Year + Sequence
      const { data: sch } = await supabase.from('schools').select('code').eq('id', schoolId).single();
      const prefix = (sch?.code || 'ADM').slice(0, 4).toUpperCase().replace(/[^A-Z0-9]/g, '');
      const year = new Date().getFullYear();
      return `${prefix || 'ADM'}-${year}-${String(nextSeq).padStart(4, '0')}`;
    },
  });

  // Fallback to active semester if currentSemesterId was not passed
  const semQuery = useQuery({
    queryKey: ['active_semester_for_student_form', schoolId],
    enabled: open && !currentSemesterId,
    queryFn: async () => {
      const { data } = await supabase
        .from('semesters')
        .select('id')
        .eq('school_id', schoolId)
        .eq('is_current', true)
        .maybeSingle();
      return data?.id ?? null;
    },
  });

  const effectiveSemesterId = currentSemesterId || semQuery.data || null;

  // Pre-fill generated admission number when available
  useEffect(() => {
    if (open && !editing && nextAdmQuery.data && !values.admission_number) {
      setValues((v) => ({ ...v, admission_number: nextAdmQuery.data }));
    }
  }, [open, editing, nextAdmQuery.data, values.admission_number]);

  const save = useMutation({
    mutationFn: async () => {
      // Auto-fallback if admission number was left blank
      let adm = values.admission_number.trim();
      if (!adm && !editing) {
        adm = nextAdmQuery.data || `ADM-${new Date().getFullYear()}-${Date.now().toString().slice(-4)}`;
        setValues((v) => ({ ...v, admission_number: adm }));
      }

      const parsed = studentSchema.safeParse({ ...values, admission_number: adm });
      if (!parsed.success) {
        setErrors(fieldErrors(parsed.error));
        throw new Error('Please fix the highlighted fields.');
      }
      setErrors({});
      const data = parsed.data;
      if (editing) {
        // class changes go through the transfer flow so history is recorded
        const { current_class_id: _ignored, ...rest } = data;
        const { error } = await supabase.from('students').update(rest).eq('id', student!.id);
        if (error) throw error;
        return student!.id;
      }
      const { data: row, error } = await supabase.from('students').insert({ ...data, school_id: schoolId }).select('id').single();
      if (error) throw error;

      // 1. Register student for current semester if checked
      if (register && effectiveSemesterId && data.current_class_id) {
        const { error: regErr } = await supabase.rpc('register_students_for_semester', { p_semester_id: effectiveSemesterId, p_student_ids: [row.id] });
        if (regErr) toast(`Student saved, but registration failed: ${friendlyError(regErr)}`, 'error');
      }

      // 2. Automatically apply configured fee structures for this semester
      if (effectiveSemesterId) {
        try {
          const { data: structures } = await supabase
            .from('fee_structures')
            .select('*')
            .eq('school_id', schoolId)
            .eq('semester_id', effectiveSemesterId);

          if (structures && structures.length > 0) {
            const applicable = structures.filter(
              (st) => !st.class_id || st.class_id === data.current_class_id
            );
            if (applicable.length > 0) {
              const newCharges = applicable.map((st) => ({
                school_id: schoolId,
                student_id: row.id,
                semester_id: effectiveSemesterId,
                fee_structure_id: st.id,
                category_id: st.category_id,
                description: st.name,
                amount: Number(st.amount),
              }));
              await supabase.from('student_fee_charges').insert(newCharges);
            }
          }
        } catch (feeErr) {
          console.error('Failed to auto-bill fee structures for new student:', feeErr);
        }
      }

      return row.id as string;
    },
    onSuccess: (id) => {
      toast(editing ? 'Student updated' : 'Student added and fees configured');
      qc.invalidateQueries({ queryKey: ['students'] });
      qc.invalidateQueries({ queryKey: ['student', id] });
      qc.invalidateQueries({ queryKey: ['class_counts'] });
      qc.invalidateQueries({ queryKey: ['student_fee_charges'] });
      qc.invalidateQueries({ queryKey: ['fee_structures'] });
      qc.invalidateQueries({ queryKey: ['school_dashboard_fees'] });
      qc.invalidateQueries({ queryKey: ['next_admission_number'] });
      onSaved?.(id);
      onClose();
    },
  });

  return (
    <Modal open={open} onClose={onClose} title={editing ? 'Edit student' : 'Add student'} wide
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={() => save.mutate()} loading={save.isPending}>{editing ? 'Save changes' : 'Add student'}</Button>
      </>}>
      <form onSubmit={(e: FormEvent) => { e.preventDefault(); save.mutate(); }} noValidate>
        {save.error && <Alert tone="error">{friendlyError(save.error)}</Alert>}
        <div className="form-grid">
          <div className={`field ${errors.admission_number ? 'has-error' : ''}`}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <label htmlFor="adm-no" style={{ margin: 0, fontWeight: 500 }}>
                Admission number <span className="req" style={{ color: 'var(--red-600, #dc2626)' }}>*</span>
              </label>
              {!editing && (
                <button
                  type="button"
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--green-700)',
                    cursor: 'pointer',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                  onClick={async () => {
                    const res = await nextAdmQuery.refetch();
                    if (res.data) setValues((v) => ({ ...v, admission_number: res.data }));
                  }}
                  title="Recalculate automatic admission number"
                >
                  🔄 Auto-generate
                </button>
              )}
            </div>
            <input
              id="adm-no"
              value={values.admission_number}
              onChange={set('admission_number')}
              aria-invalid={!!errors.admission_number || undefined}
              placeholder={nextAdmQuery.isLoading ? 'Generating admission number...' : 'e.g. 00001 or ADM-2026-0001'}
              required
            />
            {errors.admission_number && <span className="error">{errors.admission_number}</span>}
          </div>
          <Input label="Admission date" type="date" value={values.admission_date} onChange={set('admission_date')} error={errors.admission_date} required />
          <Input label="First name" value={values.first_name} onChange={set('first_name')} error={errors.first_name} required />
          <Input label="Last name" value={values.last_name} onChange={set('last_name')} error={errors.last_name} required />
          <Input label="Other names" value={values.other_names} onChange={set('other_names')} error={errors.other_names} />
          <Select label="Gender" value={values.gender} onChange={set('gender')}>
            <option value="">Not specified</option><option value="female">Female</option><option value="male">Male</option>
          </Select>
          <Input label="Date of birth" type="date" max={todayISO()} value={values.date_of_birth} onChange={set('date_of_birth')} error={errors.date_of_birth}
            hint="Used with the name to prevent duplicate records" />
          {!editing ? (
            <Select label="Class" value={values.current_class_id} onChange={set('current_class_id')} error={errors.current_class_id}>
              <option value="">— Not placed yet —</option>
              {classes.map((c) => <option key={c.id} value={c.id}>{classLabel(c)}</option>)}
            </Select>
          ) : <div className="field"><label>Class</label><p className="muted small">Use “Transfer class” on the profile so the move is recorded.</p></div>}
          <Input label="Guardian name" value={values.guardian_name} onChange={set('guardian_name')} error={errors.guardian_name} />
          <Input label="Relationship" value={values.guardian_relationship} onChange={set('guardian_relationship')} placeholder="Mother, Father, Aunt…" />
          <Input label="Guardian phone" type="tel" value={values.guardian_phone} onChange={set('guardian_phone')} error={errors.guardian_phone} placeholder="024 000 0000" />
          <Input label="Guardian email" type="email" value={values.guardian_email} onChange={set('guardian_email')} error={errors.guardian_email} />
          <div className="span-2"><Textarea label="Address" value={values.address} onChange={set('address')} error={errors.address} /></div>
          <div className="span-2"><Textarea label="Notes" value={values.notes} onChange={set('notes')} error={errors.notes} /></div>
        </div>
        {!editing && effectiveSemesterId && (
          <label className="checkbox">
            <input type="checkbox" checked={register} onChange={(e) => setRegister(e.target.checked)} />
            Register for current semester and automatically bill semester fees
          </label>
        )}
      </form>
    </Modal>
  );
}
