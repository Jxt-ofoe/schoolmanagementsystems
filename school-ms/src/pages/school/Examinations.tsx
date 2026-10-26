import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useSchool } from '../../lib/auth';
import { semesterLabel, unwrap, useSemesters } from '../../lib/queries';
import { formatDate, todayISO } from '../../lib/format';
import { friendlyError } from '../../lib/errors';
import { useToast } from '../../lib/toast';
import type { Examination, ExaminationStatus, ExaminationType } from '../../lib/types';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorBox,
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
} from '../../components/ui';

export default function ExaminationsPage() {
  const { schoolId } = useSchool();
  const qc = useQueryClient();
  const toast = useToast();
  const semesters = useSemesters(schoolId);

  const [semesterId, setSemesterId] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editingExam, setEditingExam] = useState<Examination | null>(null);
  const [deletingExam, setDeletingExam] = useState<Examination | null>(null);

  const activeSemester =
    semesters.data?.find((s) => s.id === semesterId) ??
    semesters.data?.find((s) => s.is_current) ??
    semesters.data?.[0];

  const exams = useQuery({
    queryKey: ['examinations', schoolId, activeSemester?.id],
    enabled: !!activeSemester?.id,
    queryFn: async () => {
      const q = supabase
        .from('examinations')
        .select('*, academic_years(name), semesters(name)')
        .eq('school_id', schoolId)
        .eq('semester_id', activeSemester!.id)
        .order('created_at', { ascending: false });
      return unwrap<Examination[]>(q);
    },
  });

  const filteredExams = (exams.data ?? []).filter(
    (e) => !statusFilter || e.status === statusFilter
  );

  const deleteExamMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('examinations').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast('Examination deleted');
      setDeletingExam(null);
      qc.invalidateQueries({ queryKey: ['examinations'] });
    },
    onError: (err) => {
      toast(friendlyError(err), 'error');
      setDeletingExam(null);
    },
  });

  return (
    <>
      <PageHeader
        title="Examinations"
        subtitle="Create and manage school examinations, assessment weightings, and publishing status."
        actions={
          <Button
            onClick={() => {
              setEditingExam(null);
              setModalOpen(true);
            }}
          >
            + Create Examination
          </Button>
        }
      />

      <div className="filters">
        <Select
          label="Semester"
          value={activeSemester?.id ?? ''}
          onChange={(e) => setSemesterId(e.target.value)}
        >
          {semesters.data?.map((s) => (
            <option key={s.id} value={s.id}>
              {semesterLabel(s)}
            </option>
          ))}
        </Select>

        <Select
          label="Status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All statuses</option>
          <option value="draft">Draft</option>
          <option value="open">Open for marks</option>
          <option value="submitted">Submitted</option>
          <option value="reviewed">Reviewed</option>
          <option value="approved">Approved</option>
          <option value="published">Published</option>
        </Select>
      </div>

      <Card padded={false}>
        <ErrorBox error={exams.error} onRetry={() => exams.refetch()} />
        {exams.isLoading ? (
          <Spinner />
        ) : !filteredExams.length ? (
          <EmptyState
            title="No examinations found"
            action={
              <Button onClick={() => setModalOpen(true)}>
                Create first examination
              </Button>
            }
          >
            Create an examination to link class and subject assessments for this semester.
          </EmptyState>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Examination</th>
                  <th>Type</th>
                  <th>Period</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th className="right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredExams.map((exam) => (
                  <tr key={exam.id}>
                    <td>
                      <strong>{exam.name}</strong>
                    </td>
                    <td>
                      <Badge tone="neutral">
                        {exam.exam_type.replace(/_/g, ' ')}
                      </Badge>
                    </td>
                    <td className="small">
                      {exam.start_date ? formatDate(exam.start_date) : 'TBD'} –{' '}
                      {exam.end_date ? formatDate(exam.end_date) : 'TBD'}
                    </td>
                    <td>
                      <Badge
                        tone={
                          exam.status === 'published'
                            ? 'good'
                            : exam.status === 'open'
                            ? 'info'
                            : exam.status === 'approved'
                            ? 'good'
                            : exam.status === 'submitted'
                            ? 'warn'
                            : 'neutral'
                        }
                      >
                        {exam.status}
                      </Badge>
                    </td>
                    <td className="small muted">{formatDate(exam.created_at)}</td>
                    <td className="right">
                      <div className="table-actions">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setEditingExam(exam);
                            setModalOpen(true);
                          }}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setDeletingExam(exam)}
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {modalOpen && (
        <ExaminationModal
          exam={editingExam}
          schoolId={schoolId}
          semester={activeSemester}
          onClose={() => {
            setModalOpen(false);
            setEditingExam(null);
          }}
        />
      )}

      <ConfirmDialog
        open={!!deletingExam}
        title="Delete examination"
        message={`Are you sure you want to delete "${deletingExam?.name}"? Linked assessment marks will be affected.`}
        confirmLabel="Delete"
        danger
        loading={deleteExamMutation.isPending}
        onCancel={() => setDeletingExam(null)}
        onConfirm={() => deletingExam && deleteExamMutation.mutate(deletingExam.id)}
      />
    </>
  );
}

