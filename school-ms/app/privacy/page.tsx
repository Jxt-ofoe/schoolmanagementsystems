// TODO: Have a lawyer review before launch.
import React from 'react';
import { LegalLayout } from '../legal-layout';

export const metadata = {
  title: 'Privacy Policy | [APP NAME]',
  description: 'Privacy Policy and data processing terms under the Ghana Data Protection Act, 2012 (Act 843).',
};

export default function PrivacyPolicyPage() {
  return (
    <LegalLayout title="Privacy Policy" lastUpdated="November 1, 2026">
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-900">1. Who We Are</h2>
        <p>
          [APP NAME] (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;) is an educational management software-as-a-service (SaaS) platform operated by [COMPANY/OWNER NAME], located at [ADDRESS].
        </p>
        <p>
          For the purposes of the Ghana Data Protection Act, 2012 (Act 843), the school subscribing to our service is the <strong>Data Controller</strong>. We act strictly as a <strong>Data Processor</strong> on behalf of and under the instructions of the school.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-900">2. Data We Collect</h2>
        <p>
          We only collect and process personal data necessary to provide school administration services:
        </p>
        <ul className="list-disc pl-5 space-y-2">
          <li>
            <strong>Staff Data:</strong> Full name, professional email address, assigned school role (headmaster or teacher), phone number, and system login activity (timestamps and session identifiers).
          </li>
          <li>
            <strong>Student Records:</strong> Student full name, date of birth, gender, admission number, enrollment history, class and subject allocations, terminal examination scores, continuous assessments, and daily attendance records.
          </li>
          <li>
            <strong>Guardian &amp; Emergency Contacts:</strong> Parent or guardian full name, relationship to student, telephone number, residential address, and email address.
          </li>
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-900">3. Why We Use Your Data</h2>
        <p>
          We process personal data solely to operate, maintain, and deliver [APP NAME] to your school. This includes calculating academic performance, generating official terminal report cards, tracking attendance, and facilitating authorized school-to-parent communications (such as SMS notifications and manual report delivery).
        </p>
        <p>
          We never use school, teacher, student, or guardian data for advertising, marketing, profiling, or commercial exploitation.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-900">4. Legal Basis &amp; Parental Consent</h2>
        <p>
          As the Data Controller, the subscribing school is legally responsible for establishing a lawful basis for processing under Act 843. The school must obtain valid consent from parents or legal guardians upon student enrollment before recording student or guardian personal details into [APP NAME].
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-900">5. Data Sharing and Third-Party Sub-processors</h2>
        <p>
          We never sell, rent, trade, or monetize personal information.
        </p>
        <p>
          We share data only with verified infrastructure providers strictly required to host and secure the platform (such as cloud hosting, managed database providers, and licensed telecommunications gateways for SMS delivery). All third-party providers are bound by strict confidentiality and security covenants.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-900">6. Data Retention and Deletion</h2>
        <p>
          School data is retained only for the duration of the school&rsquo;s active subscription.
        </p>
        <p>
          Upon contract termination or written request from the headmaster, the school may request a full export of its academic and student records. Within thirty (30) days of subscription conclusion, all associated school data is permanently and securely erased from our active production databases.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-900">7. Data Security Safeguards</h2>
        <p>
          We implement industry-standard technical, organizational, and physical safeguards:
        </p>
        <ul className="list-disc pl-5 space-y-2">
          <li>End-to-end data encryption in transit using Transport Layer Security (TLS 1.3) and encryption at rest (AES-256).</li>
          <li>Database-level Row Level Security (RLS) ensuring strict multi-tenant isolation where each school can only access its own records.</li>
          <li>Strict role-based access control (RBAC) ensuring teachers only view their assigned classes and subjects.</li>
          <li>Passwords stored exclusively using one-way cryptographic salted hashing (bcrypt).</li>
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-900">8. Data Subject Rights</h2>
        <p>
          Under the Ghana Data Protection Act, 2012 (Act 843), individuals have rights to access, review, correct, or request the deletion of their personal information.
        </p>
        <p>
          Because the school is the Data Controller, parents, students, and staff members must direct any access or correction requests to their respective school headmaster or administration. We will promptly assist school administrators in responding to legitimate requests. For processor-level questions, contact our privacy team at [SUPPORT EMAIL].
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-900">9. Children&rsquo;s Privacy</h2>
        <p>
          [APP NAME] stores children&rsquo;s academic and attendance data solely as provided by authorized school staff. Students and minors do not have login credentials or direct access to the application.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-900">10. Data Protection Commission Registration</h2>
        <p>
          In accordance with the requirements of the Data Protection Act, 2012 (Act 843), our registration with the Data Protection Commission (DPC) of Ghana is: <strong>[REGISTRATION NUMBER or &ldquo;in progress&rdquo;]</strong>.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-900">11. Changes to This Policy &amp; Contact Details</h2>
        <p>
          We may update this Privacy Policy from time to time. Any material changes will be communicated to subscribing school headmasters via email or in-app notice prior to taking effect.
        </p>
        <p>
          If you have questions, concerns, or requests regarding this Privacy Policy or our data protection practices, please contact:
        </p>
        <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 text-sm space-y-1">
          <p><strong>Entity:</strong> [COMPANY/OWNER NAME]</p>
          <p><strong>Application:</strong> [APP NAME]</p>
          <p><strong>Email:</strong> <a href="mailto:[SUPPORT EMAIL]" className="text-emerald-700 underline">[SUPPORT EMAIL]</a></p>
          <p><strong>Physical Address:</strong> [ADDRESS]</p>
          <p><strong>Jurisdiction:</strong> Republic of Ghana</p>
        </div>
      </section>
    </LegalLayout>
  );
}
