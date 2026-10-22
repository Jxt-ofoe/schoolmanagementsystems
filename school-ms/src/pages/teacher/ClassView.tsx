import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { unwrap } from '../../lib/queries';
import { classLabel, todayISO } from '../../lib/format';
import type { ClassRow, Student } from '../../lib/types';
import { Alert, Card, EmptyState, PageHeader, SearchBox, Spinner } from '../../components/ui';

export default function TeacherClassPage() {
  const { classId } = useParams();
  const [q, setQ] = useState('');
  const cls = useQuery({ queryKey: ['class', classId], queryFn: () => unwrap<ClassRow>(supabase.from('classes').select('*').eq('id', classId!).single()) });
  const students = useQuery({
    queryKey: ['students', 'class', classId, 'teacher'],
    queryFn: () => unwrap<Student[]>(supabase.from('students').select('*').eq('current_class_id', classId!).eq('enrollment_status', 'active').order('last_name')),
  });
  const subjects = useQuery({
    queryKey: ['my_subjects', classId],
    queryFn: () => unwrap<{ subject_id: string; subjects: { name: string } | null }[]>(supabase.from('teacher_assignments').select('subject_id, subjects(name)').eq('class_id', classId!).not('subject_id', 'is', null)),
  });
  if (cls.isLoading) return <Spinner />;
  if (cls.error || !cls.data) return (
    <>
      <PageHeader title="Class Access" back={<Link to="/teach">← Dashboard</Link>} />
      <div style={{ marginTop: 16 }}>
        <Alert tone="warn">You are not assigned to this class. Teachers can only view classes they are assigned to.</Alert>
      </div>
    </>
  );
  const rows = (students.data ?? []).filter((s) => !q || `${s.first_name} ${s.last_name} ${s.admission_number}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <PageHeader back={<Link to="/teach">← Dashboard</Link>} title={classLabel(cls.data)} subtitle={`${students.data?.length ?? '…'} active students`}
        actions={<>
          <Link className="btn btn-primary" to={`/attendance/${classId}?date=${todayISO()}`}>Attendance</Link>
          {subjects.data?.map((s) => <Link key={s.subject_id} className="btn btn-secondary" to={`/grades/${classId}/${s.subject_id}`}>{s.subjects?.name} grades</Link>)}
        </>} />
      <Card padded={false}>
        <div className="filters" style={{ padding: '12px 16px 0' }}><SearchBox value={q} onChange={setQ} placeholder="Search this class" /></div>
        {students.isLoading ? <Spinner /> : !rows.length ? <EmptyState title="No students" /> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Name</th><th>Admission no.</th><th>Guardian</th><th>Phone</th></tr></thead>
            <tbody>{rows.map((s) => (
              <tr key={s.id}><td>{s.last_name}, {s.first_name}</td><td className="mono">{s.admission_number}</td><td>{s.guardian_name ?? '—'}</td>
                <td>{s.guardian_phone ? <a href={`tel:${s.guardian_phone}`}>{s.guardian_phone}</a> : '—'}</td></tr>))}
            </tbody>
          </table></div>
        )}
      </Card>
    </>
  );
}
