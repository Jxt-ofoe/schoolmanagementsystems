import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useSchool } from '../../lib/auth';
import { unwrap, useClasses } from '../../lib/queries';
import { classLabel, formatDate } from '../../lib/format';
import { friendlyError } from '../../lib/errors';
import { useToast } from '../../lib/toast';
import type { PromotionDecision, Student, StudentPromotion } from '../../lib/types';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Modal,
  PageHeader,
  SearchBox,
  Select,
  Spinner,
  Tabs,
} from '../../components/ui';

export default function StudentPromotionPage() {
  const { schoolId } = useSchool();
  const qc = useQueryClient();
  const toast = useToast();
  const classes = useClasses(schoolId);

  const [activeTab, setActiveTab] = useState<'promote' | 'history'>('promote');
  const [fromYearId, setFromYearId] = useState('');
  const [toYearId, setToYearId] = useState('');
  const [currentClassId, setCurrentClassId] = useState('');
  const [targetClassId, setTargetClassId] = useState('');
  const [searchStudent, setSearchStudent] = useState('');
  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(new Set());
  const [decisions, setDecisions] = useState<Record<string, { decision: PromotionDecision; to_class_id: string | null; notes: string }>>({});
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);

  // Fetch academic years
  const academicYearsQuery = useQuery({
    queryKey: ['academic_years_promotion', schoolId],
    queryFn: () =>
      unwrap<{ id: string; name: string; is_current: boolean; starts_on: string; ends_on: string }[]>(
        supabase.from('academic_years').select('*').eq('school_id', schoolId).order('starts_on', { ascending: false })
      ),
  });

  const academicYears = academicYearsQuery.data ?? [];

  // Default from/to years
  const defaultFromYear = academicYears.find((y) => y.is_current) ?? academicYears[0];
  const activeFromYearId = fromYearId || defaultFromYear?.id || '';

  // Students in selected current class
  const studentsQuery = useQuery({
    queryKey: ['students_for_promotion', currentClassId],
    enabled: !!currentClassId,
    queryFn: () =>
      unwrap<Student[]>(
        supabase
          .from('students')
          .select('*')
          .eq('current_class_id', currentClassId)
          .eq('enrollment_status', 'active')
          .order('last_name')
          .order('first_name')
      ),
  });

  // Historical promotions
  const historyQuery = useQuery({
    queryKey: ['promotions_history', schoolId, activeFromYearId],
    enabled: activeTab === 'history' && !!activeFromYearId,
    queryFn: () =>
      unwrap<
        (StudentPromotion & {
          students: { first_name: string; last_name: string; admission_number: string } | null;
          from_classes: { name: string; section: string | null } | null;
          to_classes: { name: string; section: string | null } | null;
        })[]
      >(
        supabase
          .from('student_promotions')
          .select('*, students(first_name, last_name, admission_number), from_classes:classes!from_class_id(name, section), to_classes:classes!to_class_id(name, section)')
          .eq('school_id', schoolId)
          .eq('from_academic_year_id', activeFromYearId)
          .order('promoted_at', { ascending: false })
      ),
  });

  const students = studentsQuery.data ?? [];

  // Filter students
  const filteredStudents = useMemo(() => {
    if (!searchStudent.trim()) return students;
    const q = searchStudent.toLowerCase();
    return students.filter(
      (s) =>
        s.first_name.toLowerCase().includes(q) ||
        s.last_name.toLowerCase().includes(q) ||
        s.admission_number.toLowerCase().includes(q)
    );
  }, [students, searchStudent]);

  // Bulk select helpers
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedStudentIds(new Set(filteredStudents.map((s) => s.id)));
    } else {
      setSelectedStudentIds(new Set());
    }
  };

  const handleToggleStudent = (id: string) => {
    const next = new Set(selectedStudentIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedStudentIds(next);
  };

  // Bulk apply destination class
  const handleBulkApplyClass = () => {
    if (!targetClassId) return;
    const next = { ...decisions };
    for (const id of selectedStudentIds) {
      next[id] = {
        decision: 'promoted',
        to_class_id: targetClassId,
        notes: next[id]?.notes ?? '',
      };
    }
    setDecisions(next);
    toast(`Applied destination class to ${selectedStudentIds.size} student(s)`);
  };

  // Execute promotion mutation atomically
  const promoteMutation = useMutation({
    mutationFn: async () => {
      if (!activeFromYearId || !toYearId || !currentClassId) {
        throw new Error('Please select source year, destination year, and current class');
      }

      const payload = selectedStudentIds.size > 0
        ? Array.from(selectedStudentIds).map((id) => {
            const dec = decisions[id] ?? {
              decision: 'promoted' as PromotionDecision,
              to_class_id: targetClassId || null,
              notes: '',
            };
            return {
              student_id: id,
              decision: dec.decision,
              to_class_id: dec.to_class_id,
              notes: dec.notes,
            };
          })
        : [];

      if (!payload.length) throw new Error('No students selected for promotion');

      const { data, error } = await supabase.rpc('promote_students', {
        p_school_id: schoolId,
        p_from_year_id: activeFromYearId,
        p_to_year_id: toYearId,
        p_from_class_id: currentClassId,
        p_promotions: payload,
      });

      if (error) throw error;
      return data;
    },
    onSuccess: (count) => {
      toast(`Successfully processed promotions for ${count} students!`);
      setConfirmModalOpen(false);
      setSelectedStudentIds(new Set());
      setDecisions({});
      qc.invalidateQueries({ queryKey: ['students_for_promotion'] });
      qc.invalidateQueries({ queryKey: ['promotions_history'] });
    },
    onError: (err) => {
      toast(friendlyError(err), 'error');
    },
  });

  return (
    <>
      <PageHeader
        title="Student Promotion"
        subtitle="End-of-year academic transitions. Promoted students are placed in their next class while historical records remain intact."
      />

      <Tabs
        tabs={[
          { id: 'promote', label: 'Promotion Workflow' },
          { id: 'history', label: 'Promotion History' },
        ]}
        value={activeTab}
        onChange={setActiveTab}
      />

      {activeTab === 'promote' && (
        <>
          <div className="filters">
            <Select
              label="Transition From Academic Year"
              value={activeFromYearId}
              onChange={(e) => setFromYearId(e.target.value)}
            >
              {academicYears.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.name} {y.is_current ? '(Current)' : ''}
                </option>
              ))}
            </Select>

            <Select
              label="Transition To Academic Year"
              value={toYearId}
              onChange={(e) => setToYearId(e.target.value)}
            >
              <option value="">Select Destination Year</option>
              {academicYears.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.name}
                </option>
              ))}
            </Select>

            <Select
              label="Current Class"
              value={currentClassId}
              onChange={(e) => {
                setCurrentClassId(e.target.value);
                setSelectedStudentIds(new Set());
                setDecisions({});
              }}
            >
              <option value="">Select Current Class</option>
              {classes.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {classLabel(c)}
                </option>
              ))}
            </Select>
          </div>

          {!currentClassId ? (
            <Card>
              <EmptyState title="Select a current class to begin promotion" />
            </Card>
          ) : studentsQuery.isLoading ? (
            <Card>
              <Spinner />
            </Card>
          ) : !students.length ? (
            <Card>
              <EmptyState title="No active students found in this class" />
            </Card>
          ) : (
            <Card padded={false}>
              {/* Batch Action Toolbar */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '12px 16px',
                  background: 'var(--green-50)',
                  borderBottom: '1px solid var(--line)',
                  flexWrap: 'wrap',
                  gap: 8,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <label className="checkbox" style={{ margin: 0 }}>
                    <input
                      type="checkbox"
                      checked={
                        selectedStudentIds.size > 0 &&
                        selectedStudentIds.size === filteredStudents.length
                      }
                      onChange={(e) => handleSelectAll(e.target.checked)}
                    />
                    <strong>Select All ({selectedStudentIds.size}/{filteredStudents.length})</strong>
                  </label>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Select
                    label=""
                    value={targetClassId}
                    onChange={(e) => setTargetClassId(e.target.value)}
                  >
                    <option value="">Choose Next Class...</option>
                    {classes.data
                      ?.filter((c) => c.id !== currentClassId)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {classLabel(c)}
                        </option>
                      ))}
                  </Select>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={handleBulkApplyClass}
                    disabled={!selectedStudentIds.size || !targetClassId}
                  >
                    Set Next Class for Selected
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => setConfirmModalOpen(true)}
                    disabled={!selectedStudentIds.size || !toYearId}
                  >
                    Review & Confirm ({selectedStudentIds.size})
                  </Button>
                </div>
              </div>

              <div className="filters" style={{ padding: '12px 16px 0' }}>
                <SearchBox
                  value={searchStudent}
                  onChange={setSearchStudent}
                  placeholder="Search students in this class"
                />
              </div>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: 40 }}></th>
                      <th>Student</th>
                      <th>Admission No.</th>
                      <th>Decision</th>
                      <th>Target Class</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredStudents.map((s) => {
                      const dec = decisions[s.id] ?? {
                        decision: 'promoted',
                        to_class_id: targetClassId || null,
                        notes: '',
                      };
                      return (
                        <tr key={s.id}>
                          <td>
                            <input
                              type="checkbox"
                              checked={selectedStudentIds.has(s.id)}
                              onChange={() => handleToggleStudent(s.id)}
                            />
                          </td>
                          <td>
                            <strong>{s.last_name}, {s.first_name}</strong>
                          </td>
                          <td className="mono">{s.admission_number}</td>
                          <td>
                            <Select
                              label=""
                              value={dec.decision}
                              onChange={(e) =>
                                setDecisions({
                                  ...decisions,
                                  [s.id]: {
                                    ...dec,
                                    decision: e.target.value as PromotionDecision,
                                    to_class_id:
                                      e.target.value === 'repeated'
                                        ? currentClassId
                                        : e.target.value === 'graduated' || e.target.value === 'withdrawn'
                                        ? null
                                        : dec.to_class_id,
                                  },
                                })
                              }
                            >
                              <option value="promoted">Promote</option>
                              <option value="promoted_on_probation">Promote (Probation)</option>
                              <option value="repeated">Repeat Class</option>
                              <option value="graduated">Graduate</option>
                              <option value="withdrawn">Withdraw</option>
                            </Select>
                          </td>
                          <td>
                            {dec.decision === 'repeated' ? (
                              <Badge tone="warn">Repeats: {classLabel(classes.data?.find((c) => c.id === currentClassId))}</Badge>
                            ) : dec.decision === 'graduated' ? (
                              <Badge tone="good">Graduating</Badge>
                            ) : dec.decision === 'withdrawn' ? (
                              <Badge tone="danger">Withdrawn</Badge>
                            ) : (
                              <Select
                                label=""
                                value={dec.to_class_id ?? ''}
                                onChange={(e) =>
                                  setDecisions({
                                    ...decisions,
                                    [s.id]: {
                                      ...dec,
                                      to_class_id: e.target.value || null,
                                    },
                                  })
                                }
                              >
                                <option value="">Select Class</option>
                                {classes.data?.map((c) => (
                                  <option key={c.id} value={c.id}>
                                    {classLabel(c)}
                                  </option>
                                ))}
                              </Select>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Confirm Promotion Modal */}
          {confirmModalOpen && (
            <Modal
              open
              title="Confirm Student Promotion"
              onClose={() => setConfirmModalOpen(false)}
              footer={
                <>
                  <Button variant="secondary" onClick={() => setConfirmModalOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    onClick={() => promoteMutation.mutate()}
                    loading={promoteMutation.isPending}
                  >
                    Confirm & Execute Promotion
                  </Button>
                </>
              }
            >
              <Alert tone="info">
                You are about to promote <strong>{selectedStudentIds.size} student(s)</strong> from Academic Year{' '}
                <strong>{academicYears.find((y) => y.id === activeFromYearId)?.name}</strong> to{' '}
                <strong>{academicYears.find((y) => y.id === toYearId)?.name}</strong>.
              </Alert>
              <p style={{ marginTop: 12, fontSize: '0.9rem' }}>
                Each student's new current class will be updated atomically. All historical enrollment, terminal report, attendance, and fee records remain preserved and queryable by their respective academic year.
              </p>
            </Modal>
          )}
        </>
      )}

      {activeTab === 'history' && (
        <Card padded={false}>
          <div className="filters" style={{ padding: '12px 16px 0' }}>
            <Select
              label="Academic Year"
              value={activeFromYearId}
              onChange={(e) => setFromYearId(e.target.value)}
            >
              {academicYears.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.name}
                </option>
              ))}
            </Select>
          </div>

          {historyQuery.isLoading ? (
            <Spinner />
          ) : !historyQuery.data?.length ? (
            <EmptyState title="No promotion history recorded for this academic year" />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Admission No</th>
                    <th>Decision</th>
                    <th>From Class</th>
                    <th>To Class</th>
                    <th>Promoted Date</th>
                  </tr>
                </thead>
                <tbody>
                  {historyQuery.data.map((h) => (
                    <tr key={h.id}>
                      <td><strong>{h.students?.last_name}, {h.students?.first_name}</strong></td>
                      <td className="mono">{h.students?.admission_number}</td>
                      <td>
                        <Badge
                          tone={
                            h.decision === 'promoted' || h.decision === 'graduated'
                              ? 'good'
                              : h.decision === 'repeated'
                              ? 'warn'
                              : 'neutral'
                          }
                        >
                          {h.decision.replace(/_/g, ' ')}
                        </Badge>
                      </td>
                      <td>{h.from_classes?.name} {h.from_classes?.section ?? ''}</td>
                      <td>{h.to_classes ? `${h.to_classes.name} ${h.to_classes.section ?? ''}` : '—'}</td>
                      <td className="small muted">{formatDate(h.promoted_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </>
  );
}
