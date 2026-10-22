import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
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

  const save = useMutation({
    mutationFn: async () => {
      const parsed = studentSchema.safeParse(values);
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
      if (register && currentSemesterId && data.current_class_id) {
        const { error: regErr } = await supabase.rpc('register_students_for_semester', { p_semester_id: currentSemesterId, p_student_ids: [row.id] });
        if (regErr) toast(`Student saved, but registration failed: ${friendlyError(regErr)}`, 'error');
      }
      return row.id as string;
    },
    onSuccess: (id) => {
      toast(editing ? 'Student updated' : 'Student added');
      qc.invalidateQueries({ queryKey: ['students'] });
      qc.invalidateQueries({ queryKey: ['student', id] });
      qc.invalidateQueries({ queryKey: ['class_counts'] });
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
          <Input label="Admission number" value={values.admission_number} onChange={set('admission_number')} error={errors.admission_number} required />
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
        {!editing && currentSemesterId && (
          <label className="checkbox">
            <input type="checkbox" checked={register} onChange={(e) => setRegister(e.target.checked)} />
            Register for the current semester (counts towards this semester's billing)
          </label>
        )}
      </form>
    </Modal>
  );
}
