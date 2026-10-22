import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useSchool } from '../../lib/auth';
import { unwrap } from '../../lib/queries';
import { formatDate, todayISO } from '../../lib/format';
import { Badge, Card, EmptyState, ErrorBox, Input, PageHeader, Spinner } from '../../components/ui';

interface ClassAttendanceSummary {
  class_id: string;
  class_name: string;
  is_class_teacher: boolean;
  students: number;
  attendance_status: string;
}

export default function TeacherAttendancePage() {
  const { schoolId } = useSchool();
  const [date, setDate] = useState(todayISO());

  const q = useQuery({
    queryKey: ['teacher_attendance_classes', schoolId, date],
    queryFn: async () => {
      const data = await unwrap<{
        classes: ClassAttendanceSummary[];
      }>(supabase.rpc('teacher_dashboard', { p_school_id: schoolId, p_date: date }));
      return data.classes;
    },
  });

  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;

  const classes = q.data ?? [];
  const submittedCount = classes.filter((c) => c.attendance_status === 'submitted').length;

  return (
    <>
      <PageHeader
        title="Attendance Registers"
        subtitle={`Mark and review daily student attendance for your classes · ${formatDate(date)}`}
        actions={
          <div style={{ width: 170 }}>
            <Input
              label="Date"
              type="date"
              value={date}
              max={todayISO()}
              onChange={(e) => e.target.value && setDate(e.target.value)}
            />
          </div>
        }
      />

      {!classes.length ? (
        <EmptyState title="No assigned classes">
          You are not currently assigned to any classes. Your headmaster assigns teachers to classes.
        </EmptyState>
      ) : (
        <>
          <div className="stats" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 16 }}>
            <div className="card" style={{ padding: '14px 18px' }}>
              <div className="muted small">Assigned classes</div>
              <strong style={{ fontSize: '1.4rem' }}>{classes.length}</strong>
            </div>
            <div className="card" style={{ padding: '14px 18px' }}>
              <div className="muted small">Registers submitted</div>
              <strong style={{ fontSize: '1.4rem', color: 'var(--color-primary, #059669)' }}>{submittedCount}</strong>
            </div>
            <div className="card" style={{ padding: '14px 18px' }}>
              <div className="muted small">Pending registers</div>
              <strong style={{ fontSize: '1.4rem', color: classes.length - submittedCount > 0 ? '#d97706' : 'inherit' }}>
                {classes.length - submittedCount}
              </strong>
            </div>
          </div>

          <Card title={`Classes for ${formatDate(date)}`}>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
              {classes.map((c) => (
                <div key={c.class_id} className="card" style={{ border: '1px solid var(--border, #e5e7eb)', padding: 16, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                  <div>
                    <div className="row-between" style={{ alignItems: 'flex-start', marginBottom: 6 }}>
                      <h3 style={{ margin: 0, fontSize: '1.15rem' }}>{c.class_name}</h3>
                      <Badge value={c.attendance_status} />
                    </div>
                    <div className="muted small" style={{ marginBottom: 12 }}>
                      {c.students} student{c.students === 1 ? '' : 's'}
                      {c.is_class_teacher ? ' · Class Teacher' : ''}
                    </div>
                  </div>
                  <Link
                    to={`/attendance/${c.class_id}?date=${date}`}
                    className={`btn ${c.attendance_status === 'submitted' ? 'btn-secondary' : 'btn-primary'} btn-sm`}
                    style={{ textAlign: 'center', width: '100%' }}
                  >
                    {c.attendance_status === 'submitted' ? 'Review register' : 'Take attendance'}
                  </Link>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}
    </>
  );
}
