import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useSchool } from '../../lib/auth';
import { unwrap, useClasses, useSemesters } from '../../lib/queries';
import { classLabel, ilikePattern, studentName } from '../../lib/format';
import type { Student } from '../../lib/types';
import {
  Badge, Button, Card, EmptyState, ErrorBox, PageHeader, Pagination, SearchBox, Select, Spinner, useDebounced,
} from '../../components/ui';
import { StudentForm } from '../../components/StudentForm';

const PAGE = 25;

export default function StudentsPage() {
  const { schoolId } = useSchool();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [status, setStatus] = useState(params.get('status') ?? 'active');
  const [classFilter, setClassFilter] = useState(params.get('class') ?? '');
  const [gender, setGender] = useState('');
  const [page, setPage] = useState(0);
  const [adding, setAdding] = useState(false);
  const search = useDebounced(q, 300);

  const classes = useClasses(schoolId);
  const semesters = useSemesters(schoolId);
  const current = semesters.data?.find((s) => s.is_current);
  const counts = useQuery({
    queryKey: ['class_counts', schoolId],
    queryFn: () => unwrap<{ class_id: string | null; active: number; total: number }[]>(
      supabase.rpc('class_student_counts', { p_school_id: schoolId })),
  });
  const classTeachers = useQuery({
    queryKey: ['class_teachers', schoolId],
    queryFn: () => unwrap<{ class_id: string; profiles: { full_name: string } | null }[]>(
      supabase.from('teacher_assignments').select('class_id, profiles(full_name)').eq('school_id', schoolId).is('subject_id', null)),
  });

  const filtering = search.trim() !== '' || classFilter !== '' || gender !== '' || status !== 'active';
  const results = useQuery({
    queryKey: ['students', 'search', schoolId, search, status, classFilter, gender, page],
    enabled: filtering,
    queryFn: async () => {
      let query = supabase.from('students')
        .select('id, admission_number, first_name, last_name, other_names, gender, enrollment_status, current_class_id, classes(name, section)', { count: 'exact' })
        .eq('school_id', schoolId);
      if (search.trim()) query = query.ilike('search_text', ilikePattern(search));
      if (status !== 'all') query = query.eq('enrollment_status', status);
      if (classFilter === 'none') query = query.is('current_class_id', null);
      else if (classFilter) query = query.eq('current_class_id', classFilter);
      if (gender) query = query.eq('gender', gender);
      const { data, error, count } = await query.order('last_name').order('first_name').range(page * PAGE, page * PAGE + PAGE - 1);
      if (error) throw error;
      return { rows: data as unknown as (Student & { classes: { name: string; section: string | null } | null })[], count: count ?? 0 };
    },
  });

  const countFor = useMemo(() => {
    const m = new Map<string | null, { active: number; total: number }>();
    counts.data?.forEach((c) => m.set(c.class_id, c));
    return m;
  }, [counts.data]);
  const teachersFor = (classId: string) =>
    (classTeachers.data ?? []).filter((t) => t.class_id === classId).map((t) => t.profiles?.full_name).filter(Boolean).join(', ');
  const unplaced = countFor.get(null)?.active ?? 0;
  const totalActive = counts.data?.reduce((s, c) => s + c.active, 0) ?? 0;

  const update = (fn: () => void) => { fn(); setPage(0); };
  const syncParams = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
  };

  return (
    <>
      <PageHeader title="Students" subtitle={`${totalActive} active students across ${classes.data?.length ?? 0} classes`}
        actions={<Button onClick={() => setAdding(true)} disabled={!classes.data}>+ Add student</Button>} />

      <Card>
        <div className="filters">
          <SearchBox value={q} onChange={(v) => update(() => { setQ(v); syncParams('q', v); })}
            placeholder="Search the whole school by name or admission number" label="Search students" />
          <Select label="Class" value={classFilter} onChange={(e) => update(() => { setClassFilter(e.target.value); syncParams('class', e.target.value); })}>
            <option value="">All classes</option>
            {classes.data?.map((c) => <option key={c.id} value={c.id}>{classLabel(c)}</option>)}
            <option value="none">Not placed</option>
          </Select>
          <Select label="Status" value={status} onChange={(e) => update(() => { setStatus(e.target.value); syncParams('status', e.target.value); })}>
            <option value="active">Active</option><option value="suspended">Suspended</option><option value="withdrawn">Withdrawn</option>
            <option value="transferred_out">Transferred out</option><option value="graduated">Graduated</option><option value="all">All statuses</option>
          </Select>
          <Select label="Gender" value={gender} onChange={(e) => update(() => setGender(e.target.value))}>
            <option value="">Any</option><option value="female">Female</option><option value="male">Male</option>
          </Select>
        </div>
      </Card>

      <div style={{ height: 16 }} />

      {!filtering ? (
        <>
          <div className="row-between" style={{ marginBottom: 10 }}>
            <h2>Browse by class</h2>
            <Link to="/school/classes" className="small">Manage classes</Link>
          </div>
          <ErrorBox error={classes.error || counts.error} onRetry={() => { classes.refetch(); counts.refetch(); }} />
          {classes.isLoading ? <Spinner /> : classes.data?.length === 0 ? (
            <Card><EmptyState title="No classes yet" action={<Link className="btn btn-primary" to="/school/classes">Create your first class</Link>}>
              Create classes (for example Class 1, Class 2, JHS 1) and students will be organised under them.
            </EmptyState></Card>
          ) : (
            <div className="class-grid">
              {classes.data?.map((c) => {
                const n = countFor.get(c.id);
                const t = teachersFor(c.id);
                return (
                  <Link key={c.id} to={`/school/students/class/${c.id}`} className="class-card">
                    <h3>{classLabel(c)}</h3>
                    <div className="count">{n?.active ?? 0}</div>
                    <div className="meta">active student{n?.active === 1 ? '' : 's'}{c.capacity ? ` · capacity ${c.capacity}` : ''}</div>
                    <div className="meta truncate" title={t}>{t ? `Class teacher: ${t}` : 'No class teacher assigned'}</div>
                  </Link>
                );
              })}
              {unplaced > 0 && (
                <button className="class-card unplaced" style={{ textAlign: 'left', font: 'inherit', cursor: 'pointer' }}
                  onClick={() => update(() => { setClassFilter('none'); syncParams('class', 'none'); })}>
                  <h3>Not placed</h3>
                  <div className="count">{unplaced}</div>
                  <div className="meta">students without a class</div>
                </button>
              )}
            </div>
          )}
        </>
      ) : (
        <Card title="Results" padded={false} actions={<Button variant="ghost" size="sm" onClick={() => {
          setQ(''); setClassFilter(''); setStatus('active'); setGender(''); setPage(0); setParams({}, { replace: true });
        }}>Clear filters</Button>}>
          <ErrorBox error={results.error} onRetry={() => results.refetch()} />
          {results.isLoading ? <Spinner /> : results.data?.rows.length === 0 ? (
            <EmptyState title="No students match">Try a different name, admission number or filter.</EmptyState>
          ) : (
            <>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Name</th><th>Admission no.</th><th>Class</th><th>Gender</th><th>Status</th></tr></thead>
                  <tbody>
                    {results.data?.rows.map((s) => (
                      <tr key={s.id} className="clickable" onClick={() => navigate(`/school/students/${s.id}`)}>
                        <td><Link to={`/school/students/${s.id}`} onClick={(e) => e.stopPropagation()}>{studentName(s)}</Link></td>
                        <td className="mono">{s.admission_number}</td>
                        <td>{classLabel(s.classes)}</td>
                        <td>{s.gender ? (s.gender === 'female' ? 'F' : 'M') : '—'}</td>
                        <td><Badge value={s.enrollment_status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination page={page} pageSize={PAGE} total={results.data?.count ?? 0} onPage={setPage} />
            </>
          )}
        </Card>
      )}

      {adding && classes.data && (
        <StudentForm open onClose={() => setAdding(false)} schoolId={schoolId} classes={classes.data}
          currentSemesterId={current?.id} onSaved={(id) => navigate(`/school/students/${id}`)} />
      )}
    </>
  );
}
