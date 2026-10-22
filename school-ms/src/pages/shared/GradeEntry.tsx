import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { semesterLabel, unwrap, useGradeBands, useSemesters } from '../../lib/queries';
import { assessmentSchema, fieldErrors } from '../../lib/validation';
import { computeResult, remainingWeight, validateScore } from '../../lib/grades';
import { classLabel, humanize } from '../../lib/format';
import { friendlyError } from '../../lib/errors';
import { downloadCsv } from '../../lib/csv';
import { useToast } from '../../lib/toast';
import type { Assessment, ClassRow } from '../../lib/types';
import { Alert, Badge, Button, Card, ConfirmDialog, EmptyState, ErrorBox, Input, Modal, PageHeader, Select, Spinner } from '../../components/ui';

type Cell = { raw: string; original: string };

export default function GradeEntryPage() {
  const { classId, subjectId } = useParams();
  const [params, setParams] = useSearchParams();
  const { active } = useAuth();
  const schoolId = active!.school_id;
  const qc = useQueryClient();
  const toast = useToast();
  const semesters = useSemesters(schoolId);
  const semesterId = params.get('semester') || semesters.data?.find((s) => s.is_current)?.id || '';
  const bands = useGradeBands(schoolId);
  const [cells, setCells] = useState<Record<string, Cell>>({});
  const [editing, setEditing] = useState<Assessment | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Assessment | null>(null);

  const meta = useQuery({
    queryKey: ['grade_meta', classId, subjectId],
    queryFn: async () => {
      const [cls, subj] = await Promise.all([
        unwrap<ClassRow>(supabase.from('classes').select('*').eq('id', classId!).single()),
        unwrap<{ id: string; name: string }>(supabase.from('subjects').select('id, name').eq('id', subjectId!).single()),
      ]);
      return { cls, subj };
    },
  });
  const assessments = useQuery({
    queryKey: ['assessments', classId, subjectId, semesterId],
    enabled: !!semesterId,
    queryFn: () => unwrap<Assessment[]>(supabase.from('assessments').select('*').eq('class_id', classId!).eq('subject_id', subjectId!)
      .eq('semester_id', semesterId).order('assessment_date', { nullsFirst: false }).order('created_at')),
  });
  const students = useQuery({
    queryKey: ['students', 'class', classId, 'grades'],
    queryFn: () => unwrap<{ id: string; first_name: string; last_name: string; admission_number: string }[]>(
      supabase.from('students').select('id, first_name, last_name, admission_number').eq('current_class_id', classId!)
        .eq('enrollment_status', 'active').order('last_name').order('first_name')),
  });
  const ids = assessments.data?.map((a) => a.id) ?? [];
  const scores = useQuery({
    queryKey: ['scores', classId, subjectId, semesterId, ids.join(',')],
    enabled: ids.length > 0,
    queryFn: () => unwrap<{ assessment_id: string; student_id: string; score: number }[]>(
      supabase.from('scores').select('assessment_id, student_id, score').in('assessment_id', ids)),
  });

  useEffect(() => {
    const next: Record<string, Cell> = {};
    for (const s of scores.data ?? []) {
      const v = String(Number(s.score));
      next[`${s.assessment_id}:${s.student_id}`] = { raw: v, original: v };
    }
    setCells(next);
  }, [scores.data]);

  const list = assessments.data ?? [];
  const dirtyKeys = Object.entries(cells).filter(([, c]) => c.raw.trim() !== c.original).map(([k]) => k);
  const invalid = useMemo(() => {
    const out = new Set<string>();
    for (const [k, c] of Object.entries(cells)) {
      const a = list.find((x) => x.id === k.split(':')[0]);
      if (a && validateScore(c.raw, Number(a.max_score)).error) out.add(k);
    }
    return out;
  }, [cells, list]);

  const setCell = (key: string, raw: string) => setCells((c) => ({ ...c, [key]: { raw, original: c[key]?.original ?? '' } }));

  const save = useMutation({
    mutationFn: async () => {
      if (invalid.size) throw new Error('Fix the highlighted scores first.');
      const byAssessment = new Map<string, { student_id: string; score: number | null }[]>();
      for (const key of dirtyKeys) {
        const [aid, sid] = key.split(':');
        const a = list.find((x) => x.id === aid)!;
        const { value } = validateScore(cells[key].raw, Number(a.max_score));
        if (!byAssessment.has(aid)) byAssessment.set(aid, []);
        byAssessment.get(aid)!.push({ student_id: sid, score: value });
      }
      for (const [aid, payload] of byAssessment) {
        const { error } = await supabase.rpc('save_scores', { p_assessment_id: aid, p_scores: payload });
        if (error) throw error;
      }
      return dirtyKeys.length;
    },
    onSuccess: (n) => { toast(`${n} score${n === 1 ? '' : 's'} saved`); qc.invalidateQueries({ queryKey: ['scores', classId, subjectId] }); },
    onError: (e) => toast(friendlyError(e), 'error'),
  });
  const del = useMutation({
    mutationFn: async (a: Assessment) => { const { error } = await supabase.from('assessments').delete().eq('id', a.id); if (error) throw error; },
    onSuccess: () => { toast('Assessment deleted'); setDeleting(null); qc.invalidateQueries({ queryKey: ['assessments'] }); },
    onError: (e) => { toast(friendlyError(e), 'error'); setDeleting(null); },
  });

  const scoreMap = (studentId: string) => {
    const m: Record<string, number | null> = {};
    for (const a of list) {
      const c = cells[`${a.id}:${studentId}`];
      const v = c ? validateScore(c.raw, Number(a.max_score)).value : null;
      m[a.id] = v;
    }
    return m;
  };

  if (meta.isLoading || semesters.isLoading) return <Spinner />;
  if (meta.error) return <ErrorBox error={meta.error} />;
  const { cls, subj } = meta.data!;
  const totalWeight = 100 - remainingWeight(list);
  const backTo = active?.role === 'headmaster' ? '/school/grades' : '/teach';
  const semester = semesters.data?.find((s) => s.id === semesterId);

  const exportCsv = () => downloadCsv(`${classLabel(cls)}-${subj.name}-${semester?.name ?? ''}.csv`,
    (students.data ?? []).map((s) => {
      const r = computeResult(list, scoreMap(s.id), bands.data?.bands ?? []);
      const row: Record<string, unknown> = { admission_number: s.admission_number, student: `${s.last_name}, ${s.first_name}` };
      list.forEach((a) => { row[`${a.name} (/${Number(a.max_score)})`] = scoreMap(s.id)[a.id] ?? ''; });
      return { ...row, total: r.total, percentage: r.percentage ?? '', grade: r.grade ?? '' };
    }));

  return (
    <>
      <PageHeader back={<Link to={backTo}>← Back</Link>} title={`${subj.name} · ${classLabel(cls)}`}
        subtitle={semesterLabel(semester)}
        actions={<>
          <Select label="Semester" value={semesterId} onChange={(e) => setParams({ semester: e.target.value })}>
            {semesters.data?.map((s) => <option key={s.id} value={s.id}>{semesterLabel(s)}</option>)}
          </Select>
        </>} />
      {!semesterId ? <Alert tone="warn">No current semester. Ask the headmaster to set one up.</Alert> : (
        <>
          <Card title="Assessments" actions={<Button size="sm" onClick={() => setEditing('new')} disabled={totalWeight >= 100}>+ Add assessment</Button>}>
            {assessments.isLoading ? <Spinner /> : !list.length ? (
              <EmptyState title="No assessments yet">Add assessments such as “Class test 1” (max 20, weight 15%) and “End of semester exam” (max 100, weight 70%).</EmptyState>
            ) : (
              <>
                <div className="row" style={{ marginBottom: 8 }}>
                  <Badge tone={totalWeight === 100 ? 'good' : 'warn'}>Total weight {totalWeight}%</Badge>
                  {totalWeight !== 100 && <span className="muted small">Totals are scaled to a percentage of the weight entered so far.</span>}
                </div>
                <div className="table-wrap"><table>
                  <thead><tr><th>Assessment</th><th>Type</th><th className="num">Max</th><th className="num">Weight</th><th></th></tr></thead>
                  <tbody>{list.map((a) => (
                    <tr key={a.id}><td>{a.name}</td><td>{humanize(a.category)}</td><td className="num">{Number(a.max_score)}</td><td className="num">{Number(a.weight)}%</td>
                      <td><div className="table-actions">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(a)}>Edit</Button>
                        <Button size="sm" variant="ghost" onClick={() => setDeleting(a)}>Delete</Button>
                      </div></td></tr>))}
                  </tbody>
                </table></div>
              </>
            )}
          </Card>
          <div style={{ height: 16 }} />
          {list.length > 0 && (
            <Card title="Scores" padded={false} actions={<>
              <Button size="sm" variant="secondary" onClick={exportCsv}>Export CSV</Button>
              <Button size="sm" onClick={() => save.mutate()} loading={save.isPending} disabled={!dirtyKeys.length}>Save {dirtyKeys.length || ''} change{dirtyKeys.length === 1 ? '' : 's'}</Button>
            </>}>
              <ErrorBox error={scores.error || students.error} />
              {students.isLoading ? <Spinner /> : !students.data?.length ? <EmptyState title="No active students in this class" /> : (
                <div className="table-wrap"><table>
                  <thead><tr>
                    <th className="sticky-col">Student</th>
                    {list.map((a) => <th key={a.id} className="num" title={`${a.name}: max ${a.max_score}, weight ${a.weight}%`}>{a.name}<div className="muted">/{Number(a.max_score)} · {Number(a.weight)}%</div></th>)}
                    <th className="num">Total</th><th className="num">%</th><th>Grade</th>
                  </tr></thead>
                  <tbody>{students.data.map((s) => {
                    const r = computeResult(list, scoreMap(s.id), bands.data?.bands ?? []);
                    return (
                      <tr key={s.id}>
                        <td className="sticky-col nowrap">{s.last_name}, {s.first_name}<div className="muted small mono">{s.admission_number}</div></td>
                        {list.map((a) => {
                          const key = `${a.id}:${s.id}`;
                          const c = cells[key];
                          const err = c ? validateScore(c.raw, Number(a.max_score)).error : null;
                          return (
                            <td key={a.id} className="num">
                              <input className={`score-input ${c && c.raw.trim() !== c.original ? 'dirty' : ''} ${err ? 'invalid' : ''}`}
                                inputMode="decimal" aria-label={`${a.name} score for ${s.first_name} ${s.last_name}`} title={err ?? ''}
                                aria-invalid={!!err || undefined} value={c?.raw ?? ''} onChange={(e) => setCell(key, e.target.value)} />
                            </td>);
                        })}
                        <td className="num">{r.total.toFixed(1)}<span className="muted">/{r.weightTotal}</span></td>
                        <td className="num">{r.percentage ?? '—'}</td>
                        <td>{r.grade ? <strong>{r.grade}</strong> : '—'}{!r.complete && r.entered > 0 && <span className="muted small"> (incomplete)</span>}</td>
                      </tr>);
                  })}</tbody>
                </table></div>
              )}
              {invalid.size > 0 && <div style={{ padding: '0 16px' }}><Alert tone="error">{invalid.size} score{invalid.size === 1 ? ' is' : 's are'} outside the allowed range.</Alert></div>}
              <p className="muted small" style={{ padding: '0 16px 12px' }}>Clear a cell and save to remove a score. Every change records who made it and when.</p>
            </Card>
          )}
        </>
      )}
      {editing && <AssessmentModal assessment={editing === 'new' ? null : editing} list={list}
        ctx={{ school_id: schoolId, semester_id: semesterId, class_id: classId!, subject_id: subjectId! }} onClose={() => setEditing(null)} />}
      <ConfirmDialog open={!!deleting} danger title="Delete assessment" confirmLabel="Delete" loading={del.isPending}
        message={`Delete “${deleting?.name}” and all of its scores? This is recorded in the audit log and cannot be undone.`}
        onCancel={() => setDeleting(null)} onConfirm={() => deleting && del.mutate(deleting)} />
    </>
  );
}

