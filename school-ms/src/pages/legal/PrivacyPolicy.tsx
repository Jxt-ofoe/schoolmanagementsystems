// TODO: Have a lawyer review before launch.
import { Link } from 'react-router-dom';

export function PrivacyPolicyPage() {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', padding: '40px 16px', color: 'var(--ink)' }}>
      <div
        style={{
          maxWidth: 780,
          margin: '0 auto',
          background: '#fff',
          padding: '36px 32px',
          borderRadius: 'var(--radius)',
          boxShadow: 'var(--shadow)',
          border: '1px solid var(--line)',
        }}
      >
        <div style={{ marginBottom: 28, paddingBottom: 20, borderBottom: '1px solid var(--line)' }}>
          <Link
            to="/login"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              fontSize: '0.88rem',
              color: 'var(--green-700)',
              textDecoration: 'none',
              fontWeight: 500,
              marginBottom: 16,
            }}
          >
            ← Back to login
          </Link>
          <h1 style={{ fontSize: '1.9rem', fontWeight: 700, margin: '8px 0 4px', color: 'var(--ink)' }}>
            Privacy Policy
          </h1>
          <p className="muted small" style={{ margin: 0 }}>
            Last updated: November 1, 2026
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 24, fontSize: '0.94rem', lineHeight: 1.65 }}>
          <section>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 650, margin: '0 0 8px', color: 'var(--ink)' }}>
              1. Who We Are &amp; Legal Framework
            </h2>
            <p>
              Acadex is an educational management SaaS platform operated by Acadex, located in Accra, Ghana.
            </p>
            <p>
              Under the Ghana Data Protection Act, 2012 (Act 843), the school subscribing to our platform is the <strong>Data Controller</strong>. Acadex acts strictly as the <strong>Data Processor</strong> providing the secure technical infrastructure to host the service.
            </p>
          </section>

          <section>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 650, margin: '0 0 8px', color: 'var(--ink)' }}>
              2. What Acadex Does NOT Collect or Access
            </h2>
            <p>
              <strong>Acadex does NOT collect, inspect, browse, or access any staff data, student records, or guardian emergency contacts.</strong>
            </p>
            <p>
              All student information (names, grades, continuous assessments, attendance records), staff accounts (teacher names, emails, phone numbers), and parent/guardian emergency contact details are entered, accessed, and managed <strong>strictly and exclusively by the school&rsquo;s Headmaster</strong> (and teachers assigned by the Headmaster to specific classes).
            </p>
            <ul style={{ paddingLeft: 20, margin: '8px 0' }}>
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

          <section>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 650, margin: '0 0 8px', color: 'var(--ink)' }}>
              3. Information Acadex Collects (Account Administration Only)
            </h2>
            <p>
              Acadex only collects basic institutional account information required to establish and maintain the school&rsquo;s software subscription:
            </p>
            <ul style={{ paddingLeft: 20, margin: '8px 0' }}>
              <li>
                <strong>School Profile:</strong> School name, unique school code, region, and official school administrative email.
              </li>
              <li>
                <strong>Headmaster Login Credentials:</strong> Headmaster full name, email address, and account password (stored cryptographically hashed with bcrypt).
              </li>
            </ul>
            <p style={{ marginTop: 8 }}>
              Acadex never collects student personal records, guardian contact numbers, or student/parent payment card numbers.
            </p>
          </section>

          <section>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 650, margin: '0 0 8px', color: 'var(--ink)' }}>
              4. Why School Data Is Stored
            </h2>
            <p>
              The data entered by the Headmaster and teachers is stored strictly to enable the school to execute its daily academic functions (taking attendance, recording continuous assessments, generating terminal report cards, and sending school-initiated parent notifications).
            </p>
            <p>
              Acadex never sells, rents, monetizes, profiles, or uses any school data for advertising or any commercial purpose.
            </p>
          </section>

          <section>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 650, margin: '0 0 8px', color: 'var(--ink)' }}>
              5. Parental Consent &amp; School Responsibilities
            </h2>
            <p>
              Because the School is the Data Controller with exclusive access to student and guardian data, the School warrants that it has the lawful authority and parental/guardian consent required under the Ghana Data Protection Act, 2012 (Act 843) to enter student details and guardian emergency contacts into the system.
            </p>
          </section>

          <section>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 650, margin: '0 0 8px', color: 'var(--ink)' }}>
              6. Data Sharing &amp; Sub-Processors
            </h2>
            <p>
              Acadex does not share school data with any third parties. Data is stored strictly on secure cloud database servers with tenant-level encryption. SMS and WhatsApp notifications are triggered strictly upon the direct instruction and action of the Headmaster or class teacher via licensed telecom infrastructure gateways.
            </p>
          </section>

          <section>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 650, margin: '0 0 8px', color: 'var(--ink)' }}>
              7. Retention and Deletion
            </h2>
            <p>
              The School retains 100% ownership of its data at all times. The Headmaster may export complete student, grade, and attendance records whenever needed.
            </p>
            <p>
              Upon school account termination or written request from the Headmaster, all school records will be permanently erased from active production databases within thirty (30) days.
            </p>
          </section>

          <section>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 650, margin: '0 0 8px', color: 'var(--ink)' }}>
              8. Security Safeguards
            </h2>
            <p>
              We implement industry-standard technical safeguards to ensure zero unauthorized access:
            </p>
            <ul style={{ paddingLeft: 20, margin: '8px 0' }}>
              <li><strong>Tenant Isolation:</strong> PostgreSQL Row Level Security (RLS) ensures that data belonging to one school cannot be accessed or viewed by any other school or unauthorized party.</li>
              <li><strong>Encryption:</strong> All data is encrypted in transit using TLS 1.3 / HTTPS and encrypted at rest with AES-256.</li>
              <li><strong>Credential Protection:</strong> Passwords are protected using one-way cryptographic hashing (bcrypt). Acadex staff cannot view user passwords.</li>
            </ul>
          </section>

          <section>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 650, margin: '0 0 8px', color: 'var(--ink)' }}>
              9. Data Subject Rights under Act 843
            </h2>
            <p>
              Under Act 843, data subjects have the right to inspect, correct, or request deletion of their personal records. Because only the school&rsquo;s Headmaster has access to student and guardian data, all requests should be directed to the school&rsquo;s administration. Inquiries regarding technical processor obligations may be sent to <a href="mailto:support@acadex.com" style={{ color: 'var(--green-700)' }}>support@acadex.com</a>.
            </p>
          </section>

          <section>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 650, margin: '0 0 8px', color: 'var(--ink)' }}>
              10. Children&rsquo;s Data
            </h2>
            <p>
              Because pupil information is processed, heightened protections apply: pupils have no direct system access, no behavioral profiling or tracking takes place, and records are accessible exclusively by authorized school personnel.
            </p>
          </section>

          <section>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 650, margin: '0 0 8px', color: 'var(--ink)' }}>
              11. Changes and Contact Details
            </h2>
            <p>
              Any material revisions to this policy will be communicated directly to Headmasters in advance. For questions or support, contact:
            </p>
            <div style={{ background: 'var(--bg)', padding: 14, borderRadius: 8, fontSize: '0.88rem' }}>
              <p style={{ margin: '3px 0' }}><strong>Platform:</strong> Acadex</p>
              <p style={{ margin: '3px 0' }}><strong>Operator:</strong> Acadex</p>
              <p style={{ margin: '3px 0' }}><strong>Location:</strong> Accra, Ghana</p>
              <p style={{ margin: '3px 0' }}><strong>Support Email:</strong> <a href="mailto:support@acadex.com">support@acadex.com</a></p>
              <p style={{ margin: '3px 0' }}><strong>Governing Law:</strong> Republic of Ghana (Data Protection Act, 2012 - Act 843)</p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default PrivacyPolicyPage;
