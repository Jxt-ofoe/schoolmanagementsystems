import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useSchool } from '../../lib/auth';
import { semesterLabel, unwrap, useSemesters } from '../../lib/queries';
import { Badge, Card, EmptyState, ErrorBox, PageHeader, ProgressBar, Select, Spinner } from '../../components/ui';

export interface GradeStatus {
  class_id: string; class_name: string; subject_id: string; subject_name: string; teacher_names: string | null;
  assessments: number; weight_total: number; students: number; scores_entered: number; scores_expected: number;
}

export default function GradesOverviewPage() {
  const { schoolId } = useSchool();
  const semesters = useSemesters(schoolId);
  const [semesterId, setSemesterId] = useState('');
  const sem = semesters.data?.find((s) => s.id === semesterId) ?? semesters.data?.find((s) => s.is_current);
  const status = useQuery({
    queryKey: ['grade_entry_status', schoolId, sem?.id],
    enabled: !!sem,
    queryFn: () => unwrap<GradeStatus[]>(supabase.rpc('grade_entry_status', { p_school_id: schoolId, p_semester_id: sem!.id })),
  });
  const rows = status.data ?? [];
  return (
    <>
      <PageHeader title="Grades" subtitle="Grade-entry progress for every class and subject. Open any row to review or correct scores."
        actions={<Select label="Semester" value={sem?.id ?? ''} onChange={(e) => setSemesterId(e.target.value)}>
          {semesters.data?.map((s) => <option key={s.id} value={s.id}>{semesterLabel(s)}</option>)}
        </Select>} />
      <Card padded={false}>
        <ErrorBox error={status.error} />
        {!sem ? <EmptyState title="No semester set up" /> : status.isLoading ? <Spinner /> : !rows.length ? (
          <EmptyState title="No subject assignments yet" action={<Link className="btn btn-primary" to="/school/teachers">Assign teachers</Link>}>
            Assign subject teachers to classes to start grade entry.
          </EmptyState>
        ) : (
          <div className="table-wrap"><table>
            <thead><tr><th>Class</th><th>Subject</th><th>Teacher(s)</th><th className="num">Assessments</th><th>Weight</th><th>Scores entered</th><th></th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.class_id + r.subject_id}>
                <td>{r.class_name}</td><td>{r.subject_name}</td><td className="small">{r.teacher_names ?? '—'}</td>
                <td className="num">{r.assessments}</td>
                <td><Badge tone={Number(r.weight_total) === 100 ? 'good' : r.assessments ? 'warn' : 'neutral'}>{Number(r.weight_total)}%</Badge></td>
                <td style={{ minWidth: 160 }}><ProgressBar value={r.scores_entered} max={r.scores_expected} label={`${r.scores_entered}/${r.scores_expected}`} /></td>
                <td className="right"><Link className="btn btn-sm btn-secondary" to={`/grades/${r.class_id}/${r.subject_id}?semester=${sem.id}`}>Review</Link></td>
              </tr>))}
            </tbody>
          </table></div>
        )}
      </Card>
    </>
  );
}
