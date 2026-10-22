import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useSchool } from '../../lib/auth';
import { unwrap } from '../../lib/queries';
import { classLabel } from '../../lib/format';
import type { ClassRow, Student } from '../../lib/types';
import { Card, EmptyState, ErrorBox, PageHeader, SearchBox, Select, Spinner } from '../../components/ui';

interface StudentWithClass extends Student {
  classes: ClassRow | null;
}

export default function TeacherStudentsPage() {
  const { schoolId } = useSchool();
  const [q, setQ] = useState('');
  const [selectedClass, setSelectedClass] = useState('');

  // Fetch only classes assigned to this teacher
  const classesQuery = useQuery({
    queryKey: ['my_assigned_classes', schoolId],
    queryFn: () => unwrap<ClassRow[]>(supabase.from('classes').select('*').eq('is_active', true).order('level_order')),
  });

  // Fetch only students in assigned classes (strictly limited by RLS)
  const studentsQuery = useQuery({
    queryKey: ['my_assigned_students', schoolId],
    queryFn: () => unwrap<StudentWithClass[]>(
      supabase.from('students')
        .select('*, classes(id, name, section)')
        .eq('school_id', schoolId)
        .eq('enrollment_status', 'active')
        .order('last_name')
        .order('first_name')
    ),
  });

  const myClasses = classesQuery.data ?? [];
  const allStudents = studentsQuery.data ?? [];

  const filtered = useMemo(() => {
    return allStudents.filter((s) => {
      if (selectedClass && s.current_class_id !== selectedClass) return false;
      if (!q.trim()) return true;
      const term = q.toLowerCase();
      const name = `${s.first_name} ${s.other_names ?? ''} ${s.last_name}`.toLowerCase();
      const adm = (s.admission_number ?? '').toLowerCase();
      const guardian = (s.guardian_name ?? '').toLowerCase();
      return name.includes(term) || adm.includes(term) || guardian.includes(term);
    });
  }, [allStudents, q, selectedClass]);

  if (classesQuery.isLoading || studentsQuery.isLoading) return <Spinner />;
  if (classesQuery.error) return <ErrorBox error={classesQuery.error} />;
  if (studentsQuery.error) return <ErrorBox error={studentsQuery.error} />;

  return (
    <>
      <PageHeader
        title="My Students"
        subtitle={`${allStudents.length} student${allStudents.length === 1 ? '' : 's'} in your assigned ${myClasses.length === 1 ? 'class' : 'classes'}`}
      />

      <div className="filters" style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
        <div style={{ flex: 1 }}>
          <SearchBox value={q} onChange={setQ} placeholder="Search by name, admission no., or guardian..." />
        </div>
        {myClasses.length > 1 && (
          <div style={{ width: 220 }}>
            <Select label="Class" value={selectedClass} onChange={(e) => setSelectedClass(e.target.value)}>
              <option value="">All assigned classes</option>
              {myClasses.map((c) => (
                <option key={c.id} value={c.id}>{classLabel(c)}</option>
              ))}
            </Select>
          </div>
        )}
      </div>

      <Card padded={false}>
        {!allStudents.length ? (
          <EmptyState title="No assigned students yet">
            You do not have any students assigned yet. Your headmaster assigns teachers to classes.
          </EmptyState>
        ) : !filtered.length ? (
          <EmptyState title="No matching students">
            No students found matching your search.
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Student Name</th>
                  <th>Admission No.</th>
                  <th>Class</th>
                  <th>Gender</th>
                  <th>Guardian</th>
                  <th>Contact</th>
                  <th className="right">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <strong>{s.last_name}, {s.first_name}</strong>
                      {s.other_names && <span className="muted small"> {s.other_names}</span>}
                    </td>
                    <td className="mono">{s.admission_number}</td>
                    <td>{classLabel(s.classes)}</td>
                    <td style={{ textTransform: 'capitalize' }}>{s.gender ?? '—'}</td>
                    <td>
                      <div>{s.guardian_name ?? '—'}</div>
                      {s.guardian_relationship && <div className="muted small">{s.guardian_relationship}</div>}
                    </td>
                    <td>
                      {s.guardian_phone ? (
                        <a href={`tel:${s.guardian_phone}`}>{s.guardian_phone}</a>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="right">
                      {s.current_class_id && (
                        <Link className="btn btn-sm btn-secondary" to={`/teach/class/${s.current_class_id}`}>
                          View class
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
