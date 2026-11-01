import React from 'react';
import Link from 'next/link';

interface LegalLayoutProps {
  title: string;
  lastUpdated: string;
  children: React.ReactNode;
}

export function LegalLayout({ title, lastUpdated, children }: LegalLayoutProps) {
  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8 text-gray-900 font-sans">
      <div className="max-w-3xl mx-auto bg-white p-8 sm:p-12 rounded-xl shadow-sm border border-gray-200">
        <div className="mb-8 border-b border-gray-200 pb-6">
          <Link
            href="/login"
            className="inline-flex items-center text-sm font-medium text-emerald-700 hover:text-emerald-800 transition-colors mb-6 group"
          >
            <span className="mr-2 transform group-hover:-translate-x-1 transition-transform">←</span>
            Back to login
          </Link>
          <h1 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
            {title}
          </h1>
          <p className="mt-2 text-sm text-gray-500">
            Last updated: {lastUpdated}
          </p>
        </div>
        <div className="prose prose-emerald max-w-none text-gray-700 leading-relaxed space-y-6">
          {children}
        </div>
      </div>
    </div>
  );
}

export default LegalLayout;
