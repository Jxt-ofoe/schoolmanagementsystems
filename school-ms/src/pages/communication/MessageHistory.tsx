import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { useClasses, useSemesters } from '../../lib/queries';
import { classLabel, formatDateTime } from '../../lib/format';
import { useToast } from '../../lib/toast';
import { friendlyError } from '../../lib/errors';
import type { SmsLog, WhatsAppReportShare, Student } from '../../lib/types';
import {
  Button,
  Card,
  Input,
  Select,
  Spinner,
  Badge,
  EmptyState,
  PageHeader,
  StatCard,
} from '../../components/ui';

export default function MessageHistoryPage() {
  const { ctx, active } = useAuth();
  const schoolId = active?.school_id;
  const isHeadmaster = active?.role === 'headmaster' || ctx?.is_super_admin;
  const qc = useQueryClient();
  const toast = useToast();

  const [activeTab, setActiveTab] = useState<'sms' | 'whatsapp'>(isHeadmaster ? 'sms' : 'whatsapp');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [classFilter, setClassFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Queries
  const classesQuery = useClasses(schoolId);
  const semestersQuery = useSemesters(schoolId);

  // 1. Fetch SMS Logs
  const smsLogsQuery = useQuery({
    queryKey: ['sms_logs', schoolId],
    enabled: !!schoolId && isHeadmaster,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sms_logs')
        .select('*')
        .eq('school_id', schoolId!)
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as SmsLog[];
    },
  });

  // 2. Fetch WhatsApp Shares
  const whatsappSharesQuery = useQuery({
    queryKey: ['whatsapp_shares_history', schoolId],
    enabled: !!schoolId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('whatsapp_report_shares')
        .select('*')
        .eq('school_id', schoolId!)
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as WhatsAppReportShare[];
    },
  });

  // 3. Fetch Students for name resolution in WhatsApp shares
  const studentsQuery = useQuery({
    queryKey: ['students_lookup', schoolId],
    enabled: !!schoolId,
    queryFn: async () => {
      const { data } = await supabase
        .from('students')
        .select('id, first_name, last_name, admission_number, current_class_id')
        .eq('school_id', schoolId!);
      return (data ?? []) as Student[];
    },
  });

  const smsLogs = smsLogsQuery.data ?? [];
  const whatsappShares = whatsappSharesQuery.data ?? [];
  const students = studentsQuery.data ?? [];
  const classes = classesQuery.data ?? [];
  const semesters = semestersQuery.data ?? [];

  const studentsMap = useMemo(() => {
    const map = new Map<string, Student>();
    for (const s of students) map.set(s.id, s);
    return map;
  }, [students]);

  const classesMap = useMemo(() => {
    const map = new Map<string, any>();
    for (const c of classes) map.set(c.id, c);
    return map;
  }, [classes]);

  const semestersMap = useMemo(() => {
    const map = new Map<string, any>();
    for (const s of semesters) map.set(s.id, s);
    return map;
  }, [semesters]);

  // SMS KPI Stats
  const smsStats = useMemo(() => {
    const total = smsLogs.length;
    const successful = smsLogs.filter((l) => l.status === 'sent' || l.status === 'delivered').length;
    const failed = smsLogs.filter((l) => l.status === 'failed').length;
    const totalUnits = smsLogs.reduce((acc, l) => acc + (l.units || 1), 0);
    const totalCost = smsLogs.reduce((acc, l) => acc + Number(l.estimated_cost || 0), 0);
    return {
      total,
      successful,
      failed,
      totalUnits,
      totalCost,
    };
  }, [smsLogs]);

  // WhatsApp KPI Stats
  const whatsappStats = useMemo(() => {
    const total = whatsappShares.length;
    const pdfGenerated = whatsappShares.filter((s) => s.status === 'pdf_generated').length;
    const opened = whatsappShares.filter((s) => s.status === 'whatsapp_opened').length;
    const markedSent = whatsappShares.filter((s) => s.status === 'marked_as_sent').length;
    return {
      total,
      pdfGenerated,
      opened,
      markedSent,
    };
  }, [whatsappShares]);

  // Filtered SMS Logs
  const filteredSmsLogs = useMemo(() => {
    return smsLogs.filter((log) => {
      if (statusFilter !== 'all' && log.status !== statusFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchName = log.recipient_name.toLowerCase().includes(q);
        const matchPhone = log.recipient_phone.toLowerCase().includes(q);
        const matchMsg = log.message.toLowerCase().includes(q);
        if (!matchName && !matchPhone && !matchMsg) return false;
      }
      if (dateFrom && log.created_at < dateFrom) return false;
      if (dateTo && log.created_at > dateTo + 'T23:59:59') return false;
      return true;
    });
  }, [smsLogs, statusFilter, searchQuery, dateFrom, dateTo]);

  // Filtered WhatsApp Shares
  const filteredWhatsAppShares = useMemo(() => {
    return whatsappShares.filter((share) => {
      if (statusFilter !== 'all' && share.status !== statusFilter) return false;
      if (classFilter !== 'all' && share.class_id !== classFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const stu = studentsMap.get(share.student_id);
        const studentName = stu ? `${stu.first_name} ${stu.last_name}`.toLowerCase() : '';
        const matchParent = share.parent_name.toLowerCase().includes(q);
        const matchPhone = share.parent_phone.toLowerCase().includes(q);
        if (!studentName.includes(q) && !matchParent && !matchPhone) return false;
      }
      if (dateFrom && share.created_at < dateFrom) return false;
      if (dateTo && share.created_at > dateTo + 'T23:59:59') return false;
      return true;
    });
  }, [whatsappShares, statusFilter, classFilter, searchQuery, dateFrom, dateTo, studentsMap]);

  // Status badge helper
  const renderSmsStatusBadge = (status: string) => {
    switch (status) {
      case 'delivered':
      case 'sent':
        return <Badge tone="good">{status.toUpperCase()}</Badge>;
      case 'pending':
        return <Badge tone="warn">PENDING</Badge>;
      case 'failed':
        return <Badge tone="bad">FAILED</Badge>;
      default:
        return <Badge tone="neutral">{status}</Badge>;
    }
  };

  const renderWhatsAppStatusBadge = (status: string) => {
    switch (status) {
      case 'marked_as_sent':
        return <Badge tone="good">Marked as Sent ✓</Badge>;
      case 'whatsapp_opened':
        return <Badge tone="warn">WhatsApp Opened</Badge>;
      case 'pdf_generated':
        return <Badge tone="info">PDF Generated</Badge>;
      default:
        return <Badge tone="neutral">{status}</Badge>;
    }
  };

  // Toggle marked_as_sent for WhatsApp
  const updateShareStatusMutation = useMutation({
    mutationFn: async ({ id, newStatus }: { id: string; newStatus: 'marked_as_sent' | 'whatsapp_opened' }) => {
      const { error } = await supabase
        .from('whatsapp_report_shares')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['whatsapp_shares_history', schoolId] });
      toast('Share status updated!');
    },
    onError: (err) => {
      toast(friendlyError(err), 'error');
    },
  });

  return (
    <div>
      <PageHeader
        title="Communication & Message History"
        subtitle="Audit logs and delivery records for Bulk SMS broadcasts and WhatsApp manual report card shares."
      />

      {/* TABS */}
      <div style={{ display: 'flex', gap: 10, borderBottom: '2px solid var(--line)', marginBottom: 20 }}>
        {isHeadmaster && (
          <button
            type="button"
            className={`tab-btn ${activeTab === 'sms' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('sms');
              setStatusFilter('all');
            }}
            style={{
              padding: '10px 18px',
              border: 'none',
              background: 'none',
              fontWeight: 600,
              cursor: 'pointer',
              borderBottom: activeTab === 'sms' ? '3px solid var(--green-600)' : '3px solid transparent',
              color: activeTab === 'sms' ? 'var(--green-700)' : 'var(--muted)',
            }}
          >
            💬 Bulk SMS History ({smsLogs.length})
          </button>
        )}
        <button
          type="button"
          className={`tab-btn ${activeTab === 'whatsapp' ? 'active' : ''}`}
          onClick={() => {
            setActiveTab('whatsapp');
            setStatusFilter('all');
          }}
          style={{
            padding: '10px 18px',
            border: 'none',
            background: 'none',
            fontWeight: 600,
            cursor: 'pointer',
            borderBottom: activeTab === 'whatsapp' ? '3px solid var(--green-600)' : '3px solid transparent',
            color: activeTab === 'whatsapp' ? 'var(--green-700)' : 'var(--muted)',
          }}
        >
          📲 WhatsApp Report Card Shares ({whatsappShares.length})
        </button>
      </div>

      {/* KPI METRIC CARDS */}
      {activeTab === 'sms' && isHeadmaster && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 20 }}>
          <StatCard label="Total SMS Sent" value={smsStats.total} hint="All time logs" />
          <StatCard label="Successful Messages" value={smsStats.successful} tone="good" hint="Delivered by carrier" />
          <StatCard label="Failed Messages" value={smsStats.failed} tone={smsStats.failed > 0 ? 'bad' : undefined} hint="Missing phone or gateway error" />
          <StatCard label="Total Units & Cost" value={`GHS ${smsStats.totalCost.toFixed(2)}`} hint={`${smsStats.totalUnits} carrier units`} />
        </div>
      )}

      {activeTab === 'whatsapp' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 20 }}>
          <StatCard label="Total Report Card Shares" value={whatsappStats.total} hint="Individual sessions" />
          <StatCard label="Marked as Sent" value={whatsappStats.markedSent} tone="good" hint="Confirmed by teacher" />
          <StatCard label="WhatsApp Opened" value={whatsappStats.opened} tone="warn" hint="Awaiting confirmation" />
          <StatCard label="PDFs Generated" value={whatsappStats.pdfGenerated} hint="Ready to attach" />
        </div>
      )}

      {/* FILTERS */}
      <div style={{ marginBottom: 20 }}>
        <Card>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, alignItems: 'end' }}>
          <div>
            <label style={{ fontSize: '0.82rem', fontWeight: 600, display: 'block', marginBottom: 4 }}>Search</label>
            <Input
              label=""
              placeholder="Search recipient, student or phone..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div>
            <label style={{ fontSize: '0.82rem', fontWeight: 600, display: 'block', marginBottom: 4 }}>Status</label>
            <Select
              label=""
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">All Statuses</option>
              {activeTab === 'sms' ? (
                <>
                  <option value="sent">Sent</option>
                  <option value="delivered">Delivered</option>
                  <option value="failed">Failed</option>
                  <option value="pending">Pending</option>
                </>
              ) : (
                <>
                  <option value="marked_as_sent">Marked as Sent</option>
                  <option value="whatsapp_opened">WhatsApp Opened</option>
                  <option value="pdf_generated">PDF Generated</option>
                </>
              )}
            </Select>
          </div>

          {activeTab === 'whatsapp' && (
            <div>
              <label style={{ fontSize: '0.82rem', fontWeight: 600, display: 'block', marginBottom: 4 }}>Filter by Class</label>
              <Select
                label=""
                value={classFilter}
                onChange={(e) => setClassFilter(e.target.value)}
              >
                <option value="all">All Classes</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>{classLabel(c)}</option>
                ))}
              </Select>
            </div>
          )}

          <div>
            <label style={{ fontSize: '0.82rem', fontWeight: 600, display: 'block', marginBottom: 4 }}>From Date</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              style={{ width: '100%', height: 38, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--line)' }}
            />
          </div>

          <div>
            <label style={{ fontSize: '0.82rem', fontWeight: 600, display: 'block', marginBottom: 4 }}>To Date</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              style={{ width: '100%', height: 38, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--line)' }}
            />
          </div>
        </div>
      </Card>
      </div>

      {/* SMS LOGS TABLE */}
      {activeTab === 'sms' && isHeadmaster && (
        <Card title={`SMS Broadcast Records (${filteredSmsLogs.length})`}>
          {smsLogsQuery.isLoading ? (
            <Spinner />
          ) : filteredSmsLogs.length === 0 ? (
            <EmptyState title="No SMS logs found">
              No messages match your filters or no bulk SMS broadcasts have been dispatched yet.
            </EmptyState>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--line)', background: 'var(--bg)' }}>
                    <th style={{ padding: '10px 12px', textAlign: 'left' }}>Date & Time</th>
                    <th style={{ padding: '10px 12px', textAlign: 'left' }}>Recipient</th>
                    <th style={{ padding: '10px 12px', textAlign: 'left' }}>Phone Number</th>
                    <th style={{ padding: '10px 12px', textAlign: 'left' }}>Message Content</th>
                    <th style={{ padding: '10px 12px', textAlign: 'center' }}>Units</th>
                    <th style={{ padding: '10px 12px', textAlign: 'right' }}>Est. Cost</th>
                    <th style={{ padding: '10px 12px', textAlign: 'center' }}>Status</th>
                    <th style={{ padding: '10px 12px', textAlign: 'left' }}>Error Details</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSmsLogs.map((log) => (
                    <tr key={log.id} style={{ borderBottom: '1px solid var(--line)' }}>
                      <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                        {formatDateTime(log.created_at)}
                      </td>
                      <td style={{ padding: '10px 12px', fontWeight: 600 }}>
                        {log.recipient_name}
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <span className="mono">{log.recipient_phone}</span>
                      </td>
                      <td style={{ padding: '10px 12px', maxWidth: 320, whiteSpace: 'pre-wrap', lineHeight: 1.35 }}>
                        {log.message}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                        {log.units || 1}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                        GHS {Number(log.estimated_cost || 0).toFixed(2)}
                      </td>
                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                        {renderSmsStatusBadge(log.status)}
                      </td>
                      <td style={{ padding: '10px 12px', color: 'var(--amber-800)', fontSize: '0.8rem' }}>
                        {log.error_message || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* WHATSAPP SHARES TABLE */}
      {activeTab === 'whatsapp' && (
        <Card title={`WhatsApp Report Card Shares (${filteredWhatsAppShares.length})`}>
          {whatsappSharesQuery.isLoading ? (
            <Spinner />
          ) : filteredWhatsAppShares.length === 0 ? (
            <EmptyState title="No WhatsApp report card shares found">
              No report cards have been shared via WhatsApp matching your filters.
            </EmptyState>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--line)', background: 'var(--bg)' }}>
                    <th style={{ padding: '10px 12px', textAlign: 'left' }}>Date Shared</th>
                    <th style={{ padding: '10px 12px', textAlign: 'left' }}>Student Name</th>
                    <th style={{ padding: '10px 12px', textAlign: 'left' }}>Class</th>
                    <th style={{ padding: '10px 12px', textAlign: 'left' }}>Parent / Guardian</th>
                    <th style={{ padding: '10px 12px', textAlign: 'left' }}>Parent WhatsApp</th>
                    <th style={{ padding: '10px 12px', textAlign: 'left' }}>Exam / Semester</th>
                    <th style={{ padding: '10px 12px', textAlign: 'center' }}>Share Status</th>
                    <th style={{ padding: '10px 12px', textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredWhatsAppShares.map((share) => {
                    const stu = studentsMap.get(share.student_id);
                    const cls = classesMap.get(share.class_id);
                    const sem = semestersMap.get(share.semester_id);
                    return (
                      <tr key={share.id} style={{ borderBottom: '1px solid var(--line)' }}>
                        <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                          {formatDateTime(share.created_at)}
                        </td>
                        <td style={{ padding: '10px 12px', fontWeight: 600 }}>
                          {stu ? `${stu.last_name}, ${stu.first_name}` : 'Student Record'}
                          {stu?.admission_number && (
                            <div className="small muted mono">{stu.admission_number}</div>
                          )}
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          {cls ? classLabel(cls) : 'Class'}
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          {share.parent_name}
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          <span className="mono">{share.parent_phone}</span>
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          {sem?.name || 'Academic Term'}
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                          {renderWhatsAppStatusBadge(share.status)}
                        </td>
                        <td style={{ padding: '10px 12px', textAlign: 'right' }}>
                          {share.status !== 'marked_as_sent' ? (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() =>
                                updateShareStatusMutation.mutate({
                                  id: share.id,
                                  newStatus: 'marked_as_sent',
                                })
                              }
                            >
                              ✓ Mark Sent
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                updateShareStatusMutation.mutate({
                                  id: share.id,
                                  newStatus: 'whatsapp_opened',
                                })
                              }
                              title="Revert back to WhatsApp Opened"
                            >
                              Undo Sent
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
