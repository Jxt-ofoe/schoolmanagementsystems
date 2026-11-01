// components/headmaster-signup-form.tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';

interface HeadmasterSignupFormProps {
  onSuccess?: (schoolId: string) => void;
  onSubmit?: (data: {
    schoolName: string;
    schoolCode: string;
    headmasterName: string;
    email: string;
    password?: string;
    acceptedTermsAt: string;
    termsVersion: string;
  }) => Promise<void>;
}

export function HeadmasterSignupForm({ onSuccess, onSubmit }: HeadmasterSignupFormProps) {
  const [schoolName, setSchoolName] = useState('');
  const [schoolCode, setSchoolCode] = useState('');
  const [headmasterName, setHeadmasterName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!agreedToTerms) {
      setError('You must agree to the Terms & Conditions and Privacy Policy to create your account.');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }

    setLoading(true);
    try {
      const acceptedTermsAt = new Date().toISOString();
      const termsVersion = 'v1.0';

      if (onSubmit) {
        await onSubmit({
          schoolName,
          schoolCode,
          headmasterName,
          email,
          password,
          acceptedTermsAt,
          termsVersion,
        });
      } else {
        // Default API request format
        const res = await fetch('/api/schools/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: schoolName,
            code: schoolCode,
            headmaster_name: headmasterName,
            email,
            password,
            acceptedTermsAt,
            termsVersion,
          }),
        });

        if (!res.ok) {
          const data = await res.json().catch(() => null);
          throw new Error(data?.message || 'Failed to create school and headmaster account');
        }

        const created = await res.json();
        onSuccess?.(created.id);
      }
    } catch (err: any) {
      setError(err?.message || 'An error occurred during registration.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4 max-w-lg mx-auto bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
      <h2 className="text-xl font-bold text-slate-900">Register School &amp; Headmaster</h2>

      {error && (
        <div className="p-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg">
          {error}
        </div>
      )}

      <div>
        <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
          School Name
        </label>
        <input
          type="text"
          required
          value={schoolName}
          onChange={(e) => {
            setSchoolName(e.target.value);
            if (!schoolCode) {
              setSchoolCode(e.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
            }
          }}
          placeholder="e.g. Saint Dominic Savio Academy"
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
        />
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
          School Code
        </label>
        <input
          type="text"
          required
          value={schoolCode}
          onChange={(e) => setSchoolCode(e.target.value.toLowerCase())}
          placeholder="e.g. saint-dominic-savio"
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-emerald-600"
        />
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
          Headmaster Full Name
        </label>
        <input
          type="text"
          required
          value={headmasterName}
          onChange={(e) => setHeadmasterName(e.target.value)}
          placeholder="e.g. Mr. Kwesi Mensah"
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
        />
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
          Headmaster Email
        </label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="e.g. headmaster@school.com"
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
        />
      </div>

      <div>
        <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
          Headmaster Password
        </label>
        <input
          type="password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Minimum 8 characters"
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-600"
        />
      </div>

      {/* Required Checkbox for Terms & Conditions and Privacy Policy */}
      <div className="pt-2">
        <label className="flex items-start gap-3 cursor-pointer select-none">
          <input
            type="checkbox"
            required
            checked={agreedToTerms}
            onChange={(e) => setAgreedToTerms(e.target.checked)}
            className="mt-1 h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
          />
          <span className="text-xs text-slate-600 leading-relaxed">
            I agree to the{' '}
            <Link
              href="/terms"
              target="_blank"
              rel="noopener noreferrer"
              className="text-emerald-700 underline font-medium hover:text-emerald-800"
            >
              Terms &amp; Conditions
            </Link>{' '}
            and{' '}
            <Link
              href="/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="text-emerald-700 underline font-medium hover:text-emerald-800"
            >
              Privacy Policy
            </Link>
            .
          </span>
        </label>
      </div>

      <button
        type="submit"
        disabled={!agreedToTerms || loading}
        className="w-full py-2.5 px-4 bg-emerald-700 hover:bg-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium text-sm rounded-lg transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
      >
        {loading ? 'Creating School Account…' : 'Register School & Headmaster'}
      </button>
    </form>
  );
}
