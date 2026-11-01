// TODO: Have a lawyer review before launch.
import React from 'react';
import { LegalLayout } from '../legal-layout';

export const metadata = {
  title: 'Terms & Conditions | [APP NAME]',
  description: 'Terms and Conditions governing the use of [APP NAME] school management platform in Ghana.',
};

export default function TermsAndConditionsPage() {
  return (
    <LegalLayout title="Terms & Conditions" lastUpdated="November 1, 2026">
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-900">1. Acceptance of Terms</h2>
        <p>
          These Terms &amp; Conditions (&ldquo;Terms&rdquo;) constitute a legally binding agreement between [COMPANY/OWNER NAME] (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;), the operator of [APP NAME], and the educational institution (&ldquo;School,&rdquo; &ldquo;you,&rdquo; or &ldquo;your&rdquo;).
        </p>
        <p>
          By creating a school account, signing in, or using [APP NAME], the headmaster or authorized school representative acknowledges having read, understood, and agreed to be bound by these Terms and our Privacy Policy.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-900">2. Accounts and Credential Security</h2>
        <p>
          Access to [APP NAME] is strictly limited to authorized school staff (headmasters and teachers). Students and parents do not have login accounts.
        </p>
        <p>
          The headmaster is solely responsible for creating, assigning roles to, and managing teacher accounts. The School is responsible for maintaining the strict confidentiality of all login credentials and must immediately disable or revoke access for any staff member who leaves the institution.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-900">3. School Responsibilities &amp; Parental Consent</h2>
        <p>
          The School serves as the Data Controller under the Ghana Data Protection Act, 2012 (Act 843).
        </p>
        <p>
          The School warrants that it has the legal authority to collect, enter, and process student and guardian information. The School is solely responsible for obtaining written consent from parents or guardians at the time of student admission prior to entering their details into the system. The School is also responsible for the factual accuracy of all enrolled student records, attendance, and assessment grades.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-900">4. Acceptable Use Policy</h2>
        <p>
          You agree to use [APP NAME] exclusively for legitimate school administration and academic purposes. You must not:
        </p>
        <ul className="list-disc pl-5 space-y-2">
          <li>Attempt to gain unauthorized access to data belonging to other schools or users.</li>
          <li>Transmit malicious code, viruses, or disruptive scripts through the platform.</li>
          <li>Reverse-engineer, decompile, or copy the underlying codebase and architecture.</li>
          <li>Use communication features (such as bulk SMS) to send unsolicited advertising, spam, or abusive messages.</li>
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-900">5. Data Ownership</h2>
        <p>
          The School retains full and exclusive ownership of all student records, examination results, attendance logs, and school marks entered into [APP NAME].
        </p>
        <p>
          We claim no intellectual property or proprietary rights over your school data. We hold and process your data strictly as a service provider (Data Processor) to deliver the software functions you request.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-900">6. Availability, Backups &amp; Disclaimers</h2>
        <p>
          We make reasonable commercial efforts to ensure continuous system availability and maintain automated encrypted backups.
        </p>
        <p>
          However, [APP NAME] is provided on an &ldquo;as is&rdquo; and &ldquo;as available&rdquo; basis. We do not warrant that service will be completely uninterrupted, timely, or error-free. The School is encouraged to regularly download and archive offline copies of terminal reports and financial summaries.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-900">7. Fees and Payment</h2>
        <p>
          [PLACEHOLDER: Subscription pricing per registered student per semester, payment deadlines, accepted payment methods including Mobile Money and Bank Transfer, and policies regarding account suspension for overdue balances.]
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-900">8. Termination, Data Export &amp; Deletion</h2>
        <p>
          Either party may terminate this agreement with thirty (30) days written notice, or immediately in the event of a material breach.
        </p>
        <p>
          Prior to the effective termination date, the School may export its complete student and academic records. Following contract termination, all school data will be permanently deleted from our active production servers in accordance with our data retention schedule.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-900">9. Limitation of Liability</h2>
        <p>
          To the maximum extent permitted by Ghanaian law, [COMPANY/OWNER NAME] and its officers, directors, and employees shall not be liable for any indirect, incidental, punitive, or consequential damages arising from the use or inability to use the software.
        </p>
        <p>
          Our aggregate liability for any claims under these Terms shall not exceed the total subscription fees paid by the School to us during the twelve (12) months preceding the incident.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-900">10. Governing Law &amp; Dispute Resolution</h2>
        <p>
          These Terms shall be governed by and construed in accordance with the laws of the Republic of Ghana, including the Data Protection Act, 2012 (Act 843).
        </p>
        <p>
          Any dispute, controversy, or claim arising out of or relating to these Terms shall be subject to the exclusive jurisdiction of the courts of Ghana.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-900">11. Changes to Terms &amp; Contact Information</h2>
        <p>
          We reserve the right to revise these Terms periodically. Notice of significant revisions will be posted on the portal or delivered via email to headmasters. Continued use of [APP NAME] after revisions take effect constitutes acceptance.
        </p>
        <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 text-sm space-y-1">
          <p><strong>Entity:</strong> [COMPANY/OWNER NAME]</p>
          <p><strong>Platform:</strong> [APP NAME]</p>
          <p><strong>Support &amp; Inquiries:</strong> <a href="mailto:[SUPPORT EMAIL]" className="text-emerald-700 underline">[SUPPORT EMAIL]</a></p>
          <p><strong>Address:</strong> [ADDRESS]</p>
          <p><strong>Country:</strong> Republic of Ghana</p>
        </div>
      </section>
    </LegalLayout>
  );
}
