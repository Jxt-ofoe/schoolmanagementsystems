import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useSchool } from '../../lib/auth';
import { unwrap } from '../../lib/queries';
import { todayISO } from '../../lib/format';
import { Card, EmptyState, ErrorBox, PageHeader, ProgressBar, Spinner } from '../../components/ui';

interface GradeTask {
  class_id: string;
  class_name: string;
  subject_id: string;
  subject_name: string;
  assessments: number;
  weight_total: number;
  scores_entered: number;
  scores_expected: number;
}

export default function TeacherGradesPage() {
  const { schoolId } = useSchool();
  const today = todayISO();

  const q = useQuery({
    queryKey: ['teacher_grades_overview', schoolId, today],
    queryFn: async () => {
      const data = await unwrap<{
        current_semester_id: string | null;
        current_semester: string | null;
        grade_tasks: GradeTask[];
      }>(supabase.rpc('teacher_dashboard', { p_school_id: schoolId, p_date: today }));
      return data;
    },
  });

  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;

  const data = q.data;
  const tasks = data?.grade_tasks ?? [];

  return (
    <>
      <PageHeader
        title="Grade Entry"
        subtitle={`Enter assessment marks for your assigned subjects · ${data?.current_semester ?? 'Current semester'}`}
      />

      {!data?.current_semester_id ? (
        <EmptyState title="No active semester">
          There is no current semester active. Your headmaster sets up the active semester.
        </EmptyState>
      ) : !tasks.length ? (
        <EmptyState title="No subject assignments">
          You are not currently assigned to teach any subjects. Your headmaster assigns subject teachers to classes.
        </EmptyState>
      ) : (
        <Card title="Subject Assignments" padded={false}>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Class</th>
                  <th>Subject</th>
                  <th className="num">Assessments</th>
                  <th>Total Weight</th>
                  <th>Progress</th>
                  <th className="right">Action</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((g) => (
                  <tr key={g.class_id + g.subject_id}>
                    <td><strong>{g.class_name}</strong></td>
                    <td>{g.subject_name}</td>
                    <td className="num">{g.assessments}</td>
                    <td>
                      <span className="muted small">{Number(g.weight_total)}%</span>
                    </td>
                    <td style={{ minWidth: 160 }}>
                      <ProgressBar
                        value={g.scores_entered}
                        max={g.scores_expected}
                        label={`${g.scores_entered}/${g.scores_expected}`}
                      />
                    </td>
                    <td className="right">
                      <Link
                        className="btn btn-sm btn-primary"
                        to={`/grades/${g.class_id}/${g.subject_id}`}
                      >
                        Enter grades
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}
