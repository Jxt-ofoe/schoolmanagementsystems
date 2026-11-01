// TODO: Have a lawyer review before launch.
import React from 'react';
import { LegalLayout } from '../legal-layout';

export const metadata = {
  title: 'Terms & Conditions | Acadex',
  description: 'Terms and Conditions governing the use of the Acadex school management SaaS platform.',
};

export default function TermsAndConditionsPage() {
  return (
    <LegalLayout title="Terms & Conditions" lastUpdated="November 1, 2026">
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-900">1. Acceptance of Terms</h2>
        <p>
          These Terms &amp; Conditions (&ldquo;Terms&rdquo;) form a legally binding agreement between Acadex (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;) and the subscribing educational institution (&ldquo;School,&rdquo; &ldquo;you,&rdquo; or &ldquo;your&rdquo;).
        </p>
        <p>
          By signing in, creating a school account, or using Acadex, the Headmaster or authorized school representative confirms acceptance of these Terms and our Privacy Policy.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-900">2. Accounts, Access Control &amp; Data Privacy</h2>
        <p>
          <strong>Acadex personnel do not have access to your school&rsquo;s staff data, student records, continuous assessments, or guardian emergency contacts.</strong> Full administrative access and control is held exclusively by the school&rsquo;s Headmaster.
        </p>
        <p>
          The Headmaster is responsible for creating and managing teacher accounts, assigning classes/subjects, and promptly deactivating credentials for departing teachers. Students and parents have no direct system access.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-900">3. School Responsibilities &amp; Parental Consent</h2>
        <p>
          The School operates as the Data Controller under the Ghana Data Protection Act, 2012 (Act 843).
        </p>
        <p>
          The School warrants that it has lawful authority to record student and guardian details and must obtain parent/guardian consent upon student enrollment. The School is solely responsible for ensuring the accuracy of all grades, attendance records, and student information entered into Acadex.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-900">4. Acceptable Use</h2>
        <p>
          You agree to use Acadex strictly for lawful school management and educational purposes. You agree not to attempt unauthorized access to other schools&rsquo; records, reverse-engineer the system, introduce malicious scripts, or misuse bulk messaging features.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-900">5. Data Ownership</h2>
        <p>
          The School retains 100% intellectual property and legal ownership of all student records, examination marks, and attendance data entered into the platform. Acadex claims no ownership over your data and uses it strictly to deliver the cloud software to you.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-900">6. Availability and Backups</h2>
        <p>
          Acadex provides regular encrypted database backups and works to maximize system availability (targeting 99.5% uptime during active academic terms). However, the service is provided on a reliable &ldquo;as is&rdquo; basis, excluding telecom or regional internet failures outside our control.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-900">7. Fees and Payment</h2>
        <p>
          Subscription pricing is billed per registered student per academic semester. Payment methods include Mobile Money (MTN, Telecel, AT) and Bank Transfer. Schools are provided a fourteen (14) day grace period after invoice generation before overdue accounts may be temporarily suspended.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-900">8. Termination, Data Export and Deletion</h2>
        <p>
          Either party may terminate subscription services with thirty (30) days notice. Prior to termination, the Headmaster may freely export all student, attendance, and grade records (in CSV or PDF formats). Within thirty (30) days following termination, all school records will be permanently erased from active production databases.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-900">9. Limitation of Liability</h2>
        <p>
          To the fullest extent permitted by Ghanaian law, Acadex shall not be liable for indirect, incidental, or consequential damages. Total liability is capped at the total subscription fees paid by the School in the preceding twelve (12) months.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-900">10. Governing Law &amp; Jurisdiction</h2>
        <p>
          These Terms are governed by and construed in accordance with the laws of the Republic of Ghana, including the Data Protection Act, 2012 (Act 843). Any disputes shall be submitted to the exclusive jurisdiction of the courts of Ghana.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-900">11. Changes to Terms &amp; Contact Details</h2>
        <p>
          We may update these Terms periodically with advance notice to Headmasters. Continued use of the platform constitutes acceptance. For inquiries, contact:
        </p>
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-1 text-sm text-gray-700">
          <p><strong>Platform:</strong> Acadex</p>
          <p><strong>Operator:</strong> Acadex</p>
          <p><strong>Location:</strong> Accra, Ghana</p>
          <p><strong>Support Email:</strong> <a href="mailto:support@acadex.com" className="text-emerald-700 underline font-medium">support@acadex.com</a></p>
          <p><strong>Jurisdiction:</strong> Republic of Ghana</p>
        </div>
      </section>
    </LegalLayout>
  );
}
