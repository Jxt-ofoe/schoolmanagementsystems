import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useSchool } from '../../lib/auth';
import { unwrap, useClasses, useSemesters } from '../../lib/queries';
import { classLabel, ilikePattern, studentName, todayISO } from '../../lib/format';
import { downloadCsv } from '../../lib/csv';
import type { ClassRow, Student } from '../../lib/types';
import {
  Badge, Button, Card, EmptyState, ErrorBox, PageHeader, Pagination, SearchBox, Select, Spinner, useDebounced,
} from '../../components/ui';
import { StudentForm } from '../../components/StudentForm';

const PAGE = 50;

export default function ClassStudentsPage() {
  const { classId } = useParams();
  const { schoolId } = useSchool();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('active');
  const [page, setPage] = useState(0);
  const [adding, setAdding] = useState(false);
  const search = useDebounced(q);
  const classes = useClasses(schoolId);
  const semesters = useSemesters(schoolId);
  const current = semesters.data?.find((s) => s.is_current);

  const cls = useQuery({
    queryKey: ['class', classId],
    queryFn: () => unwrap<ClassRow>(supabase.from('classes').select('*').eq('id', classId!).single()),
  });
  const staff = useQuery({
    queryKey: ['class_staff', classId],
    queryFn: () => unwrap<{ id: string; subject_id: string | null; profiles: { full_name: string } | null; subjects: { name: string } | null }[]>(
      supabase.from('teacher_assignments').select('id, subject_id, profiles(full_name), subjects(name)').eq('class_id', classId!)),
  });
  const students = useQuery({
    queryKey: ['students', 'class', classId, search, status, page],
    queryFn: async () => {
      let query = supabase.from('students').select('*', { count: 'exact' }).eq('current_class_id', classId!);
      if (search.trim()) query = query.ilike('search_text', ilikePattern(search));
      if (status !== 'all') query = query.eq('enrollment_status', status);
      const { data, error, count } = await query.order('last_name').order('first_name').range(page * PAGE, page * PAGE + PAGE - 1);
      if (error) throw error;
      return { rows: data as Student[], count: count ?? 0 };
    },
  });

  if (cls.isLoading) return <Spinner />;
  if (cls.error) return <ErrorBox error={cls.error} />;
  const c = cls.data!;
  const classTeachers = staff.data?.filter((s) => !s.subject_id).map((s) => s.profiles?.full_name).join(', ');

  return (
    <>
      <PageHeader title={classLabel(c)}
        back={<Link to="/school/students">← All classes</Link>}
        subtitle={<>Class teacher: {classTeachers || <em>not assigned</em>} · {students.data?.count ?? '…'} {status === 'all' ? '' : status} students</>}
        actions={<>
          <Link className="btn btn-secondary" to={`/attendance/${c.id}?date=${todayISO()}`}>Attendance register</Link>
          <Button variant="secondary" disabled={!students.data?.rows.length} onClick={() => downloadCsv(`${classLabel(c)}-students.csv`,
            students.data!.rows.map((s) => ({ admission_number: s.admission_number, name: studentName(s), gender: s.gender ?? '', status: s.enrollment_status, guardian: s.guardian_name ?? '', guardian_phone: s.guardian_phone ?? '' })))}>
            Export CSV
          </Button>
          <Button onClick={() => setAdding(true)}>+ Add student</Button>
        </>} />

      {staff.data && staff.data.some((s) => s.subject_id) && (
        <p className="muted small">Subject teachers: {staff.data.filter((s) => s.subject_id).map((s) => `${s.subjects?.name} (${s.profiles?.full_name})`).join(' · ')}</p>
      )}

      <Card padded={false}>
        <div className="filters" style={{ padding: '12px 16px 0' }}>
          <SearchBox value={q} onChange={(v) => { setQ(v); setPage(0); }} placeholder={`Search in ${classLabel(c)}`} />
          <Select label="Status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }}>
            <option value="active">Active</option><option value="suspended">Suspended</option><option value="withdrawn">Withdrawn</option>
            <option value="transferred_out">Transferred out</option><option value="graduated">Graduated</option><option value="all">All</option>
          </Select>
        </div>
        <ErrorBox error={students.error} onRetry={() => students.refetch()} />
        {students.isLoading ? <Spinner /> : students.data?.rows.length === 0 ? (
          <EmptyState title={search ? 'No matching students' : 'No students in this class yet'}
            action={!search && <Button onClick={() => setAdding(true)}>Add a student</Button>} />
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead><tr><th>#</th><th>Name</th><th>Admission no.</th><th>Gender</th><th>Guardian</th><th>Phone</th><th>Status</th></tr></thead>
                <tbody>
                  {students.data?.rows.map((s, idx) => (
                    <tr key={s.id} className="clickable" onClick={() => navigate(`/school/students/${s.id}`)}>
                      <td className="muted">{page * PAGE + idx + 1}</td>
                      <td><Link to={`/school/students/${s.id}`} onClick={(e) => e.stopPropagation()}>{s.last_name}, {s.first_name} {s.other_names ?? ''}</Link></td>
                      <td className="mono">{s.admission_number}</td>
                      <td>{s.gender ? (s.gender === 'female' ? 'F' : 'M') : '—'}</td>
                      <td>{s.guardian_name ?? '—'}</td>
                      <td className="nowrap">{s.guardian_phone ? <a href={`tel:${s.guardian_phone}`} onClick={(e) => e.stopPropagation()}>{s.guardian_phone}</a> : '—'}</td>
                      <td><Badge value={s.enrollment_status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={PAGE} total={students.data?.count ?? 0} onPage={setPage} />
          </>
        )}
      </Card>
      {adding && classes.data && (
        <StudentForm open onClose={() => setAdding(false)} schoolId={schoolId} classes={classes.data} defaultClassId={c.id} currentSemesterId={current?.id} />
      )}
    </>
  );
}
