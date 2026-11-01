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
        <h2 className="text-xl font-semibold text-gray-900">2. Data Access &amp; Roles (No Platform Access by Acadex)</h2>
        <p>
          <strong>Acadex does not have access to any staff data, student records, or guardian emergency contacts.</strong> We do not inspect, browse, extract, or monitor your school&rsquo;s internal educational records or personal contacts.
        </p>
        <ul className="list-disc pl-5 space-y-2">
          <li>
            <strong>Exclusive Headmaster Access:</strong> The Headmaster of each school possesses sole administrative access and authority over their school&rsquo;s tenant. The Headmaster creates teacher accounts, registers students, manages classes, records guardian emergency contact details, and compiles academic reports.
          </li>
          <li>
            <strong>Authorized Teacher Access:</strong> Teachers have restricted access solely to the specific classes and subjects assigned to them by their Headmaster.
          </li>
          <li>
            <strong>No Direct Access for Students or Parents:</strong> Students and parents/guardians have no login accounts or direct access to the platform.
          </li>
        </ul>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-900">3. Data Stored on the Platform</h2>
        <p>
          The platform securely stores only the information entered and managed exclusively by the Headmaster and authorized teachers:
        </p>
        <ul className="list-disc pl-5 space-y-2">
          <li>
            <strong>Staff Data:</strong> Teacher full names, email addresses, phone numbers, and subject/class assignments as configured by the Headmaster.
          </li>
          <li>
            <strong>Student Records:</strong> Student full names, admission numbers, gender, class placement, continuous assessment marks, examination scores, and daily attendance records entered by school educators.
          </li>
          <li>
            <strong>Guardian Emergency Contacts:</strong> Parent or guardian names, emergency phone numbers, and email addresses entered by the school strictly for attendance notifications, urgent announcements, and terminal report card sharing.
          </li>
        </ul>
        <p>
          Acadex never collects or stores student/parent payment card numbers or personal banking details.
        </p>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold text-gray-900">4. Why the Data Is Processed</h2>
        <p>
          The data stored within Acadex is utilized solely by the school to execute essential school administration functions (attendance taking, continuous assessment and examination recording, automatic terminal report card generation, and authorized school-to-parent communication).
        </p>
        <p>
          Acadex never sells, rents, monetizes, profiles, or uses any school, teacher, student, or guardian data for advertising or any commercial purpose.
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
