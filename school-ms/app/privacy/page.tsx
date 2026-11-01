// TODO: Have a lawyer review before launch.
import React from 'react';
import { LegalLayout } from '../legal-layout';

export const metadata = {
  title: 'Privacy Policy | Acadex',
  description: 'Privacy Policy and data processing terms under the Ghana Data Protection Act, 2012 (Act 843).',
};

export default function PrivacyPolicyPage() {
  return (
    <LegalLayout title="Privacy Policy" lastUpdated="November 1, 2026">
      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-900">1. Who We Are &amp; Legal Framework</h2>
        <p>
          Acadex is an educational management software-as-a-service (SaaS) platform operated by Acadex, located in Accra, Ghana.
        </p>
        <p>
          For the purposes of the Ghana Data Protection Act, 2012 (Act 843), the school subscribing to our service is the <strong>Data Controller</strong>. Acadex acts strictly as a <strong>Data Processor</strong> providing the secure technical infrastructure to host the service.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-900">2. What Acadex Does NOT Collect or Access</h2>
        <p>
          <strong>Acadex does NOT collect, inspect, browse, or access any staff data, student records, or guardian emergency contacts.</strong>
        </p>
        <p>
          All student information (names, grades, assessments, attendance records), staff accounts (teacher names, emails, phone numbers), and parent/guardian emergency contact details are entered, accessed, and managed <strong>strictly and exclusively by the school&rsquo;s Headmaster</strong> (and teachers assigned by the Headmaster to specific classes).
        </p>
        <ul className="list-disc pl-5 space-y-2">
          <li>
            <strong>Exclusive Headmaster Access:</strong> The Headmaster has sole administrative control over their school&rsquo;s records, student enrollments, guardian emergency contacts, and staff assignments.
          </li>
          <li>
            <strong>Restricted Teacher Access:</strong> Teachers can only view the specific classes and subjects assigned to them by the Headmaster.
          </li>
          <li>
            <strong>Zero Platform Access:</strong> Acadex personnel have no access to view, read, or process student records, staff personal data, or guardian emergency numbers.
          </li>
          <li>
            <strong>No Direct Access for Students or Parents:</strong> Students and parents/guardians have no login accounts or direct access to the platform.
          </li>
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-900">3. Information Acadex Collects (Account Administration Only)</h2>
        <p>
          Acadex only collects basic institutional account information required to establish and maintain the school&rsquo;s software subscription:
        </p>
        <ul className="list-disc pl-5 space-y-2">
          <li>
            <strong>School Profile:</strong> School name, unique school code, region, and official school administrative email.
          </li>
          <li>
            <strong>Headmaster Login Credentials:</strong> Headmaster full name, email address, and account password (stored cryptographically hashed with bcrypt).
          </li>
        </ul>
        <p>
          Acadex never collects student personal records, guardian contact numbers, or student/parent payment card numbers.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-900">4. Why School Data Is Stored</h2>
        <p>
          The data entered by the Headmaster and teachers is stored strictly to enable the school to execute its daily academic functions (taking attendance, recording continuous assessments, generating terminal report cards, and sending school-initiated parent notifications).
        </p>
        <p>
          Acadex never sells, rents, monetizes, profiles, or uses any school data for advertising or any commercial purpose.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-900">5. Legal Basis &amp; Parental Consent</h2>
        <p>
          As the Data Controller with exclusive access to student and guardian data, the subscribing school is legally responsible for establishing a lawful basis for processing under Act 843. The school must obtain valid consent from parents or legal guardians upon student enrollment before recording student or guardian personal details into Acadex.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-900">6. Data Sharing and Sub-processors</h2>
        <p>
          Acadex does not share school data with any third parties. Data is stored strictly on secure cloud database servers with tenant-level encryption. SMS and WhatsApp notifications are triggered strictly upon the direct instruction and action of the Headmaster or class teacher via licensed telecom infrastructure gateways.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-900">7. Data Retention and Deletion</h2>
        <p>
          The School retains 100% ownership of its data at all times. The Headmaster may export complete student, grade, and attendance records whenever needed.
        </p>
        <p>
          Upon school account termination or written request from the Headmaster, all school records will be permanently erased from active production databases within thirty (30) days.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-900">8. Security Safeguards</h2>
        <p>
          We implement industry-standard technical safeguards to ensure zero unauthorized access:
        </p>
        <ul className="list-disc pl-5 space-y-2">
          <li>
            <strong>Tenant Isolation:</strong> PostgreSQL Row Level Security (RLS) ensures that data belonging to one school cannot be accessed or viewed by any other school or unauthorized party.
          </li>
          <li>
            <strong>Encryption:</strong> All data is encrypted in transit using TLS 1.3 / HTTPS and encrypted at rest with AES-256.
          </li>
          <li>
            <strong>Credential Protection:</strong> Passwords are protected using one-way cryptographic hashing (bcrypt). Acadex staff cannot view user passwords.
          </li>
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-900">9. Data Subject Rights under Act 843</h2>
        <p>
          Under Act 843, data subjects have the right to inspect, correct, or request deletion of their personal records. Because only the school&rsquo;s Headmaster has access to student and guardian data, all requests should be directed to the school&rsquo;s administration. Inquiries regarding technical processor obligations may be sent to <a href="mailto:support@acadex.com" className="text-emerald-700 underline font-medium">support@acadex.com</a>.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-900">10. Children&rsquo;s Data</h2>
        <p>
          Because pupil information is processed, heightened protections apply: pupils have no direct system access, no behavioral profiling or tracking takes place, and records are accessible exclusively by authorized school personnel.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-900">11. Changes and Contact Details</h2>
        <p>
          Any material revisions to this policy will be communicated directly to Headmasters in advance. For questions or support, contact:
        </p>
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-1 text-sm text-gray-700">
          <p><strong>Platform:</strong> Acadex</p>
          <p><strong>Operator:</strong> Acadex</p>
          <p><strong>Location:</strong> Accra, Ghana</p>
          <p><strong>Support Email:</strong> <a href="mailto:support@acadex.com" className="text-emerald-700 underline font-medium">support@acadex.com</a></p>
          <p><strong>Governing Law:</strong> Republic of Ghana (Data Protection Act, 2012 - Act 843)</p>
        </div>
      </section>
    </LegalLayout>
  );
}