function AssessmentModal({ assessment, list, ctx, onClose }: {
  assessment: Assessment | null; list: Assessment[]; ctx: { school_id: string; semester_id: string; class_id: string; subject_id: string }; onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const left = remainingWeight(list, assessment?.id);
  const [v, setV] = useState({
    name: assessment?.name ?? '', category: assessment?.category ?? 'class_score',
    max_score: String(assessment?.max_score ?? 20), weight: String(assessment?.weight ?? Math.min(left, 10)), assessment_date: assessment?.assessment_date ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const m = useMutation({
    mutationFn: async () => {
      const parsed = assessmentSchema.safeParse(v);
      if (!parsed.success) { setErrors(fieldErrors(parsed.error)); throw new Error('Please fix the highlighted fields.'); }
      if (parsed.data.weight > left) { setErrors({ weight: `Only ${left}% weight remains` }); throw new Error('Weight too high'); }
      const q = assessment
        ? supabase.from('assessments').update(parsed.data).eq('id', assessment.id)
        : supabase.from('assessments').insert({ ...parsed.data, ...ctx });
      const { error } = await q;
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['assessments'] }); toast('Assessment saved'); onClose(); },
  });
  return (
    <Modal open title={assessment ? 'Edit assessment' : 'New assessment'} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={() => m.mutate()} loading={m.isPending}>Save</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); m.mutate(); }}>
        {m.error && <Alert tone="error">{friendlyError(m.error)}</Alert>}
        <Input label="Name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} error={errors.name} placeholder="Class test 1" required />
        <div className="form-grid">
          <Select label="Type" value={v.category} onChange={(e) => setV({ ...v, category: e.target.value as Assessment['category'] })}>
            <option value="class_score">Class score</option><option value="exam">Exam</option><option value="other">Other</option>
          </Select>
          <Input label="Date" type="date" value={v.assessment_date} onChange={(e) => setV({ ...v, assessment_date: e.target.value })} />
          <Input label="Maximum mark" type="number" min={1} step="0.5" value={v.max_score} onChange={(e) => setV({ ...v, max_score: e.target.value })} error={errors.max_score} required />
          <Input label="Weight (%)" type="number" min={0} max={left} step="0.5" value={v.weight} onChange={(e) => setV({ ...v, weight: e.target.value })} error={errors.weight} hint={`${left}% available`} required />
        </div>
      </form>
    </Modal>
  );
}
