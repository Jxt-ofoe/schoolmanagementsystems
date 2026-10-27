import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { semesterLabel, unwrap, useClasses, useSemesters } from '../../lib/queries';
import { classLabel, formatDate, formatMoney, humanize, todayISO } from '../../lib/format';
import { computeFeeSummary, generateReceiptNumber } from '../../lib/fees';
import { friendlyError } from '../../lib/errors';
import { downloadCsv } from '../../lib/csv';
import { useToast } from '../../lib/toast';
import type {
  FeeCategory,
  FeePaymentMethod,
  FeeStructure,
  Student,
  StudentFeeCharge,
  StudentFeePayment,
} from '../../lib/types';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBox,
  Input,
  Modal,
  PageHeader,
  SearchBox,
  Select,
  Spinner,
  StatCard,
  Tabs,
  Textarea,
} from '../../components/ui';

export default function SchoolFeesPage() {
  const [params, setParams] = useSearchParams();
  const { active, ctx } = useAuth();
  const isSuperAdmin = !!ctx?.is_super_admin;

  const allSchools = useQuery({
    queryKey: ['admin_all_schools_fee_dropdown'],
    enabled: isSuperAdmin,
    queryFn: () =>
      unwrap<{ id: string; name: string; code: string }[]>(
        supabase.from('schools').select('id, name, code').eq('status', 'active').order('name')
      ),
  });

  const urlSchoolId = params.get('schoolId');
  const effectiveSchoolId =
    urlSchoolId ||
    active?.school_id ||
    (isSuperAdmin ? (allSchools.data?.[0]?.id || '') : '');

  const currentSchool = allSchools.data?.find((s) => s.id === effectiveSchoolId);
  const effectiveSchoolName = currentSchool?.name || active?.school_name || 'School Management';
  const effectiveSchoolCode = currentSchool?.code || 'FEE';

  const qc = useQueryClient();
  const toast = useToast();
  const semesters = useSemesters(effectiveSchoolId);
  const classes = useClasses(effectiveSchoolId);

  const [activeTab, setActiveTab] = useState<'overview' | 'structures' | 'assign' | 'payments' | 'history'>('overview');
  const [semesterId, setSemesterId] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [searchStudent, setSearchStudent] = useState('');
  const [applyingStructureId, setApplyingStructureId] = useState<string | null>(null);

  // Modals
  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [structureModalOpen, setStructureModalOpen] = useState(false);
  const [paymentModalStudent, setPaymentModalStudent] = useState<Student | null>(null);
  const [statementStudent, setStatementStudent] = useState<Student | null>(null);
  const [receiptToPrint, setReceiptToPrint] = useState<StudentFeePayment & { student_name?: string; admission_number?: string } | null>(null);
  const [reversingPayment, setReversingPayment] = useState<StudentFeePayment | null>(null);

  const activeSemester =
    semesters.data?.find((s) => s.id === semesterId) ??
    semesters.data?.find((s) => s.is_current) ??
    semesters.data?.[0];

  // Fee categories
  const categoriesQuery = useQuery({
    queryKey: ['fee_categories', effectiveSchoolId],
    enabled: !!effectiveSchoolId,
    queryFn: () =>
      unwrap<FeeCategory[]>(
        supabase.from('fee_categories').select('*').eq('school_id', effectiveSchoolId).order('name')
      ),
  });

  // Fee structures (configured fees for current semester)
  const structuresQuery = useQuery({
    queryKey: ['fee_structures', effectiveSchoolId, activeSemester?.id],
    enabled: !!effectiveSchoolId && !!activeSemester?.id,
    queryFn: () =>
      unwrap<(FeeStructure & { fee_categories: { name: string } | null; classes: { name: string; section: string | null } | null })[]>(
        supabase
          .from('fee_structures')
          .select('*, fee_categories(name), classes(name, section)')
          .eq('school_id', effectiveSchoolId)
          .eq('semester_id', activeSemester!.id)
          .order('name')
      ),
  });

  // All active students
  const studentsQuery = useQuery({
    queryKey: ['fee_students', effectiveSchoolId, classFilter],
    enabled: !!effectiveSchoolId,
    queryFn: async () => {
      let q = supabase
        .from('students')
        .select('id, admission_number, first_name, last_name, current_class_id, enrollment_status')
        .eq('school_id', effectiveSchoolId)
        .eq('enrollment_status', 'active')
        .order('last_name')
        .order('first_name');
      if (classFilter) q = q.eq('current_class_id', classFilter);
      return unwrap<Student[]>(q);
    },
  });

  // Charges for this semester
  const chargesQuery = useQuery({
    queryKey: ['student_fee_charges', effectiveSchoolId, activeSemester?.id],
    enabled: !!effectiveSchoolId && !!activeSemester?.id,
    queryFn: () =>
      unwrap<StudentFeeCharge[]>(
        supabase
          .from('student_fee_charges')
          .select('*, fee_categories(name)')
          .eq('school_id', effectiveSchoolId)
          .eq('semester_id', activeSemester!.id)
      ),
  });

  // Payments for this semester
  const paymentsQuery = useQuery({
    queryKey: ['student_fee_payments', effectiveSchoolId, activeSemester?.id],
    enabled: !!effectiveSchoolId && !!activeSemester?.id,
    queryFn: () =>
      unwrap<(StudentFeePayment & { students: { first_name: string; last_name: string; admission_number: string } | null })[]>(
        supabase
          .from('student_fee_payments')
          .select('*, students(first_name, last_name, admission_number)')
          .eq('school_id', effectiveSchoolId)
          .eq('semester_id', activeSemester!.id)
          .order('paid_on', { ascending: false })
          .order('created_at', { ascending: false })
      ),
  });

  const charges = chargesQuery.data ?? [];
  const payments = paymentsQuery.data ?? [];
  const overallSummary = computeFeeSummary(charges, payments);

  const studentsList = studentsQuery.data ?? [];
  const studentRows = studentsList
    .map((stu) => {
      const stuCharges = charges.filter((c) => c.student_id === stu.id);
      const stuPayments = payments.filter((p) => p.student_id === stu.id);
      const sum = computeFeeSummary(stuCharges, stuPayments);
      const cls = classes.data?.find((c) => c.id === stu.current_class_id);
      return {
        ...stu,
        className: classLabel(cls),
        ...sum,
      };
    })
    .filter(
      (s) =>
        !searchStudent ||
        `${s.first_name} ${s.last_name} ${s.admission_number}`.toLowerCase().includes(searchStudent.toLowerCase())
    );

  const reversePaymentMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { error } = await supabase
        .from('student_fee_payments')
        .update({
          status: 'reversed',
          reversal_reason: reason,
          reversed_at: new Date().toISOString(),
          reversed_by: (await supabase.auth.getUser()).data.user?.id,
        })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast('Payment successfully reversed');
      setReversingPayment(null);
      qc.invalidateQueries({ queryKey: ['student_fee_payments'] });
      qc.invalidateQueries({ queryKey: ['student_fee_statement'] });
    },
    onError: (err) => {
      toast(friendlyError(err), 'error');
    },
  });

  const applyFeeMutation = useMutation({
    mutationFn: async (st: FeeStructure) => {
      setApplyingStructureId(st.id);
      // Query all active students in the target class or entire school
      let q = supabase
        .from('students')
        .select('id')
        .eq('school_id', effectiveSchoolId)
        .eq('enrollment_status', 'active');
      if (st.class_id) {
        q = q.eq('current_class_id', st.class_id);
      }
      const stuList = await unwrap<{ id: string }[]>(q);
      if (!stuList.length) throw new Error('No active students found to apply this fee to.');

      // Check which students already have this fee structure charged this semester
      const { data: existingCharges } = await supabase
        .from('student_fee_charges')
        .select('student_id')
        .eq('fee_structure_id', st.id)
        .eq('semester_id', activeSemester!.id);

      const existingSet = new Set((existingCharges ?? []).map((c) => c.student_id));
      const neededStudents = stuList.filter((s) => !existingSet.has(s.id));

      if (!neededStudents.length) {
        throw new Error('All eligible students have already been charged this fee.');
      }

      const chargesPayload = neededStudents.map((stu) => ({
        school_id: effectiveSchoolId,
        student_id: stu.id,
        semester_id: activeSemester!.id,
        fee_structure_id: st.id,
        category_id: st.category_id,
        title: st.name,
        amount: Number(st.amount),
        due_date: st.due_date || null,
      }));

      for (let i = 0; i < chargesPayload.length; i += 250) {
        const chunk = chargesPayload.slice(i, i + 250);
        const { error } = await supabase.from('student_fee_charges').insert(chunk);
        if (error) throw error;
      }
      return neededStudents.length;
    },
    onSuccess: (count) => {
      toast(`Successfully billed ${count} student${count === 1 ? '' : 's'}!`);
      setApplyingStructureId(null);
      qc.invalidateQueries({ queryKey: ['student_fee_charges'] });
    },
    onError: (err) => {
      setApplyingStructureId(null);
      toast(friendlyError(err), 'error');
    },
  });

  return (
    <>
      <PageHeader
        title={`School Fees & Payments · ${effectiveSchoolName}`}
        subtitle={`Track fee configurations, student account balances, and recorded receipts · ${semesterLabel(activeSemester)}`}
        actions={
          <div className="page-actions">
            <Button size="sm" variant="secondary" onClick={() => setCategoryModalOpen(true)}>
              + Fee Category
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setStructureModalOpen(true)}>
              + Configure Fee
            </Button>
            <Button
              size="sm"
              onClick={() =>
                downloadCsv(
                  `fee-report-${activeSemester?.name ?? ''}.csv`,
                  studentRows.map((s) => ({
                    'Admission No': s.admission_number,
                    'Student Name': `${s.last_name}, ${s.first_name}`,
                    Class: s.className,
                    'Total Charged': s.totalCharged,
                    'Scholarship / Discount': s.totalDiscounted,
                    'Net Due': s.netCharged,
                    'Total Paid': s.totalPaid,
                    Balance: s.balance,
                  }))
                )
              }
            >
              Export Report
            </Button>
          </div>
        }
      />

      <div className="filters">
        {isSuperAdmin && (
          <Select
            label="School"
            value={effectiveSchoolId}
            onChange={(e) => {
              const newId = e.target.value;
              setParams((prev) => {
                const next = new URLSearchParams(prev);
                next.set('schoolId', newId);
                return next;
              });
            }}
          >
            {allSchools.data?.map((sch) => (
              <option key={sch.id} value={sch.id}>
                {sch.name} ({sch.code})
              </option>
            ))}
          </Select>
        )}
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
          label="Filter Class"
          value={classFilter}
          onChange={(e) => setClassFilter(e.target.value)}
        >
          <option value="">All Classes</option>
          {classes.data?.map((c) => (
            <option key={c.id} value={c.id}>
              {classLabel(c)}
            </option>
          ))}
        </Select>
      </div>

      <div className="stats">
        <StatCard label="Total Fees Charged" value={formatMoney(overallSummary.totalCharged)} />
        <StatCard label="Discounts & Scholarships" value={formatMoney(overallSummary.totalDiscounted)} />
        <StatCard label="Total Payments Collected" value={formatMoney(overallSummary.totalPaid)} tone="good" />
        <StatCard
          label="Outstanding Balance"
          value={formatMoney(overallSummary.balance)}
          tone={overallSummary.balance > 0 ? 'warn' : 'good'}
        />
      </div>

      <Tabs
        tabs={[
          { id: 'overview', label: 'Student Balances' },
          { id: 'structures', label: 'Fee Structures' },
          { id: 'history', label: 'Payment Receipts' },
        ]}
        value={activeTab}
        onChange={setActiveTab}
      />

      {activeTab === 'overview' && (
        <Card padded={false}>
          <div className="filters" style={{ padding: '12px 16px 0' }}>
            <SearchBox
              value={searchStudent}
              onChange={setSearchStudent}
              placeholder="Search by student name or admission number"
            />
          </div>
          {studentsQuery.isLoading ? (
            <Spinner />
          ) : !studentRows.length ? (
            <EmptyState title="No students found" />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Class</th>
                    <th className="right">Charged</th>
                    <th className="right">Discount</th>
                    <th className="right">Net Due</th>
                    <th className="right">Paid</th>
                    <th className="right">Balance</th>
                    <th className="right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {studentRows.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <strong>{s.last_name}, {s.first_name}</strong>
                        <div className="mono muted small">{s.admission_number}</div>
                      </td>
                      <td>{s.className}</td>
                      <td className="right">{formatMoney(s.totalCharged)}</td>
                      <td className="right">{formatMoney(s.totalDiscounted)}</td>
                      <td className="right">
                        <strong>{formatMoney(s.netCharged)}</strong>
                      </td>
                      <td className="right" style={{ color: 'var(--green-700)' }}>
                        {formatMoney(s.totalPaid)}
                      </td>
                      <td className="right">
                        <strong style={{ color: s.balance > 0 ? 'var(--red)' : 'var(--green-700)' }}>
                          {formatMoney(s.balance)}
                        </strong>
                      </td>
                      <td className="right">
                        <div className="table-actions">
                          <Button size="sm" onClick={() => setPaymentModalStudent(s)}>
                            + Payment
                          </Button>
                          <Button size="sm" variant="secondary" onClick={() => setStatementStudent(s)}>
                            Statement
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
      )}

      {activeTab === 'structures' && (
        <Card padded={false}>
          {structuresQuery.isLoading ? (
            <Spinner />
          ) : !structuresQuery.data?.length ? (
            <EmptyState
              title="No fee structures set up for this semester"
              action={
                <Button onClick={() => setStructureModalOpen(true)}>
                  Configure fee items
                </Button>
              }
            >
              Configure tuition, PTA, library, or sports fees to assign them to students.
            </EmptyState>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Fee Name</th>
                    <th>Category</th>
                    <th>Applies To</th>
                    <th className="right">Amount</th>
                    <th>Due Date</th>
                    <th className="right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {structuresQuery.data.map((st) => (
                    <tr key={st.id}>
                      <td><strong>{st.name}</strong></td>
                      <td><Badge tone="neutral">{st.fee_categories?.name ?? 'General'}</Badge></td>
                      <td>{st.classes ? `${st.classes.name} ${st.classes.section ?? ''}` : 'All Classes'}</td>
                      <td className="right"><strong>{formatMoney(st.amount)}</strong></td>
                      <td className="small muted">{st.due_date ? formatDate(st.due_date) : 'Semester Start'}</td>
                      <td className="right">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => applyFeeMutation.mutate(st)}
                          loading={applyFeeMutation.isPending && applyingStructureId === st.id}
                        >
                          Charge to Students
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {activeTab === 'history' && (
        <Card padded={false}>
          {paymentsQuery.isLoading ? (
            <Spinner />
          ) : !paymentsQuery.data?.length ? (
            <EmptyState title="No payments recorded for this semester yet" />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Receipt No.</th>
                    <th>Student</th>
                    <th>Date</th>
                    <th>Method</th>
                    <th>Reference</th>
                    <th className="right">Amount</th>
                    <th>Status</th>
                    <th className="right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {paymentsQuery.data.map((p) => (
                    <tr key={p.id}>
                      <td className="mono">
                        <strong>{p.receipt_number}</strong>
                      </td>
                      <td>
                        {p.students?.last_name}, {p.students?.first_name}
                        <div className="mono muted small">{p.students?.admission_number}</div>
                      </td>
                      <td className="small">{formatDate(p.paid_on)}</td>
                      <td><Badge tone="neutral">{humanize(p.method)}</Badge></td>
                      <td className="mono small">{p.reference || '—'}</td>
                      <td className="right">
                        <strong>{formatMoney(p.amount)}</strong>
                      </td>
                      <td>
                        <Badge tone={p.status === 'valid' ? 'good' : 'danger'}>
                          {p.status}
                        </Badge>
                      </td>
                      <td className="right">
                        <div className="table-actions">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() =>
                              setReceiptToPrint({
                                ...p,
                                student_name: `${p.students?.first_name} ${p.students?.last_name}`,
                                admission_number: p.students?.admission_number,
                              })
                            }
                          >
                            Print Receipt
                          </Button>
                          {p.status === 'valid' && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setReversingPayment(p)}
                            >
                              Reverse
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* Record Payment Modal */}
      {paymentModalStudent && activeSemester && (
        <RecordPaymentModal
          student={paymentModalStudent}
          semesterId={activeSemester.id}
          schoolCode={effectiveSchoolCode}
          schoolId={effectiveSchoolId}
          onClose={() => setPaymentModalStudent(null)}
          onSuccess={(payment) => {
            setPaymentModalStudent(null);
            setReceiptToPrint(payment);
          }}
        />
      )}

      {/* Statement Modal */}
      {statementStudent && activeSemester && (
        <StudentStatementModal
          student={statementStudent}
          semesterId={activeSemester.id}
          schoolName={effectiveSchoolName}
          onClose={() => setStatementStudent(null)}
        />
      )}

      {/* Create Category Modal */}
      {categoryModalOpen && (
        <CategoryModal schoolId={effectiveSchoolId} onClose={() => setCategoryModalOpen(false)} />
      )}

      {/* Create Structure Modal */}
      {structureModalOpen && activeSemester && (
        <StructureModal
          schoolId={effectiveSchoolId}
          semesterId={activeSemester.id}
          categories={categoriesQuery.data ?? []}
          classes={classes.data ?? []}
          onClose={() => setStructureModalOpen(false)}
        />
      )}

      {/* Reverse Payment Dialog */}
      {reversingPayment && (
        <ReversePaymentModal
          payment={reversingPayment}
          onClose={() => setReversingPayment(null)}
          onConfirm={(reason) =>
            reversePaymentMutation.mutate({ id: reversingPayment.id, reason })
          }
          loading={reversePaymentMutation.isPending}
        />
      )}

      {/* Printable Receipt Modal */}
      {receiptToPrint && (
        <PrintReceiptModal
          payment={receiptToPrint}
          schoolName={effectiveSchoolName}
          onClose={() => setReceiptToPrint(null)}
        />
      )}
    </>
  );
}

function RecordPaymentModal({
  student,
  semesterId,
  schoolCode,
  schoolId,
  onClose,
  onSuccess,
}: {
  student: Student;
  semesterId: string;
  schoolCode: string;
  schoolId: string;
  onClose: () => void;
  onSuccess: (payment: StudentFeePayment & { student_name: string; admission_number: string }) => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();

  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<FeePaymentMethod>('cash');
  const [reference, setReference] = useState('');
  const [paidOn, setPaidOn] = useState(todayISO());
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const receiptNumber = generateReceiptNumber(schoolCode || 'FEE');

  const saveMutation = useMutation({
    mutationFn: async () => {
      setError(null);
      const val = parseFloat(amount);
      if (isNaN(val) || val <= 0) throw new Error('Enter a valid payment amount');

      const payload = {
        school_id: schoolId,
        student_id: student.id,
        semester_id: semesterId,
        receipt_number: receiptNumber,
        amount: val,
        method,
        reference: reference.trim() || null,
        paid_on: paidOn,
        notes: notes.trim() || null,
        status: 'valid' as const,
      };

      const { data, error: err } = await supabase
        .from('student_fee_payments')
        .insert([payload])
        .select()
        .single();
      if (err) throw err;
      return data;
    },
    onSuccess: (data) => {
      toast('Payment successfully recorded!');
      qc.invalidateQueries({ queryKey: ['student_fee_payments'] });
      qc.invalidateQueries({ queryKey: ['student_fee_charges'] });
      onSuccess({
        ...data,
        student_name: `${student.first_name} ${student.last_name}`,
        admission_number: student.admission_number,
      });
    },
    onError: (err) => setError(friendlyError(err)),
  });

  return (
    <Modal
      open
      title={`Record Fee Payment · ${student.first_name} ${student.last_name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => saveMutation.mutate()} loading={saveMutation.isPending}>
            Confirm Payment
          </Button>
        </>
      }
    >
      <ErrorBox error={error} />
      <div className="form-grid">
        <Input
          label="Payment Amount (GH₵)"
          type="number"
          step="0.01"
          min={0.01}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          required
        />
        <Select label="Payment Method" value={method} onChange={(e) => setMethod(e.target.value as any)}>
          <option value="cash">Cash</option>
          <option value="mobile_money">Mobile Money (MTN / Telecel / AT)</option>
          <option value="bank_transfer">Bank Transfer / Deposit</option>
          <option value="cheque">Cheque</option>
          <option value="other">Other</option>
        </Select>
        <Input
          label="Transaction Reference / Receipt No"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder="e.g. MoMo Trx ID or Bank Slip No"
        />
        <Input
          label="Date Received"
          type="date"
          value={paidOn}
          max={todayISO()}
          onChange={(e) => setPaidOn(e.target.value)}
        />
      </div>
      <Textarea
        label="Payment Notes"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Optional notes or remarks..."
        rows={2}
      />
    </Modal>
  );
}

function CategoryModal({ schoolId, onClose }: { schoolId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [error, setError] = useState<string | null>(null);

  const m = useMutation({
    mutationFn: async () => {
      setError(null);
      if (!name.trim()) throw new Error('Category name is required');
      const { error } = await supabase.from('fee_categories').insert([
        { school_id: schoolId, name: name.trim(), description: desc.trim() || null },
      ]);
      if (error) throw error;
    },
    onSuccess: () => {
      toast('Fee category added');
      qc.invalidateQueries({ queryKey: ['fee_categories'] });
      onClose();
    },
    onError: (err) => setError(friendlyError(err)),
  });

  return (
    <Modal
      open
      title="Create Fee Category"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => m.mutate()} loading={m.isPending}>Create Category</Button>
        </>
      }
    >
      <ErrorBox error={error} />
      <Input label="Category Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Tuition, PTA, Exam Fee, Sports" required />
      <Textarea label="Description" value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} />
    </Modal>
  );
}

function StructureModal({
  schoolId,
  semesterId,
  categories,
  classes,
  onClose,
}: {
  schoolId: string;
  semesterId: string;
  categories: FeeCategory[];
  classes: { id: string; name: string; section: string | null }[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState(categories[0]?.id || '');
  const [classId, setClassId] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);

  const m = useMutation({
    mutationFn: async () => {
      setError(null);
      const val = parseFloat(amount);
      if (!name.trim() || isNaN(val) || val <= 0) {
        throw new Error('Valid name and amount are required');
      }

      // Fetch semester academic year
      const { data: sem } = await supabase.from('semesters').select('academic_year_id').eq('id', semesterId).single();

      const { error } = await supabase.from('fee_structures').insert([
        {
          school_id: schoolId,
          academic_year_id: sem!.academic_year_id,
          semester_id: semesterId,
          class_id: classId || null,
          category_id: categoryId,
          name: name.trim(),
          amount: val,
        },
      ]);
      if (error) throw error;
    },
    onSuccess: () => {
      toast('Fee structure created');
      qc.invalidateQueries({ queryKey: ['fee_structures'] });
      onClose();
    },
    onError: (err) => setError(friendlyError(err)),
  });

  return (
    <Modal
      open
      title="Configure Fee Item"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => m.mutate()} loading={m.isPending}>Save Fee</Button>
        </>
      }
    >
      <ErrorBox error={error} />
      <div className="form-grid">
        <Input label="Fee Title" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Term 1 Tuition Fee" required />
        <Input label="Amount (GH₵)" type="number" step="0.01" min={0.01} value={amount} onChange={(e) => setAmount(e.target.value)} required />
        <Select label="Category" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Select label="Target Class" value={classId} onChange={(e) => setClassId(e.target.value)}>
          <option value="">All Classes (Whole School)</option>
          {classes.map((c) => <option key={c.id} value={c.id}>{c.name} {c.section ?? ''}</option>)}
        </Select>
      </div>
    </Modal>
  );
}

function ReversePaymentModal({
  payment,
  onClose,
  onConfirm,
  loading,
}: {
  payment: StudentFeePayment;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  loading: boolean;
}) {
  const [reason, setReason] = useState('');
  return (
    <Modal
      open
      title={`Reverse Payment: ${payment.receipt_number}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="secondary" onClick={() => onConfirm(reason)} loading={loading} disabled={!reason.trim()}>
            Confirm Reversal
          </Button>
        </>
      }
    >
      <Alert tone="warn">
        Reversing a payment will mark it as void, restore the student balance, and preserve the transaction in the audit log.
      </Alert>
      <div style={{ marginTop: 12 }}>
        <Textarea
          label="Reversal Reason (Required)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="State the reason for this reversal (e.g. Incorrect amount recorded, duplicate entry, bounced cheque)..."
          required
        />
      </div>
    </Modal>
  );
}

function PrintReceiptModal({
  payment,
  schoolName,
  onClose,
}: {
  payment: StudentFeePayment & { student_name?: string; admission_number?: string };
  schoolName: string;
  onClose: () => void;
}) {
  return (
    <Modal
      open
      title="Official Payment Receipt"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button onClick={() => window.print()}>🖨️ Print Receipt</Button>
        </>
      }
    >
      <div className="printable-receipt" style={{ padding: 16, border: '1px solid var(--line)', borderRadius: 8, background: '#fff' }}>
        <div style={{ textAlign: 'center', borderBottom: '2px solid var(--green-800)', paddingBottom: 8, marginBottom: 12 }}>
          <h3 style={{ textTransform: 'uppercase', color: 'var(--green-900)', margin: 0 }}>{schoolName}</h3>
          <div style={{ fontSize: '0.8rem', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Official Fee Receipt
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '6px 16px', fontSize: '0.88rem', marginBottom: 12 }}>
          <div><strong>Receipt No:</strong> <span className="mono">{payment.receipt_number}</span></div>
          <div><strong>Date:</strong> {formatDate(payment.paid_on)}</div>
          <div><strong>Student:</strong> {payment.student_name}</div>
          <div><strong>Admission No:</strong> <span className="mono">{payment.admission_number}</span></div>
          <div><strong>Payment Method:</strong> {humanize(payment.method)}</div>
          <div><strong>Reference:</strong> <span className="mono">{payment.reference || '—'}</span></div>
        </div>

        <div style={{ background: 'var(--green-50)', padding: 12, borderRadius: 6, textAlign: 'center', margin: '16px 0' }}>
          <div className="small muted">AMOUNT PAID</div>
          <div style={{ fontSize: '1.6rem', fontWeight: 700, color: 'var(--green-900)' }}>
            {formatMoney(payment.amount)}
          </div>
        </div>

        {payment.notes && (
          <div style={{ fontSize: '0.82rem', color: 'var(--ink-2)', marginBottom: 12 }}>
            <strong>Notes:</strong> {payment.notes}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 24, paddingTop: 12, borderTop: '1px dashed var(--line)' }}>
          <div style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>Status: VALID TRANSACTION</div>
          <div style={{ textAlign: 'center', width: 140 }}>
            <div style={{ borderBottom: '1px solid #444', height: 20, marginBottom: 4 }}></div>
            <div style={{ fontSize: '0.72rem', fontWeight: 600 }}>Accounts Officer</div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function StudentStatementModal({
  student,
  semesterId,
  schoolName,
  onClose,
}: {
  student: Student;
  semesterId: string;
  schoolName: string;
  onClose: () => void;
}) {
  const charges = useQuery({
    queryKey: ['student_charges_stmt', student.id, semesterId],
    queryFn: () =>
      unwrap<StudentFeeCharge[]>(
        supabase.from('student_fee_charges').select('*').eq('student_id', student.id).eq('semester_id', semesterId)
      ),
  });

  const payments = useQuery({
    queryKey: ['student_payments_stmt', student.id, semesterId],
    queryFn: () =>
      unwrap<StudentFeePayment[]>(
        supabase.from('student_fee_payments').select('*').eq('student_id', student.id).eq('semester_id', semesterId)
      ),
  });

  const ch = charges.data ?? [];
  const py = payments.data ?? [];
  const sum = computeFeeSummary(ch, py);

  return (
    <Modal
      open
      title={`Fee Account Statement · ${student.first_name} ${student.last_name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button onClick={() => window.print()}>🖨️ Print Statement</Button>
        </>
      }
    >
      <div style={{ padding: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: '0.95rem', fontWeight: 600, color: 'var(--green-800)', marginBottom: 2 }}>{schoolName}</div>
            <strong>{student.first_name} {student.last_name}</strong>
            <div className="mono small muted">{student.admission_number}</div>
          </div>
          <div className="right">
            <div className="small muted">Outstanding Balance</div>
            <strong style={{ fontSize: '1.2rem', color: sum.balance > 0 ? 'var(--red)' : 'var(--green-700)' }}>
              {formatMoney(sum.balance)}
            </strong>
          </div>
        </div>

        <h4 style={{ margin: '12px 0 6px' }}>Fee Charges</h4>
        <table style={{ width: '100%', fontSize: '0.85rem', borderCollapse: 'collapse', marginBottom: 12 }}>
          <thead>
            <tr style={{ background: '#f5f5f5' }}>
              <th style={{ padding: 6, textAlign: 'left' }}>Description</th>
              <th style={{ padding: 6, textAlign: 'right' }}>Amount</th>
              <th style={{ padding: 6, textAlign: 'right' }}>Discount</th>
              <th style={{ padding: 6, textAlign: 'right' }}>Net</th>
            </tr>
          </thead>
          <tbody>
            {!ch.length ? (
              <tr><td colSpan={4} style={{ textAlign: 'center', padding: 8 }}>No charges recorded</td></tr>
            ) : (
              ch.map((c) => (
                <tr key={c.id} style={{ borderBottom: '1px solid var(--line)' }}>
                  <td style={{ padding: 6 }}>{c.description}</td>
                  <td style={{ padding: 6, textAlign: 'right' }}>{formatMoney(c.amount)}</td>
                  <td style={{ padding: 6, textAlign: 'right' }}>{formatMoney(c.discount_amount)}</td>
                  <td style={{ padding: 6, textAlign: 'right' }}><strong>{formatMoney(c.net_amount)}</strong></td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <h4 style={{ margin: '12px 0 6px' }}>Payments Received</h4>
        <table style={{ width: '100%', fontSize: '0.85rem', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f5f5f5' }}>
              <th style={{ padding: 6, textAlign: 'left' }}>Receipt</th>
              <th style={{ padding: 6, textAlign: 'left' }}>Date</th>
              <th style={{ padding: 6, textAlign: 'left' }}>Method</th>
              <th style={{ padding: 6, textAlign: 'right' }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {!py.length ? (
              <tr><td colSpan={4} style={{ textAlign: 'center', padding: 8 }}>No payments recorded</td></tr>
            ) : (
              py.map((p) => (
                <tr key={p.id} style={{ borderBottom: '1px solid var(--line)' }}>
                  <td style={{ padding: 6 }} className="mono">{p.receipt_number}</td>
                  <td style={{ padding: 6 }}>{formatDate(p.paid_on)}</td>
                  <td style={{ padding: 6 }}>{humanize(p.method)}</td>
                  <td style={{ padding: 6, textAlign: 'right', color: p.status === 'valid' ? 'var(--green-700)' : 'var(--muted)' }}>
                    <strong>{formatMoney(p.amount)}</strong> {p.status === 'reversed' && '(Reversed)'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}
