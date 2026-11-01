import { useState, useMemo, useRef } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { useClasses, useSchoolDetails, useSemesters, unwrap } from '../../lib/queries';
import { classLabel, formatDate, todayISO } from '../../lib/format';
import { useToast } from '../../lib/toast';
import { friendlyError } from '../../lib/errors';
import {
  formatWhatsAppNumber,
  createWhatsAppLink,
  generateReportCardPdf,
  downloadPdfBlob,
  executeManualWhatsAppShare,
} from '../../lib/reportPdf';
import type { Student, TerminalReport, WhatsAppReportShare } from '../../lib/types';
import {
  Button,
  Card,
  Input,
  Select,
  Textarea,
  Modal,
  Alert,
  Spinner,
  Badge,
  EmptyState,
  PageHeader,
  StatCard,
} from '../../components/ui';

export default function WhatsAppSharePage() {
  const { ctx, active } = useAuth();
  const schoolId = active?.school_id;
  const isTeacher = active?.role === 'teacher';
  const qc = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();

  const semestersQuery = useSemesters(schoolId);
  const classesQuery = useClasses(schoolId);
  const schoolQuery = useSchoolDetails(schoolId);

  const semesterId = params.get('semester') || semestersQuery.data?.find((s) => s.is_current)?.id || '';
  const classId = params.get('class') || '';

  const activeSemester = semestersQuery.data?.find((s) => s.id === semesterId);
  const selectedClass = classesQuery.data?.find((c) => c.id === classId);

  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(new Set());
  const [singleShareModalStudent, setSingleShareModalStudent] = useState<Student | null>(null);
  const [singleMessage, setSingleMessage] = useState('');
  const [singlePhone, setSinglePhone] = useState('');
  const [isProcessingSingle, setIsProcessingSingle] = useState(false);

  // Bulk Queue Wizard state
  const [bulkQueueOpen, setBulkQueueOpen] = useState(false);
  const [queueIndex, setQueueIndex] = useState(0);
  const [bulkQueueStatus, setBulkQueueStatus] = useState<Record<string, 'pending' | 'pdf_generated' | 'whatsapp_opened' | 'marked_as_sent'>>({});
  const [bulkMessageText, setBulkMessageText] = useState('');

  // Hidden container ref for off-screen canvas rendering
  const reportCardRef = useRef<HTMLDivElement>(null);
  const [activeRenderStudentId, setActiveRenderStudentId] = useState<string | null>(null);

  // 1. Fetch Students in class
  const studentsQuery = useQuery({
    queryKey: ['class_students_whatsapp', classId],
    enabled: !!classId,
    queryFn: () =>
      unwrap<Student[]>(
        supabase
          .from('students')
          .select('*')
          .eq('current_class_id', classId)
          .eq('enrollment_status', 'active')
          .order('last_name')
          .order('first_name')
      ),
  });

  // 2. Fetch Existing Terminal Reports for this semester & class
  const terminalReportsQuery = useQuery({
    queryKey: ['terminal_reports_whatsapp', classId, semesterId],
    enabled: !!classId && !!semesterId,
    queryFn: async () => {
      const { data } = await supabase
        .from('terminal_reports')
        .select('*')
        .eq('school_id', schoolId!)
        .eq('class_id', classId)
        .eq('semester_id', semesterId);
      return (data ?? []) as TerminalReport[];
    },
  });

  // 3. Fetch Existing WhatsApp Share Records
  const sharesQuery = useQuery({
    queryKey: ['whatsapp_report_shares', classId, semesterId],
    enabled: !!classId && !!semesterId,
    queryFn: async () => {
      const { data } = await supabase
        .from('whatsapp_report_shares')
        .select('*')
        .eq('school_id', schoolId!)
        .eq('class_id', classId)
        .eq('semester_id', semesterId);
      return (data ?? []) as WhatsAppReportShare[];
    },
  });

  const students = studentsQuery.data ?? [];
  const reports = terminalReportsQuery.data ?? [];
  const shares = sharesQuery.data ?? [];

  // Map shares by student_id
  const sharesByStudentId = useMemo(() => {
    const map = new Map<string, WhatsAppReportShare>();
    for (const sh of shares) {
      map.set(sh.student_id, sh);
    }
    return map;
  }, [shares]);

  // Map terminal reports by student_id
  const reportsByStudentId = useMemo(() => {
    const map = new Map<string, TerminalReport>();
    for (const rep of reports) {
      map.set(rep.student_id, rep);
    }
    return map;
  }, [reports]);

  // Statistics
  const stats = useMemo(() => {
    let readyCount = 0;
    let openedCount = 0;
    let sentCount = 0;
    for (const s of students) {
      const rep = reportsByStudentId.get(s.id);
      if (rep && rep.status === 'published') readyCount++;
      const sh = sharesByStudentId.get(s.id);
      if (sh?.status === 'whatsapp_opened') openedCount++;
      if (sh?.status === 'marked_as_sent') sentCount++;
    }
    return {
      total: students.length,
      ready: readyCount,
      opened: openedCount,
      sent: sentCount,
    };
  }, [students, reportsByStudentId, sharesByStudentId]);

  // Toggle single student in bulk selection
  const handleToggleStudent = (id: string) => {
    setSelectedStudentIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Select all eligible
  const handleSelectAll = () => {
    if (selectedStudentIds.size === students.length) {
      setSelectedStudentIds(new Set());
    } else {
      setSelectedStudentIds(new Set(students.map((s) => s.id)));
    }
  };

  // Upsert share record in database
  const upsertShareMutation = useMutation({
    mutationFn: async ({
      studentId,
      terminalReportId,
      parentName,
      parentPhone,
      message,
      status,
      notes,
    }: {
      studentId: string;
      terminalReportId?: string;
      parentName: string;
      parentPhone: string;
      message?: string;
      status: 'pdf_generated' | 'whatsapp_opened' | 'marked_as_sent';
      notes?: string;
    }) => {
      const payload = {
        school_id: schoolId,
        student_id: studentId,
        terminal_report_id: terminalReportId || null,
        semester_id: semesterId,
        class_id: classId,
        parent_name: parentName,
        parent_phone: parentPhone,
        message: message || null,
        status,
        notes: notes || null,
        shared_by: ctx?.user_id || null,
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from('whatsapp_report_shares')
        .upsert(payload, { onConflict: 'student_id, semester_id, class_id' })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['whatsapp_report_shares', classId, semesterId] });
      qc.invalidateQueries({ queryKey: ['message_history', schoolId] });
    },
    onError: (err) => {
      toast(friendlyError(err), 'error');
    },
  });

  // Open single share modal
  const handleOpenSingleModal = (student: Student) => {
    setSingleShareModalStudent(student);
    setActiveRenderStudentId(student.id);
    const cleanPhone = formatWhatsAppNumber(student.guardian_phone) || student.guardian_phone || '';
    setSinglePhone(cleanPhone);
    const schoolName = schoolQuery.data?.name || 'School';
    const studentFullName = `${student.first_name} ${student.last_name}`;
    const defaultMsg = `Dear ${student.guardian_name || 'Parent'}, the examination report card for ${studentFullName} (${classLabel(selectedClass)}) is ready. Please find the attached official terminal report card. Thank you. — ${schoolName}`;
    setSingleMessage(defaultMsg);
  };

  // Execute single manual share
  const handleExecuteSingleShare = async () => {
    if (!singleShareModalStudent || !reportCardRef.current) return;
    setIsProcessingSingle(true);
    const student = singleShareModalStudent;
    const rep = reportsByStudentId.get(student.id);
    const schoolName = schoolQuery.data?.name || 'School';
    const studentFullName = `${student.first_name} ${student.last_name}`;

    try {
      // 1. Generate & download PDF & open WhatsApp
      await executeManualWhatsAppShare({
        element: reportCardRef.current,
        parentPhone: singlePhone,
        studentName: studentFullName,
        schoolName,
        customMessage: singleMessage,
      });

      // 2. Record share status as whatsapp_opened
      await upsertShareMutation.mutateAsync({
        studentId: student.id,
        terminalReportId: rep?.id,
        parentName: student.guardian_name || 'Parent/Guardian',
        parentPhone: singlePhone,
        message: singleMessage,
        status: 'whatsapp_opened',
        notes: 'WhatsApp launched via single share modal',
      });

      toast(`WhatsApp opened for ${studentFullName}'s parent! Attach the downloaded PDF and click Send.`);
    } catch (err: any) {
      toast(`Sharing issue: ${err.message || 'Could not complete sharing'}`, 'error');
    } finally {
      setIsProcessingSingle(false);
    }
  };

  // Mark single student as manually sent
  const handleMarkAsSent = async (student: Student) => {
    const rep = reportsByStudentId.get(student.id);
    await upsertShareMutation.mutateAsync({
      studentId: student.id,
      terminalReportId: rep?.id,
      parentName: student.guardian_name || 'Parent/Guardian',
      parentPhone: student.guardian_phone || 'N/A',
      status: 'marked_as_sent',
      notes: 'Manually marked as sent by teacher',
    });
    toast(`Marked as sent for ${student.first_name} ${student.last_name}!`);
  };

  // BULK QUEUE WIZARD
  const bulkSelectedStudents = useMemo(() => {
    return students.filter((s) => selectedStudentIds.has(s.id));
  }, [students, selectedStudentIds]);

  const handleStartBulkQueue = () => {
    if (bulkSelectedStudents.length === 0) {
      toast('Please select at least one student for bulk WhatsApp sharing.', 'error');
      return;
    }
    setQueueIndex(0);
    const firstStu = bulkSelectedStudents[0];
    setActiveRenderStudentId(firstStu.id);
    const schoolName = schoolQuery.data?.name || 'School';
    const defaultMsg = `Dear ${firstStu.guardian_name || 'Parent'}, the examination report card for ${firstStu.first_name} ${firstStu.last_name} (${classLabel(selectedClass)}) is ready. Please find the attached official terminal report card. Thank you. — ${schoolName}`;
    setBulkMessageText(defaultMsg);
    setBulkQueueOpen(true);
  };

  const currentQueueStudent = bulkSelectedStudents[queueIndex];

  // When current student in queue changes, update render ref & default message
  const handleQueueIndexChange = (newIndex: number) => {
    if (newIndex < 0 || newIndex >= bulkSelectedStudents.length) return;
    setQueueIndex(newIndex);
    const stu = bulkSelectedStudents[newIndex];
    setActiveRenderStudentId(stu.id);
    const schoolName = schoolQuery.data?.name || 'School';
    const msg = `Dear ${stu.guardian_name || 'Parent'}, the examination report card for ${stu.first_name} ${stu.last_name} (${classLabel(selectedClass)}) is ready. Please find the attached official terminal report card. Thank you. — ${schoolName}`;
    setBulkMessageText(msg);
  };

  // Bulk step: Generate & Download PDF
  const handleBulkGeneratePdf = async () => {
    if (!currentQueueStudent || !reportCardRef.current) return;
    try {
      const studentName = `${currentQueueStudent.first_name} ${currentQueueStudent.last_name}`;
      const filename = `Report_Card_${studentName.replace(/[^a-zA-Z0-9]/g, '_')}.pdf`;
      const { blob } = await generateReportCardPdf(reportCardRef.current, filename);
      downloadPdfBlob(blob, filename);
      setBulkQueueStatus((prev) => ({ ...prev, [currentQueueStudent.id]: 'pdf_generated' }));
      const rep = reportsByStudentId.get(currentQueueStudent.id);
      await upsertShareMutation.mutateAsync({
        studentId: currentQueueStudent.id,
        terminalReportId: rep?.id,
        parentName: currentQueueStudent.guardian_name || 'Parent',
        parentPhone: currentQueueStudent.guardian_phone || '',
        message: bulkMessageText,
        status: 'pdf_generated',
      });
      toast(`Downloaded ${filename} successfully!`);
    } catch (err: any) {
      toast(`Failed to generate PDF: ${err.message}`, 'error');
    }
  };

  // Bulk step: Open WhatsApp
  const handleBulkOpenWhatsApp = async () => {
    if (!currentQueueStudent) return;
    const phone = currentQueueStudent.guardian_phone;
    const cleanPhone = formatWhatsAppNumber(phone);
    if (!cleanPhone) {
      toast(`Guardian phone "${phone}" is not a valid WhatsApp number. Please check phone format.`, 'error');
      return;
    }
    const link = createWhatsAppLink(cleanPhone, bulkMessageText);
    setBulkQueueStatus((prev) => ({ ...prev, [currentQueueStudent.id]: 'whatsapp_opened' }));
    const rep = reportsByStudentId.get(currentQueueStudent.id);
    await upsertShareMutation.mutateAsync({
      studentId: currentQueueStudent.id,
      terminalReportId: rep?.id,
      parentName: currentQueueStudent.guardian_name || 'Parent',
      parentPhone: phone || 'N/A',
      message: bulkMessageText,
      status: 'whatsapp_opened',
    });
    window.open(link, '_blank', 'noopener,noreferrer');
  };

  // Bulk step: Mark as Sent & Advance
  const handleBulkMarkSentAndNext = async () => {
    if (!currentQueueStudent) return;
    const rep = reportsByStudentId.get(currentQueueStudent.id);
    await upsertShareMutation.mutateAsync({
      studentId: currentQueueStudent.id,
      terminalReportId: rep?.id,
      parentName: currentQueueStudent.guardian_name || 'Parent',
      parentPhone: currentQueueStudent.guardian_phone || '',
      message: bulkMessageText,
      status: 'marked_as_sent',
    });
    setBulkQueueStatus((prev) => ({ ...prev, [currentQueueStudent.id]: 'marked_as_sent' }));
    toast(`Student ${queueIndex + 1} marked as sent!`);

    if (queueIndex + 1 < bulkSelectedStudents.length) {
      handleQueueIndexChange(queueIndex + 1);
    } else {
      toast('🎉 All selected students in the bulk queue have been processed!');
      setBulkQueueOpen(false);
    }
  };

  // Active rendering student report data
  const renderStudent = useMemo(() => {
    return students.find((s) => s.id === activeRenderStudentId) || students[0];
  }, [students, activeRenderStudentId]);

  const renderReport = useMemo(() => {
    if (!renderStudent) return null;
    return reportsByStudentId.get(renderStudent.id);
  }, [reportsByStudentId, renderStudent]);

  return (
    <div>
      <PageHeader
        title="WhatsApp Report Card Sharing"
        subtitle="Generate official individual PDF report cards and manually share directly with parents via WhatsApp."
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            <Link to={isTeacher ? '/teach/communication/history' : '/school/communication/history'}>
              <Button variant="secondary" size="sm">📜 Message History</Button>
            </Link>
          </div>
        }
      />

      {/* FILTER BAR */}
      <div style={{ marginBottom: 20 }}>
        <Card>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 1fr) minmax(200px, 1fr) auto', gap: 16, alignItems: 'end' }}>
            <Select
              label="Examination / Semester"
              value={semesterId}
              onChange={(e) => {
                setParams((prev) => {
                  const next = new URLSearchParams(prev);
                  next.set('semester', e.target.value);
                  return next;
                });
              }}
            >
              {semestersQuery.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} {s.is_current ? '(Current)' : ''}
                </option>
              ))}
            </Select>

            <Select
              label="Class"
              value={classId}
              onChange={(e) => {
                setParams((prev) => {
                  const next = new URLSearchParams(prev);
                  next.set('class', e.target.value);
                  return next;
                });
              }}
            >
              <option value="">-- Choose Class --</option>
              {classesQuery.data?.map((c) => (
                <option key={c.id} value={c.id}>{classLabel(c)}</option>
              ))}
            </Select>

            {classId && (
              <Button
                variant="primary"
                onClick={handleStartBulkQueue}
                disabled={selectedStudentIds.size === 0}
              >
                🚀 Start Bulk Sharing Queue ({selectedStudentIds.size} Selected)
              </Button>
            )}
          </div>
        </Card>
      </div>

      {/* KPI METRICS */}
      {classId && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 20 }}>
          <StatCard label="Total Students" value={stats.total} hint="Enrolled in class" />
          <StatCard label="Published Reports" value={stats.ready} hint="Ready to share" tone="good" />
          <StatCard label="WhatsApp Opened" value={stats.opened} hint="Link clicked" />
          <StatCard label="Marked as Sent" value={stats.sent} hint="Completed sharing" tone="good" />
        </div>
      )}

      {/* MAIN STUDENTS TABLE */}
      {!classId ? (
        <EmptyState title="Select a Class">
          Please select an academic semester and a class above to review students and their report card sharing status.
        </EmptyState>
      ) : studentsQuery.isLoading ? (
        <Spinner />
      ) : students.length === 0 ? (
        <EmptyState title="No Students in this Class">
          There are no active enrolled students found in this class.
        </EmptyState>
      ) : (
        <Card
          title={
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span>Students in {classLabel(selectedClass)} ({students.length})</span>
              <Badge tone="neutral">{selectedStudentIds.size} Selected</Badge>
            </div>
          }
          actions={
            <Button size="sm" variant="secondary" onClick={handleSelectAll}>
              {selectedStudentIds.size === students.length ? 'Deselect All' : 'Select All Eligible'}
            </Button>
          }
        >
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--line)', background: 'var(--bg)' }}>
                  <th style={{ padding: '10px 12px', textAlign: 'center', width: 40 }}>
                    <input
                      type="checkbox"
                      checked={selectedStudentIds.size === students.length && students.length > 0}
                      onChange={handleSelectAll}
                    />
                  </th>
                  <th style={{ padding: '10px 12px', textAlign: 'left' }}>Student</th>
                  <th style={{ padding: '10px 12px', textAlign: 'left' }}>Parent / Guardian</th>
                  <th style={{ padding: '10px 12px', textAlign: 'left' }}>WhatsApp Phone</th>
                  <th style={{ padding: '10px 12px', textAlign: 'center' }}>Report Status</th>
                  <th style={{ padding: '10px 12px', textAlign: 'center' }}>Share Status</th>
                  <th style={{ padding: '10px 12px', textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {students.map((stu) => {
                  const rep = reportsByStudentId.get(stu.id);
                  const share = sharesByStudentId.get(stu.id);
                  const formattedPhone = formatWhatsAppNumber(stu.guardian_phone);
                  const isSelected = selectedStudentIds.has(stu.id);

                  let shareBadge = <Badge tone="neutral">Not Shared</Badge>;
                  if (share?.status === 'pdf_generated') {
                    shareBadge = <Badge tone="info">PDF Generated</Badge>;
                  } else if (share?.status === 'whatsapp_opened') {
                    shareBadge = <Badge tone="warn">WhatsApp Opened</Badge>;
                  } else if (share?.status === 'marked_as_sent') {
                    shareBadge = <Badge tone="good">Marked as Sent ✓</Badge>;
                  }

                  return (
                    <tr
                      key={stu.id}
                      style={{
                        borderBottom: '1px solid var(--line)',
                        background: isSelected ? 'rgba(16, 185, 129, 0.05)' : undefined,
                      }}
                    >
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleStudent(stu.id)}
                        />
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <div style={{ fontWeight: 600 }}>{stu.last_name}, {stu.first_name}</div>
                        <div className="small muted mono">{stu.admission_number}</div>
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        {stu.guardian_name || <span className="muted">Not recorded</span>}
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        {stu.guardian_phone ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span className="mono">{stu.guardian_phone}</span>
                            {formattedPhone ? (
                              <span title="Valid WhatsApp format" style={{ color: 'var(--green-600)', fontSize: '0.9rem' }}>✓</span>
                            ) : (
                              <span title="Check country/area code" style={{ color: 'var(--amber-600)', fontSize: '0.8rem' }}>⚠️</span>
                            )}
                          </div>
                        ) : (
                          <span className="muted" style={{ color: 'var(--amber-700)' }}>No Phone</span>
                        )}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                        {rep?.status === 'published' ? (
                          <Badge tone="good">Published</Badge>
                        ) : rep?.status === 'draft' ? (
                          <Badge tone="warn">Draft</Badge>
                        ) : (
                          <Badge tone="neutral">No Report</Badge>
                        )}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                        {shareBadge}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => handleOpenSingleModal(stu)}
                            title="Share via WhatsApp"
                          >
                            📲 Share
                          </Button>
                          {share?.status !== 'marked_as_sent' && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => handleMarkAsSent(stu)}
                              title="Mark as manually sent"
                            >
                              ✓ Sent
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* INDIVIDUAL MANUAL SHARE MODAL */}
      {singleShareModalStudent && (
        <Modal
          open={!!singleShareModalStudent}
          title={`Share Report Card: ${singleShareModalStudent.first_name} ${singleShareModalStudent.last_name}`}
          onClose={() => setSingleShareModalStudent(null)}
          wide
          footer={
            <>
              <Button variant="secondary" onClick={() => setSingleShareModalStudent(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleExecuteSingleShare}
                loading={isProcessingSingle}
              >
                📲 Download PDF & Open WhatsApp
              </Button>
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Alert tone="info">
              <strong>Manual Sharing Instructions:</strong> Clicking below will generate & download the student's individual report card PDF to your device, and open WhatsApp with the parent's phone number. Simply attach the downloaded PDF and press Send.
            </Alert>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
              <Input
                label="Parent / Guardian Name"
                value={singleShareModalStudent.guardian_name || ''}
                readOnly
              />
              <Input
                label="WhatsApp Phone Number"
                value={singlePhone}
                onChange={(e) => setSinglePhone(e.target.value)}
                placeholder="e.g. 0244123456 or +233244123456"
                hint="Numbers will automatically normalize to international WhatsApp format (+233 for Ghana)."
              />
            </div>

            <Textarea
              label="Accompanying WhatsApp Message"
              rows={4}
              value={singleMessage}
              onChange={(e) => setSingleMessage(e.target.value)}
            />

            <div style={{ background: 'var(--bg)', padding: 12, borderRadius: 6, fontSize: '0.85rem' }}>
              <div><strong>Notice:</strong> As required by WhatsApp policies, sharing is 100% manual. No third-party automated API access tokens are required.</div>
            </div>
          </div>
        </Modal>
      )}

      {/* BULK MANUAL SHARING QUEUE WIZARD MODAL */}
      {bulkQueueOpen && currentQueueStudent && (
        <Modal
          open={bulkQueueOpen}
          title={`Bulk Sharing Queue · Student ${queueIndex + 1} of ${bulkSelectedStudents.length}`}
          onClose={() => setBulkQueueOpen(false)}
          wide
          footer={
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleQueueIndexChange(queueIndex - 1)}
                  disabled={queueIndex === 0}
                >
                  ← Previous
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleQueueIndexChange(queueIndex + 1)}
                  disabled={queueIndex + 1 >= bulkSelectedStudents.length}
                >
                  Skip to Next →
                </Button>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <Button variant="secondary" onClick={() => setBulkQueueOpen(false)}>
                  Close Queue
                </Button>
                <Button
                  variant="primary"
                  onClick={handleBulkMarkSentAndNext}
                >
                  ✓ Mark as Sent & Next Student
                </Button>
              </div>
            </div>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* PROGRESS BAR */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: 6 }}>
                <span>Progress: <strong>{queueIndex + 1} / {bulkSelectedStudents.length}</strong></span>
                <span>
                  Remaining: <strong>{bulkSelectedStudents.length - (queueIndex + 1)}</strong>
                </span>
              </div>
              <div style={{ width: '100%', height: 8, background: 'var(--line)', borderRadius: 4, overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${((queueIndex + 1) / bulkSelectedStudents.length) * 100}%`,
                    background: 'var(--green-600)',
                    transition: 'width 0.3s ease',
                  }}
                />
              </div>
            </div>

            {/* CURRENT STUDENT CARD */}
            <div style={{ background: '#f8fafc', border: '1px solid var(--line)', borderRadius: 8, padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.15rem' }}>
                    {currentQueueStudent.first_name} {currentQueueStudent.last_name}
                  </h3>
                  <div className="small muted mono">Admission: {currentQueueStudent.admission_number} · Class: {classLabel(selectedClass)}</div>
                </div>
                <div>
                  {bulkQueueStatus[currentQueueStudent.id] === 'marked_as_sent' ? (
                    <Badge tone="good">Marked as Sent ✓</Badge>
                  ) : bulkQueueStatus[currentQueueStudent.id] === 'whatsapp_opened' ? (
                    <Badge tone="warn">WhatsApp Opened</Badge>
                  ) : (
                    <Badge tone="neutral">Ready to Send</Badge>
                  )}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 14 }}>
                <div>
                  <div className="small muted">Parent / Guardian:</div>
                  <strong>{currentQueueStudent.guardian_name || 'Not recorded'}</strong>
                </div>
                <div>
                  <div className="small muted">Guardian WhatsApp Phone:</div>
                  <strong className="mono">{currentQueueStudent.guardian_phone || 'Missing phone'}</strong>
                </div>
              </div>

              {/* ACTION STEPS */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 14 }}>
                <Button
                  variant="secondary"
                  onClick={handleBulkGeneratePdf}
                  style={{ justifyContent: 'center' }}
                >
                  📄 1. Download PDF Report Card
                </Button>
                <Button
                  variant="primary"
                  onClick={handleBulkOpenWhatsApp}
                  disabled={!currentQueueStudent.guardian_phone}
                  style={{ justifyContent: 'center' }}
                >
                  📲 2. Open WhatsApp Web / App
                </Button>
              </div>

              <Textarea
                label="WhatsApp Message"
                rows={3}
                value={bulkMessageText}
                onChange={(e) => setBulkMessageText(e.target.value)}
              />
            </div>

            <div style={{ fontSize: '0.82rem', color: 'var(--muted)' }}>
              Step 1 downloads the student's individual PDF. Step 2 opens WhatsApp with the parent's phone and prepared text. Once you hit send in WhatsApp, click "Mark as Sent & Next Student" to advance.
            </div>
          </div>
        </Modal>
      )}

      {/* OFF-SCREEN REPORT CARD RENDER CONTAINER (Used for Canvas Snapshotting) */}
      <div
        style={{
          position: 'absolute',
          left: -9999,
          top: -9999,
          width: 800,
          background: '#ffffff',
          color: '#111827',
          padding: 24,
          fontFamily: 'system-ui, -apple-system, sans-serif',
        }}
      >
        <div ref={reportCardRef} className="terminal-report-container" style={{ background: '#ffffff', padding: 24 }}>
          {/* Header */}
          <div style={{ textAlign: 'center', borderBottom: '2px solid #065f46', paddingBottom: 12, marginBottom: 16 }}>
            <h1 style={{ fontSize: '1.4rem', textTransform: 'uppercase', color: '#064e3b', margin: 0 }}>
              {schoolQuery.data?.name || 'School Management System'}
            </h1>
            {schoolQuery.data?.motto && (
              <div style={{ fontStyle: 'italic', color: '#6b7280', fontSize: '0.85rem', marginTop: 2 }}>
                "{schoolQuery.data.motto}"
              </div>
            )}
            <div style={{ fontSize: '0.8rem', color: '#4b5563', marginTop: 4 }}>
              {schoolQuery.data?.address && <span>{schoolQuery.data.address} · </span>}
              {schoolQuery.data?.phone && <span>Tel: {schoolQuery.data.phone} · </span>}
              {schoolQuery.data?.email && <span>Email: {schoolQuery.data.email}</span>}
            </div>
            <div style={{ marginTop: 8, fontWeight: 700, fontSize: '1.05rem', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
              OFFICIAL STUDENT TERMINAL REPORT
            </div>
            <div style={{ fontSize: '0.85rem', color: '#374151' }}>
              {activeSemester?.name || 'Academic Term'} · {classLabel(selectedClass)}
            </div>
          </div>

          {/* Student Bio */}
          {renderStudent && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '6px 16px', background: '#f8fafc', padding: '10px 14px', borderRadius: 6, marginBottom: 14, fontSize: '0.85rem' }}>
              <div><strong>Student Name:</strong> {renderStudent.last_name}, {renderStudent.first_name}</div>
              <div><strong>Admission No:</strong> <span style={{ fontFamily: 'monospace' }}>{renderStudent.admission_number}</span></div>
              <div><strong>Class:</strong> {classLabel(selectedClass)}</div>
              <div><strong>Date Generated:</strong> {formatDate(todayISO())}</div>
            </div>
          )}

          {/* Snapshot Results Table */}
          {renderReport?.snapshot_data?.results && Array.isArray(renderReport.snapshot_data.results) ? (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', marginBottom: 14 }}>
              <thead>
                <tr style={{ background: '#065f46', color: '#ffffff' }}>
                  <th style={{ padding: '6px 8px', textAlign: 'left' }}>Subject</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right', width: 75 }}>Score (100)</th>
                  <th style={{ padding: '6px 8px', textAlign: 'center', width: 60 }}>Grade</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left' }}>Remark</th>
                </tr>
              </thead>
              <tbody>
                {(renderReport.snapshot_data.results as any[]).map((r, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #e5e7eb', background: i % 2 === 0 ? '#fff' : '#f9fafb' }}>
                    <td style={{ padding: '6px 8px', fontWeight: 600 }}>{r.subject_name}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'right' }}>{r.total}</td>
                    <td style={{ padding: '6px 8px', textAlign: 'center', fontWeight: 700 }}>{r.grade}</td>
                    <td style={{ padding: '6px 8px' }}>{r.remark || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div style={{ padding: 16, border: '1px dashed #cbd5e1', textAlign: 'center', color: '#64748b', marginBottom: 14, fontSize: '0.85rem' }}>
              Official examination scores and terminal remarks recorded by {schoolQuery.data?.name || 'School'}.
            </div>
          )}

          {/* Summary KPI Block */}
          {renderReport && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, border: '1px solid #e2e8f0', borderRadius: 6, padding: 8, marginBottom: 14, textAlign: 'center', fontSize: '0.82rem' }}>
              <div>
                <div style={{ color: '#64748b', fontSize: '0.75rem' }}>Total Score</div>
                <strong>{renderReport.total_score}</strong>
              </div>
              <div>
                <div style={{ color: '#64748b', fontSize: '0.75rem' }}>Average</div>
                <strong>{renderReport.average_score}%</strong>
              </div>
              <div>
                <div style={{ color: '#64748b', fontSize: '0.75rem' }}>Overall Grade</div>
                <strong style={{ color: '#065f46' }}>{renderReport.overall_grade || '—'}</strong>
              </div>
              <div>
                <div style={{ color: '#64748b', fontSize: '0.75rem' }}>Class Position</div>
                <strong>{renderReport.position ? `${renderReport.position} of ${renderReport.total_students}` : '—'}</strong>
              </div>
            </div>
          )}

          {/* Teacher and Headmaster Remarks */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, fontSize: '0.82rem', marginBottom: 16 }}>
            <div style={{ padding: 10, background: '#f8fafc', borderRadius: 6, border: '1px solid #e2e8f0' }}>
              <div style={{ fontWeight: 700, marginBottom: 4, color: '#334155' }}>Class Teacher's Remarks:</div>
              <div>{renderReport?.class_teacher_remarks || 'Satisfactory academic performance and steady commitment to class tasks.'}</div>
            </div>
            <div style={{ padding: 10, background: '#f8fafc', borderRadius: 6, border: '1px solid #e2e8f0' }}>
              <div style={{ fontWeight: 700, marginBottom: 4, color: '#334155' }}>Headmaster's Remarks:</div>
              <div>{renderReport?.headmaster_remarks || 'Approved and officially certified by School Administration.'}</div>
            </div>
          </div>

          {/* Footer certification */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', paddingTop: 16, borderTop: '1px solid #e2e8f0', fontSize: '0.78rem', color: '#64748b' }}>
            <div>Next Term Begins: <strong>{renderReport?.next_term_begins || 'Refer to School Calendar'}</strong></div>
            <div style={{ textAlign: 'right' }}>
              <div>Official Signature & Stamp</div>
              <div style={{ height: 28 }}></div>
              <div>___________________________</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
