import { useState, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { useClasses, useSchoolDetails, useSemesters } from '../../lib/queries';
import { classLabel } from '../../lib/format';
import { useToast } from '../../lib/toast';
import { friendlyError } from '../../lib/errors';
import { formatWhatsAppNumber } from '../../lib/reportPdf';
import type { MessageTemplate, Student } from '../../lib/types';
import {
  Button,
  Card,
  Field,
  Input,
  Select,
  Modal,
  Alert,
  Spinner,
  Badge,
  EmptyState,
  PageHeader,
  StatCard,
} from '../../components/ui';

export function personalizeMessage(
  template: string,
  vars: {
    parent_name?: string;
    student_name?: string;
    class_name?: string;
    school_name?: string;
    exam_name?: string;
  }
): string {
  return template
    .replace(/\{parent_name\}|\[Parent Name\]/gi, vars.parent_name || 'Parent/Guardian')
    .replace(/\{student_name\}|\[Student Name\]/gi, vars.student_name || 'Student')
    .replace(/\{class_name\}|\[Class\]/gi, vars.class_name || 'Class')
    .replace(/\{school_name\}|\[School Name\]/gi, vars.school_name || 'School')
    .replace(/\{exam_name\}|\[Exam Period\]/gi, vars.exam_name || 'Terminal Exam');
}

export function calculateSmsUnits(text: string): { chars: number; units: number; isUnicode: boolean } {
  const isUnicode = /[^\u0020-\u007E\n\r]/.test(text);
  const chars = text.length;
  if (chars === 0) return { chars: 0, units: 0, isUnicode: false };
  if (isUnicode) {
    const units = chars <= 70 ? 1 : Math.ceil(chars / 67);
    return { chars, units, isUnicode: true };
  } else {
    const units = chars <= 160 ? 1 : Math.ceil(chars / 153);
    return { chars, units, isUnicode: false };
  }
}

export default function BulkSmsPage() {
  const { active, session } = useAuth();
  const schoolId = active?.school_id;
  const qc = useQueryClient();
  const toast = useToast();

  const [filterMode, setFilterMode] = useState<'all' | 'class' | 'selected'>('class');
  const [selectedClassId, setSelectedClassId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(new Set());
  const [messageText, setMessageText] = useState('');
  const [batchTitle, setBatchTitle] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [confirmModalOpen, setConfirmModalOpen] = useState(false);
  const [newTemplateModalOpen, setNewTemplateModalOpen] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState('');
  const [newTemplateCategory, setNewTemplateCategory] = useState('general');
  const [sendResult, setSendResult] = useState<{
    batch_id: string;
    total: number;
    successful: number;
    failed: number;
    estimated_cost_ghs: number;
    provider: string;
  } | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Queries
  const schoolQuery = useSchoolDetails(schoolId);
  const classesQuery = useClasses(schoolId);
  const semestersQuery = useSemesters(schoolId);

  // Settings
  const settingsQuery = useQuery({
    queryKey: ['communication_settings', schoolId],
    enabled: !!schoolId,
    queryFn: async () => {
      const { data } = await supabase
        .from('communication_settings')
        .select('*')
        .eq('school_id', schoolId!)
        .maybeSingle();
      return data;
    },
  });

  // Templates
  const templatesQuery = useQuery({
    queryKey: ['message_templates', schoolId],
    enabled: !!schoolId,
    queryFn: async () => {
      const { data } = await supabase
        .from('message_templates')
        .select('*')
        .eq('school_id', schoolId!)
        .order('is_default', { ascending: false })
        .order('name');
      return (data ?? []) as MessageTemplate[];
    },
  });

  // Students list
  const studentsQuery = useQuery({
    queryKey: ['students_with_guardians', schoolId],
    enabled: !!schoolId,
    queryFn: async () => {
      const { data } = await supabase
        .from('students')
        .select('id, first_name, last_name, admission_number, current_class_id, guardian_name, guardian_phone, enrollment_status')
        .eq('school_id', schoolId!)
        .eq('enrollment_status', 'active')
        .order('last_name')
        .order('first_name');
      return (data ?? []) as Student[];
    },
  });

  const activeSemester = semestersQuery.data?.find((s) => s.is_current) || semestersQuery.data?.[0];
  const classes = classesQuery.data ?? [];
  const students = studentsQuery.data ?? [];
  const templates = templatesQuery.data ?? [];
  const ratePerUnit = Number(settingsQuery.data?.sms_rate_per_unit || 0.05);
  const schoolName = schoolQuery.data?.name || 'School';

  // Filter students based on filterMode & selectedClassId
  const candidateStudents = useMemo(() => {
    let list = students;
    if (filterMode === 'class' && selectedClassId) {
      list = list.filter((s) => s.current_class_id === selectedClassId);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter((s) => {
        const studentName = `${s.first_name} ${s.last_name}`.toLowerCase();
        const guardian = (s.guardian_name || '').toLowerCase();
        const phone = (s.guardian_phone || '').toLowerCase();
        const adm = (s.admission_number || '').toLowerCase();
        return studentName.includes(q) || guardian.includes(q) || phone.includes(q) || adm.includes(q);
      });
    }
    return list;
  }, [students, filterMode, selectedClassId, searchQuery]);

  // Determine active recipients depending on selection
  const recipientStudents = useMemo(() => {
    if (filterMode === 'selected') {
      return candidateStudents.filter((s) => selectedStudentIds.has(s.id));
    }
    return candidateStudents;
  }, [candidateStudents, filterMode, selectedStudentIds]);

  // Valid recipients count
  const validRecipients = useMemo(() => {
    return recipientStudents.filter((s) => !!formatWhatsAppNumber(s.guardian_phone));
  }, [recipientStudents]);

  // Text metrics
  const smsMetrics = useMemo(() => {
    return calculateSmsUnits(messageText);
  }, [messageText]);

  const estimatedCost = useMemo(() => {
    const totalSms = validRecipients.length * Math.max(1, smsMetrics.units);
    return Math.round(totalSms * ratePerUnit * 100) / 100;
  }, [validRecipients.length, smsMetrics.units, ratePerUnit]);

  // Handle template selection
  const handleSelectTemplate = (templateId: string) => {
    setSelectedTemplateId(templateId);
    if (!templateId) return;
    const t = templates.find((tpl) => tpl.id === templateId);
    if (t) {
      setMessageText(t.content);
      if (!batchTitle) {
        setBatchTitle(t.name);
      }
    }
  };

  // Insert dynamic tag
  const handleInsertTag = (tag: string) => {
    const textarea = textareaRef.current;
    if (!textarea) {
      setMessageText((prev) => prev + tag);
      return;
    }
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const newText = messageText.substring(0, start) + tag + messageText.substring(end);
    setMessageText(newText);
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + tag.length, start + tag.length);
    }, 0);
  };

  // Toggle single student
  const handleToggleStudent = (id: string) => {
    setSelectedStudentIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Select / Deselect all
  const handleSelectAll = () => {
    if (selectedStudentIds.size === candidateStudents.length) {
      setSelectedStudentIds(new Set());
    } else {
      setSelectedStudentIds(new Set(candidateStudents.map((s) => s.id)));
    }
  };

  // Save new template mutation
  const saveTemplateMutation = useMutation({
    mutationFn: async () => {
      if (!newTemplateName.trim() || !messageText.trim() || !schoolId) {
        throw new Error('Please enter a template name and message content.');
      }
      const { error } = await supabase.from('message_templates').insert({
        school_id: schoolId,
        name: newTemplateName.trim(),
        category: newTemplateCategory,
        content: messageText.trim(),
        is_default: false,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast('Template saved successfully!');
      setNewTemplateModalOpen(false);
      setNewTemplateName('');
      qc.invalidateQueries({ queryKey: ['message_templates', schoolId] });
    },
    onError: (err) => {
      toast(friendlyError(err), 'error');
    },
  });

  // Send SMS Mutation
  const sendSmsMutation = useMutation({
    mutationFn: async () => {
      if (!session?.access_token) {
        throw new Error('User session not found. Please re-login.');
      }
      if (validRecipients.length === 0) {
        throw new Error('No recipients with valid phone numbers selected.');
      }
      if (!messageText.trim()) {
        throw new Error('Please enter a message to send.');
      }

      // Build personalized recipients
      const sig = settingsQuery.data?.school_signature;
      const recipientsPayload = validRecipients.map((s) => {
        const cls = classes.find((c) => c.id === s.current_class_id);
        let personalized = personalizeMessage(messageText, {
          parent_name: s.guardian_name || 'Parent',
          student_name: `${s.first_name} ${s.last_name}`,
          class_name: classLabel(cls),
          school_name: schoolName,
          exam_name: activeSemester?.name || 'Terminal Exam',
        });

        if (sig && !personalized.includes(sig)) {
          personalized = `${personalized}\n\n${sig}`;
        }

        return {
          student_id: s.id,
          name: s.guardian_name || `${s.first_name}'s Guardian`,
          phone: s.guardian_phone,
          personalized_message: personalized,
        };
      });

      const res = await fetch('/api/communication/send-sms', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          school_id: schoolId,
          title: batchTitle || `SMS Broadcast (${validRecipients.length} recipients)`,
          filter_type: filterMode,
          target_class_id: filterMode === 'class' ? selectedClassId : null,
          message: messageText,
          recipients: recipientsPayload,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Failed to dispatch SMS');
      }
      return data;
    },
    onSuccess: (data) => {
      toast(`Successfully dispatched SMS to ${data.successful} recipient(s)!`);
      setSendResult(data);
      setConfirmModalOpen(false);
      qc.invalidateQueries({ queryKey: ['communication_batches', schoolId] });
      qc.invalidateQueries({ queryKey: ['sms_logs', schoolId] });
    },
    onError: (err) => {
      toast(friendlyError(err), 'error');
    },
  });

  // Sample preview for first recipient
  const sampleStudent = candidateStudents[0];
  const sampleClass = classes.find((c) => c.id === sampleStudent?.current_class_id);
  const rawPreview = personalizeMessage(messageText || '(Your message will appear here)', {
    parent_name: sampleStudent?.guardian_name || 'Mr. Mensah',
    student_name: sampleStudent ? `${sampleStudent.first_name} ${sampleStudent.last_name}` : 'Kofi Mensah',
    class_name: sampleClass ? classLabel(sampleClass) : 'Basic 4',
    school_name: schoolName,
    exam_name: activeSemester?.name || '1st Term 2026',
  });
  const schoolSig = settingsQuery.data?.school_signature;
  const samplePreviewText = schoolSig && !rawPreview.includes(schoolSig) ? `${rawPreview}\n\n${schoolSig}` : rawPreview;

  return (
    <div>
      <PageHeader
        title="Bulk SMS Communication"
        subtitle="Broadcast personalized SMS alerts, terminal notices, and reminders to parents."
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            <Link to="/school/communication/history">
              <Button variant="secondary" size="sm">📜 Message History</Button>
            </Link>
          </div>
        }
      />

      {/* KPI Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 20 }}>
        <StatCard
          label="Selected Recipients"
          value={validRecipients.length}
          hint={`${recipientStudents.length - validRecipients.length} invalid or missing phone`}
          tone={validRecipients.length > 0 ? 'good' : 'warn'}
        />
        <StatCard
          label="SMS Units / Recipient"
          value={smsMetrics.units || 0}
          hint={`${smsMetrics.chars} characters (${smsMetrics.isUnicode ? 'Unicode 70/unit' : 'GSM 160/unit'})`}
        />
        <StatCard
          label="Est. Rate / Unit"
          value={`GHS ${ratePerUnit.toFixed(3)}`}
          hint={`Provider: ${settingsQuery.data?.provider || 'Arkesel / Test'}`}
        />
        <StatCard
          label="Estimated Total Cost"
          value={`GHS ${estimatedCost.toFixed(2)}`}
          hint="Calculated on confirm"
          tone={estimatedCost > 0 ? 'good' : undefined}
        />
      </div>

      {sendResult && (
        <div style={{ marginBottom: 20 }}>
          <Alert tone={sendResult.failed > 0 ? 'warn' : 'success'}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <strong>SMS Dispatch Completed!</strong> Batch ID: <code>{sendResult.batch_id}</code>.
                Sent: <strong>{sendResult.successful}</strong>, Failed: <strong>{sendResult.failed}</strong>.
                Total Estimated Cost: <strong>GHS {Number(sendResult.estimated_cost_ghs || 0).toFixed(2)}</strong>.
              </div>
              <Button size="sm" variant="secondary" onClick={() => setSendResult(null)}>Dismiss</Button>
            </div>
          </Alert>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 1.2fr) minmax(320px, 1fr)', gap: 20, alignItems: 'start' }}>
        {/* LEFT COLUMN: Recipient Selection */}
        <Card title="1. Select Parents & Recipients">
          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: '0.85rem', fontWeight: 600, display: 'block', marginBottom: 6 }}>
              Recipient Target Audience
            </label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <Button
                size="sm"
                variant={filterMode === 'class' ? 'primary' : 'secondary'}
                onClick={() => setFilterMode('class')}
              >
                Parents by Class
              </Button>
              <Button
                size="sm"
                variant={filterMode === 'all' ? 'primary' : 'secondary'}
                onClick={() => setFilterMode('all')}
              >
                All Parents (School-wide)
              </Button>
              <Button
                size="sm"
                variant={filterMode === 'selected' ? 'primary' : 'secondary'}
                onClick={() => setFilterMode('selected')}
              >
                Select Individual Students
              </Button>
            </div>
          </div>

          {filterMode !== 'all' && (
            <div style={{ marginBottom: 16 }}>
              <Select
                label="Select Class"
                value={selectedClassId}
                onChange={(e) => setSelectedClassId(e.target.value)}
              >
                <option value="">-- Choose Class --</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>{classLabel(c)}</option>
                ))}
              </Select>
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <div style={{ flex: 1 }}>
              <Input
                label=""
                placeholder="Search student, guardian, or phone number..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            {filterMode === 'selected' && (
              <Button size="sm" variant="secondary" onClick={handleSelectAll} style={{ height: 38, alignSelf: 'flex-end' }}>
                {selectedStudentIds.size === candidateStudents.length ? 'Deselect All' : 'Select All'}
              </Button>
            )}
          </div>

          {/* Student Table */}
          {studentsQuery.isLoading ? (
            <Spinner />
          ) : candidateStudents.length === 0 ? (
            <EmptyState title="No matching students found">
              {filterMode === 'class' && !selectedClassId
                ? 'Please pick a class above to load parent phone contacts.'
                : 'No active students match your search filter.'}
            </EmptyState>
          ) : (
            <div style={{ maxHeight: 380, overflowY: 'auto', border: '1px solid var(--line)', borderRadius: 6 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-card)', zIndex: 1, borderBottom: '1px solid var(--line)' }}>
                  <tr>
                    {filterMode === 'selected' && <th style={{ padding: '8px 10px', width: 32 }}></th>}
                    <th style={{ padding: '8px 10px', textAlign: 'left' }}>Student</th>
                    <th style={{ padding: '8px 10px', textAlign: 'left' }}>Parent / Guardian</th>
                    <th style={{ padding: '8px 10px', textAlign: 'left' }}>Phone</th>
                    <th style={{ padding: '8px 10px', textAlign: 'center' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {candidateStudents.map((s) => {
                    const formattedPhone = formatWhatsAppNumber(s.guardian_phone);
                    const isSelected = selectedStudentIds.has(s.id);
                    return (
                      <tr
                        key={s.id}
                        onClick={() => filterMode === 'selected' && handleToggleStudent(s.id)}
                        style={{
                          borderBottom: '1px solid var(--line)',
                          cursor: filterMode === 'selected' ? 'pointer' : 'default',
                          background: isSelected && filterMode === 'selected' ? 'rgba(16, 185, 129, 0.08)' : undefined,
                        }}
                      >
                        {filterMode === 'selected' && (
                          <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => handleToggleStudent(s.id)}
                            />
                          </td>
                        )}
                        <td style={{ padding: '8px 10px', fontWeight: 600 }}>
                          {s.last_name}, {s.first_name}
                          <div className="small muted mono">{s.admission_number}</div>
                        </td>
                        <td style={{ padding: '8px 10px' }}>
                          {s.guardian_name || <span className="muted">Not recorded</span>}
                        </td>
                        <td style={{ padding: '8px 10px' }}>
                          {s.guardian_phone ? (
                            <span className="mono">{s.guardian_phone}</span>
                          ) : (
                            <span className="muted" style={{ color: 'var(--amber-700)' }}>Missing</span>
                          )}
                        </td>
                        <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                          {formattedPhone ? (
                            <Badge tone="good">Valid</Badge>
                          ) : (
                            <Badge tone="warn">No Phone</Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ marginTop: 10, fontSize: '0.8rem', color: 'var(--muted)', display: 'flex', justifyContent: 'space-between' }}>
            <span>Showing {candidateStudents.length} candidate student(s)</span>
            <span><strong>{validRecipients.length}</strong> valid recipient(s) ready</span>
          </div>
        </Card>

        {/* RIGHT COLUMN: Message Composer */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <Card title="2. Compose Personalized Message">
            {/* Template Selector */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 14 }}>
              <div style={{ flex: 1 }}>
                <Select
                  label="Load Saved Template"
                  value={selectedTemplateId}
                  onChange={(e) => handleSelectTemplate(e.target.value)}
                >
                  <option value="">-- Custom Message or Choose Template --</option>
                  {templates.map((tpl) => (
                    <option key={tpl.id} value={tpl.id}>
                      [{tpl.category.toUpperCase()}] {tpl.name}
                    </option>
                  ))}
                </Select>
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setNewTemplateModalOpen(true)}
                disabled={!messageText.trim()}
                title="Save current message as a reusable template"
                style={{ height: 38 }}
              >
                💾 Save as Template
              </Button>
            </div>

            <div style={{ marginBottom: 12 }}>
              <Input
                label="Campaign / Broadcast Title (for your records)"
                placeholder="e.g. 1st Term Exam Notice - Basic 4"
                value={batchTitle}
                onChange={(e) => setBatchTitle(e.target.value)}
              />
            </div>

            {/* Dynamic Variable Tags */}
            <div style={{ marginBottom: 8 }}>
              <label style={{ fontSize: '0.8rem', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                Insert Dynamic Personalization Tags:
              </label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  style={{ fontSize: '0.75rem', padding: '3px 8px' }}
                  onClick={() => handleInsertTag('{parent_name}')}
                >
                  + {'{parent_name}'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  style={{ fontSize: '0.75rem', padding: '3px 8px' }}
                  onClick={() => handleInsertTag('{student_name}')}
                >
                  + {'{student_name}'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  style={{ fontSize: '0.75rem', padding: '3px 8px' }}
                  onClick={() => handleInsertTag('{class_name}')}
                >
                  + {'{class_name}'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  style={{ fontSize: '0.75rem', padding: '3px 8px' }}
                  onClick={() => handleInsertTag('{school_name}')}
                >
                  + {'{school_name}'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  style={{ fontSize: '0.75rem', padding: '3px 8px' }}
                  onClick={() => handleInsertTag('{exam_name}')}
                >
                  + {'{exam_name}'}
                </button>
              </div>
            </div>

            {/* Message Area */}
            <Field label="SMS Message Text" required>
              <textarea
                ref={textareaRef}
                rows={5}
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                placeholder="Type your message here. Tags like {parent_name} and {student_name} will automatically be replaced with each student's details."
                style={{ width: '100%', fontFamily: 'inherit', padding: 10, borderRadius: 6, border: '1px solid var(--line)' }}
              />
            </Field>

            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--muted)', marginTop: 4 }}>
              <span>
                <strong>{smsMetrics.chars}</strong> chars · <strong>{smsMetrics.units}</strong> SMS unit{smsMetrics.units === 1 ? '' : 's'}
                {smsMetrics.isUnicode ? ' (Unicode)' : ' (GSM Standard)'}
              </span>
              <span>Sender ID: <strong>{settingsQuery.data?.sms_sender_id || 'SchoolMS'}</strong> <span className="small muted">(SaaS Shared ID)</span></span>
            </div>

            {/* Live Preview Box */}
            <div style={{ marginTop: 14, background: 'var(--bg)', padding: 12, borderRadius: 6, border: '1px dashed var(--line)' }}>
              <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', fontWeight: 700, color: 'var(--muted)', marginBottom: 4 }}>
                📱 Live Parent SMS Preview
              </div>
              <div style={{ fontSize: '0.85rem', color: 'var(--ink)', whiteSpace: 'pre-wrap', lineHeight: 1.45 }}>
                {samplePreviewText}
              </div>
            </div>

            <div style={{ marginTop: 20 }}>
              <Button
                variant="primary"
                onClick={() => setConfirmModalOpen(true)}
                disabled={validRecipients.length === 0 || !messageText.trim()}
                style={{ width: '100%', justifyContent: 'center' }}
              >
                🚀 Review & Send SMS ({validRecipients.length} Recipient{validRecipients.length === 1 ? '' : 's'})
              </Button>
            </div>
          </Card>
        </div>
      </div>

      {/* CONFIRMATION MODAL - MANDATORY REQUIREMENT */}
      <Modal
        open={confirmModalOpen}
        title="Confirm Paid SMS Broadcast"
        onClose={() => setConfirmModalOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmModalOpen(false)} disabled={sendSmsMutation.isPending}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => sendSmsMutation.mutate()}
              loading={sendSmsMutation.isPending}
            >
              Confirm & Dispatch SMS Now
            </Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Alert tone="warn">
            <strong>Important:</strong> You are about to send paid SMS messages. This will incur carrier charges against your school gateway account balance.
          </Alert>

          <div style={{ background: 'var(--bg)', padding: 14, borderRadius: 6, fontSize: '0.88rem', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
            <div><strong>SMS Provider:</strong> {settingsQuery.data?.provider || 'Simulation / Arkesel'}</div>
            <div><strong>Sender ID:</strong> {settingsQuery.data?.sms_sender_id || 'SchoolMS'} <span className="small muted">(SaaS Shared)</span></div>
            <div><strong>Valid Recipients:</strong> {validRecipients.length} parents</div>
            <div><strong>SMS Units per Message:</strong> {smsMetrics.units} unit(s)</div>
            <div><strong>Total Units to Send:</strong> {validRecipients.length * Math.max(1, smsMetrics.units)} units</div>
            <div><strong>Estimated Total Cost:</strong> <span style={{ color: 'var(--green-700)', fontWeight: 700 }}>GHS {estimatedCost.toFixed(2)}</span></div>
          </div>

          <div>
            <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--muted)', marginBottom: 4 }}>Sample Personalized Message:</div>
            <div style={{ padding: 10, background: '#fff', border: '1px solid var(--line)', borderRadius: 6, fontSize: '0.85rem' }}>
              {samplePreviewText}
            </div>
          </div>
        </div>
      </Modal>

      {/* SAVE TEMPLATE MODAL */}
      <Modal
        open={newTemplateModalOpen}
        title="Save as Reusable Message Template"
        onClose={() => setNewTemplateModalOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setNewTemplateModalOpen(false)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={() => saveTemplateMutation.mutate()}
              loading={saveTemplateMutation.isPending}
            >
              Save Template
            </Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Input
            label="Template Name"
            placeholder="e.g. End of Term Report Ready"
            value={newTemplateName}
            onChange={(e) => setNewTemplateName(e.target.value)}
            required
          />
          <Select
            label="Category"
            value={newTemplateCategory}
            onChange={(e) => setNewTemplateCategory(e.target.value)}
          >
            <option value="exam">Examination Announcements</option>
            <option value="report_card">Report Card Notifications</option>
            <option value="fee">Fee Reminders</option>
            <option value="attendance">Attendance Notifications</option>
            <option value="general">General School Announcements</option>
          </Select>
          <div style={{ fontSize: '0.8rem', color: 'var(--muted)' }}>
            This template will be saved to your school's message templates library and can be loaded anytime.
          </div>
        </div>
      </Modal>
    </div>
  );
}
