import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../lib/auth';
import { useSchoolDetails } from '../../lib/queries';
import { useToast } from '../../lib/toast';
import { friendlyError } from '../../lib/errors';
import type { CommunicationSettings, MessageTemplate } from '../../lib/types';
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
  PageHeader,
} from '../../components/ui';

export default function CommunicationSettingsPage() {
  const { ctx, active, session } = useAuth();
  const schoolId = active?.school_id;
  const isSuperAdmin = !!ctx?.is_super_admin;
  const qc = useQueryClient();
  const toast = useToast();

  const schoolQuery = useSchoolDetails(schoolId);

  // Settings state
  const [useCustomGateway, setUseCustomGateway] = useState(false);
  const [provider, setProvider] = useState<'arkesel' | 'hubtel' | 'custom'>('arkesel');
  const [senderId, setSenderId] = useState('SchoolMS');
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [signature, setSignature] = useState('');
  const [ratePerUnit, setRatePerUnit] = useState('0.05');
  const [isEnabled, setIsEnabled] = useState(true);

  // Template Modal state
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<MessageTemplate | null>(null);
  const [tplName, setTplName] = useState('');
  const [tplCategory, setTplCategory] = useState<'exam' | 'report_card' | 'fee' | 'attendance' | 'general'>('general');
  const [tplContent, setTplContent] = useState('');

  // Test SMS state
  const [testModalOpen, setTestModalOpen] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [testMessage, setTestMessage] = useState('This is a test SMS from your School Management System.');

  // 1. Fetch Communication Settings
  const settingsQuery = useQuery({
    queryKey: ['communication_settings', schoolId],
    enabled: !!schoolId,
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from('communication_settings')
          .select('*')
          .eq('school_id', schoolId!)
          .maybeSingle();
        if (error) {
          console.warn('communication_settings query warning:', error.message);
          return null;
        }
        return data as CommunicationSettings | null;
      } catch {
        return null;
      }
    },
  });

  // 2. Fetch Templates
  const templatesQuery = useQuery({
    queryKey: ['message_templates', schoolId],
    enabled: !!schoolId,
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from('message_templates')
          .select('*')
          .eq('school_id', schoolId!)
          .order('category')
          .order('name');
        if (error) {
          console.warn('message_templates query warning:', error.message);
          return [] as MessageTemplate[];
        }
        return (data ?? []) as MessageTemplate[];
      } catch {
        return [] as MessageTemplate[];
      }
    },
  });

  // Populate settings form when loaded
  useEffect(() => {
    if (settingsQuery.data) {
      const s = settingsQuery.data;
      setProvider(s.provider || 'arkesel');
      setSenderId(s.sms_sender_id || 'SchoolMS');
      setSignature(s.school_signature || (schoolQuery.data ? `— ${schoolQuery.data.name}` : ''));
      setRatePerUnit(String(s.sms_rate_per_unit || 0.05));
      setIsEnabled(s.is_sms_enabled ?? true);
      if (s.sms_api_key) {
        setUseCustomGateway(true);
        setApiKey('••••••••' + s.sms_api_key.slice(-4));
      } else {
        setUseCustomGateway(false);
        setApiKey('');
      }
      if (s.sms_api_secret) {
        setApiSecret('••••••••' + s.sms_api_secret.slice(-4));
      } else {
        setApiSecret('');
      }
    } else if (schoolQuery.data) {
      // Defaults: Shared SaaS Sender ID
      setSenderId('SchoolMS');
      setSignature(`— ${schoolQuery.data.name}`);
    }
  }, [settingsQuery.data, schoolQuery.data]);

  // Save Settings Mutation
  const saveSettingsMutation = useMutation({
    mutationFn: async () => {
      if (!schoolId) throw new Error('No active school found');

      const isKeyMasked = apiKey.startsWith('••••••••');
      const isSecretMasked = apiSecret.startsWith('••••••••');

      const payload: any = {
        school_id: schoolId,
        provider: useCustomGateway ? provider : 'arkesel',
        sms_sender_id: senderId.trim() || 'SchoolMS',
        school_signature: signature.trim() || null,
        sms_rate_per_unit: Number(ratePerUnit) || 0.05,
        is_sms_enabled: isEnabled,
        updated_at: new Date().toISOString(),
      };

      if (useCustomGateway) {
        if (!isKeyMasked && apiKey.trim()) {
          payload.sms_api_key = apiKey.trim();
        }
        if (!isSecretMasked && apiSecret.trim()) {
          payload.sms_api_secret = apiSecret.trim();
        }
      } else {
        // Clear private keys to use shared SaaS gateway
        payload.sms_api_key = null;
        payload.sms_api_secret = null;
      }

      const { data, error } = await supabase
        .from('communication_settings')
        .upsert(payload, { onConflict: 'school_id' })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast('Communication settings saved securely!');
      qc.invalidateQueries({ queryKey: ['communication_settings', schoolId] });
    },
    onError: (err) => {
      toast(friendlyError(err), 'error');
    },
  });

  // Template Save / Update Mutation
  const saveTemplateMutation = useMutation({
    mutationFn: async () => {
      if (!tplName.trim() || !tplContent.trim() || !schoolId) {
        throw new Error('Please fill in both template name and message content.');
      }

      if (editingTemplate) {
        const { error } = await supabase
          .from('message_templates')
          .update({
            name: tplName.trim(),
            category: tplCategory,
            content: tplContent.trim(),
            updated_at: new Date().toISOString(),
          })
          .eq('id', editingTemplate.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('message_templates').insert({
          school_id: schoolId,
          name: tplName.trim(),
          category: tplCategory,
          content: tplContent.trim(),
          is_default: false,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast(editingTemplate ? 'Template updated!' : 'New template created!');
      setTemplateModalOpen(false);
      setEditingTemplate(null);
      setTplName('');
      setTplContent('');
      qc.invalidateQueries({ queryKey: ['message_templates', schoolId] });
    },
    onError: (err) => {
      toast(friendlyError(err), 'error');
    },
  });

  // Delete Template Mutation
  const deleteTemplateMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('message_templates').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast('Template deleted');
      qc.invalidateQueries({ queryKey: ['message_templates', schoolId] });
    },
    onError: (err) => {
      toast(friendlyError(err), 'error');
    },
  });

  // Seed Default Templates Mutation
  const seedDefaultsMutation = useMutation({
    mutationFn: async () => {
      if (!schoolId) return;
      const { error } = await supabase.rpc('seed_default_communication_templates', {
        p_school_id: schoolId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast('Default Ghana school templates added!');
      qc.invalidateQueries({ queryKey: ['message_templates', schoolId] });
    },
    onError: (err) => {
      toast(friendlyError(err), 'error');
    },
  });

  // Test SMS Dispatch Mutation
  const testSmsMutation = useMutation({
    mutationFn: async () => {
      if (!session?.access_token) throw new Error('Session expired');
      if (!testPhone.trim()) throw new Error('Please enter a recipient test phone number');

      const res = await fetch('/api/communication/send-sms', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          school_id: schoolId,
          title: 'Gateway Test Message',
          filter_type: 'selected',
          message: testMessage,
          recipients: [
            {
              student_id: null,
              name: 'School Administrator',
              phone: testPhone.trim(),
              personalized_message: testMessage,
            },
          ],
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Test SMS dispatch failed');
      }
      return data;
    },
    onSuccess: (data) => {
      toast(`Test SMS dispatched via ${data.provider}! Successful: ${data.successful}, Failed: ${data.failed}`);
      setTestModalOpen(false);
      qc.invalidateQueries({ queryKey: ['sms_logs', schoolId] });
    },
    onError: (err) => {
      toast(friendlyError(err), 'error');
    },
  });

  const templates = templatesQuery.data ?? [];

  return (
    <div>
      <PageHeader
        title="Communication & SMS Gateway Settings"
        subtitle="Configure SMS providers (Arkesel, Hubtel), manage reusable message templates, and school signatures."
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setTestModalOpen(true)}
          >
            🧪 Test SMS Gateway
          </Button>
        }
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 1.1fr) minmax(320px, 1.2fr)', gap: 20, alignItems: 'start' }}>
        {/* LEFT COLUMN: SMS GATEWAY CREDENTIALS */}
        <Card title="SMS Gateway Configuration">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              saveSettingsMutation.mutate();
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* SHARED SAAS GATEWAY BANNER */}
              <div style={{ background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: 8, padding: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: '1.2rem' }}>🌐</span>
                    <strong style={{ color: 'var(--green-900)', fontSize: '0.98rem' }}>SaaS Shared SMS Gateway</strong>
                  </div>
                  <Badge tone="good">Shared Gateway</Badge>
                </div>
                <p style={{ fontSize: '0.84rem', color: 'var(--ink-2)', margin: '0 0 10px 0', lineHeight: 1.45 }}>
                  This system operates using a single verified, telecom-registered shared SMS Sender ID: <strong>{senderId || 'SchoolMS'}</strong>.
                  Individual schools do not need to register a separate telecom Sender ID or maintain private SMS gateway API keys.
                </p>
                <div style={{ fontSize: '0.82rem', color: 'var(--muted)', background: '#fff', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--line)' }}>
                  📱 Parents will receive SMS messages from <strong>{senderId || 'SchoolMS'}</strong>. Your school's identity is clearly certified using your official signature below.
                </div>
              </div>

              {isSuperAdmin && (
                <div style={{ background: '#f8fafc', padding: 12, borderRadius: 6, border: '1px dashed var(--line)' }}>
                  <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--green-800)', marginBottom: 6 }}>
                    ⭐ Platform Super Admin Mode: Shared Sender ID
                  </div>
                  <Input
                    label="Platform Shared Sender ID"
                    value={senderId}
                    maxLength={11}
                    onChange={(e) => setSenderId(e.target.value.toUpperCase())}
                    placeholder="e.g. SchoolMS"
                    hint="Global Sender ID used across all tenant schools (max 11 chars)."
                  />
                </div>
              )}

              <Input
                label="Official School Message Signature"
                value={signature}
                onChange={(e) => setSignature(e.target.value)}
                placeholder="e.g. — Management, St. Peter's School"
                hint="Appended to notifications so parents recognize your school."
                required
              />

              <Input
                label="Estimated Cost per SMS Unit (GHS)"
                type="number"
                step="0.001"
                min="0.01"
                value={ratePerUnit}
                onChange={(e) => setRatePerUnit(e.target.value)}
                hint="Used to calculate budget estimates before dispatch (e.g. GHS 0.05 per SMS)."
              />

              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input
                  type="checkbox"
                  id="smsEnabledToggle"
                  checked={isEnabled}
                  onChange={(e) => setIsEnabled(e.target.checked)}
                />
                <label htmlFor="smsEnabledToggle" style={{ fontSize: '0.88rem', fontWeight: 600, cursor: 'pointer' }}>
                  Enable SMS Gateway Dispatching for this School
                </label>
              </div>

              {/* Advanced Custom Gateway Collapsible */}
              <div style={{ paddingTop: 8, borderTop: '1px solid var(--line)' }}>
                <button
                  type="button"
                  onClick={() => setUseCustomGateway(!useCustomGateway)}
                  style={{
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    fontSize: '0.82rem',
                    color: 'var(--muted)',
                    cursor: 'pointer',
                    textDecoration: 'underline',
                  }}
                >
                  {useCustomGateway ? '▲ Hide Custom Gateway Settings' : '▼ Advanced: Use Private SMS Gateway Account (Optional)'}
                </button>

                {useCustomGateway && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12, background: 'var(--bg)', padding: 12, borderRadius: 6, border: '1px solid var(--line)' }}>
                    <Alert tone="warn">
                      <strong>Custom Gateway:</strong> Only enable if your school has registered its own dedicated Sender ID with Arkesel/Hubtel. Otherwise, leave disabled to use the SaaS shared gateway.
                    </Alert>

                    <Select
                      label="Custom SMS Provider"
                      value={provider}
                      onChange={(e) => setProvider(e.target.value as any)}
                    >
                      <option value="arkesel">Arkesel SMS (Ghana v2)</option>
                      <option value="hubtel">Hubtel SMS (Ghana)</option>
                      <option value="custom">Simulation / Custom Testing</option>
                    </Select>

                    <Input
                      label="Private Sender ID"
                      value={senderId}
                      maxLength={11}
                      onChange={(e) => setSenderId(e.target.value.toUpperCase())}
                      placeholder="e.g. MYSCHOOL"
                    />

                    <Input
                      label="Private API Key / Client ID"
                      type="password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="Paste private API Key"
                    />

                    {provider === 'hubtel' && (
                      <Input
                        label="Hubtel API Client Secret"
                        type="password"
                        value={apiSecret}
                        onChange={(e) => setApiSecret(e.target.value)}
                        placeholder="Paste Hubtel API Secret"
                      />
                    )}
                  </div>
                )}
              </div>

              <div style={{ marginTop: 8 }}>
                <Button
                  variant="primary"
                  type="submit"
                  loading={saveSettingsMutation.isPending}
                  style={{ width: '100%', justifyContent: 'center' }}
                >
                  💾 Save SMS Settings
                </Button>
              </div>
            </div>
          </form>
        </Card>

        {/* RIGHT COLUMN: REUSABLE MESSAGE TEMPLATES */}
        <Card
          title={
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
              <span>Message Templates ({templates.length})</span>
            </div>
          }
          actions={
            <div style={{ display: 'flex', gap: 6 }}>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => seedDefaultsMutation.mutate()}
                loading={seedDefaultsMutation.isPending}
                title="Restore default pre-packaged Ghana templates"
              >
                🔄 Restore Defaults
              </Button>
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  setEditingTemplate(null);
                  setTplName('');
                  setTplCategory('general');
                  setTplContent('');
                  setTemplateModalOpen(true);
                }}
              >
                + New Template
              </Button>
            </div>
          }
        >
          {templatesQuery.isLoading ? (
            <Spinner />
          ) : templates.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 24 }}>
              <p className="muted" style={{ marginBottom: 12 }}>
                No templates saved yet. Click below to load standard templates for examinations, report cards, fees, and attendance.
              </p>
              <Button
                variant="primary"
                size="sm"
                onClick={() => seedDefaultsMutation.mutate()}
                loading={seedDefaultsMutation.isPending}
              >
                Load Default School Templates
              </Button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {templates.map((tpl) => (
                <div
                  key={tpl.id}
                  style={{
                    padding: 12,
                    background: 'var(--bg)',
                    border: '1px solid var(--line)',
                    borderRadius: 6,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                    <div>
                      <strong style={{ fontSize: '0.92rem' }}>{tpl.name}</strong>
                      <span style={{ marginLeft: 8 }}>
                        <Badge tone="neutral">{tpl.category.toUpperCase()}</Badge>
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditingTemplate(tpl);
                          setTplName(tpl.name);
                          setTplCategory(tpl.category);
                          setTplContent(tpl.content);
                          setTemplateModalOpen(true);
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          if (confirm(`Delete template "${tpl.name}"?`)) {
                            deleteTemplateMutation.mutate(tpl.id);
                          }
                        }}
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                  <div style={{ fontSize: '0.84rem', color: 'var(--ink-2)', whiteSpace: 'pre-wrap', lineHeight: 1.35 }}>
                    {tpl.content}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* CREATE / EDIT TEMPLATE MODAL */}
      <Modal
        open={templateModalOpen}
        title={editingTemplate ? 'Edit Message Template' : 'Create New Message Template'}
        onClose={() => setTemplateModalOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setTemplateModalOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => saveTemplateMutation.mutate()}
              loading={saveTemplateMutation.isPending}
            >
              {editingTemplate ? 'Update Template' : 'Save Template'}
            </Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Input
            label="Template Name"
            placeholder="e.g. End of Term Exam Reminder"
            value={tplName}
            onChange={(e) => setTplName(e.target.value)}
            required
          />
          <Select
            label="Category"
            value={tplCategory}
            onChange={(e) => setTplCategory(e.target.value as any)}
          >
            <option value="exam">Examination Announcements</option>
            <option value="report_card">Report Card Notifications</option>
            <option value="fee">Fee Reminders</option>
            <option value="attendance">Attendance Notifications</option>
            <option value="general">General School Announcements</option>
          </Select>
          <Textarea
            label="Message Template Content"
            rows={5}
            value={tplContent}
            onChange={(e) => setTplContent(e.target.value)}
            hint="You can use {parent_name}, {student_name}, {class_name}, {school_name}, and {exam_name}."
            required
          />
        </div>
      </Modal>

      {/* TEST SMS MODAL */}
      <Modal
        open={testModalOpen}
        title="Send Test SMS via Gateway"
        onClose={() => setTestModalOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setTestModalOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => testSmsMutation.mutate()}
              loading={testSmsMutation.isPending}
              disabled={!testPhone.trim()}
            >
              Send Test SMS
            </Button>
          </>
        }
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Alert tone="info">
            Send a single test message to your personal mobile number to verify that your Sender ID and API credentials are authentic.
          </Alert>
          <Input
            label="Test Recipient Phone Number"
            placeholder="e.g. 0244123456 or +233244123456"
            value={testPhone}
            onChange={(e) => setTestPhone(e.target.value)}
            required
          />
          <Textarea
            label="Test Message Text"
            rows={3}
            value={testMessage}
            onChange={(e) => setTestMessage(e.target.value)}
          />
        </div>
      </Modal>
    </div>
  );
}