function ExaminationModal({
  exam,
  schoolId,
  semester,
  onClose,
}: {
  exam: Examination | null;
  schoolId: string;
  semester?: { id: string; academic_year_id: string; name: string };
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();

  const [name, setName] = useState(exam?.name ?? '');
  const [examType, setExamType] = useState<ExaminationType>(
    exam?.exam_type ?? 'end_of_term'
  );
  const [startDate, setStartDate] = useState(exam?.start_date ?? todayISO());
  const [endDate, setEndDate] = useState(exam?.end_date ?? '');
  const [status, setStatus] = useState<ExaminationStatus>(exam?.status ?? 'open');
  const [error, setError] = useState<string | null>(null);

  const saveMutation = useMutation({
    mutationFn: async () => {
      setError(null);
      if (!name.trim()) throw new Error('Examination name is required');
      if (!semester?.id || !semester?.academic_year_id) {
        throw new Error('An active academic semester is required');
      }

      const payload = {
        school_id: schoolId,
        academic_year_id: semester.academic_year_id,
        semester_id: semester.id,
        name: name.trim(),
        exam_type: examType,
        start_date: startDate || null,
        end_date: endDate || null,
        status,
      };

      if (exam) {
        const { error: err } = await supabase
          .from('examinations')
          .update(payload)
          .eq('id', exam.id);
        if (err) throw err;
      } else {
        const { error: err } = await supabase.from('examinations').insert([payload]);
        if (err) throw err;
      }
    },
    onSuccess: () => {
      toast(exam ? 'Examination updated' : 'Examination created');
      qc.invalidateQueries({ queryKey: ['examinations'] });
      onClose();
    },
    onError: (err) => {
      setError(friendlyError(err));
    },
  });

  return (
    <Modal
      open
      title={exam ? `Edit: ${exam.name}` : 'Create Examination'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => saveMutation.mutate()}
            loading={saveMutation.isPending}
          >
            {exam ? 'Save changes' : 'Create examination'}
          </Button>
        </>
      }
    >
      <ErrorBox error={error} />
      <div className="form-grid">
        <Input
          label="Examination Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. End of Term 1 Examination 2026"
          required
        />

        <Select
          label="Examination Type"
          value={examType}
          onChange={(e) => setExamType(e.target.value as ExaminationType)}
        >
          <option value="end_of_term">End of Term Examination</option>
          <option value="mid_term">Mid-Term Assessment</option>
          <option value="mock">Mock Examination</option>
          <option value="class_test">Class Test Series</option>
          <option value="continuous_assessment">Continuous Assessment</option>
          <option value="other">Other Assessment</option>
        </Select>

        <Input
          label="Start Date"
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
        />

        <Input
          label="End Date"
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
        />

        <Select
          label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value as ExaminationStatus)}
        >
          <option value="draft">Draft</option>
          <option value="open">Open (Teachers can enter marks)</option>
          <option value="submitted">Submitted (Under review)</option>
          <option value="reviewed">Reviewed</option>
          <option value="approved">Approved</option>
          <option value="published">Published (Reports visible)</option>
        </Select>
      </div>
    </Modal>
  );
}
