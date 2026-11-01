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
              1. Who We Are
            </h2>
            <p>
              [APP NAME] (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;) is an educational management software platform operated by [COMPANY/OWNER NAME], located at [ADDRESS].
            </p>
            <p>
              Under the Ghana Data Protection Act, 2012 (Act 843), the school subscribing to our platform is the <strong>Data Controller</strong>. We act strictly as a <strong>Data Processor</strong> on behalf of and under the explicit direction of the school.
            </p>
          </section>

          <section>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 650, margin: '0 0 8px', color: 'var(--ink)' }}>
              2. Data We Collect
            </h2>
            <p>
              We process only personal data necessary to provide school administration services:
            </p>
            <ul style={{ paddingLeft: 20, margin: '8px 0' }}>
              <li><strong>Staff Data:</strong> Full name, official email address, school role (headmaster or teacher), phone number, and system login activity (timestamps, IP address).</li>
              <li><strong>Student Records:</strong> Student full name, date of birth, gender, admission number, enrollment history, class assignments, continuous assessments, terminal examination scores, and daily attendance logs.</li>
              <li><strong>Guardian &amp; Emergency Contacts:</strong> Parent or guardian full name, relationship to student, phone number, email address, and home address.</li>
            </ul>
          </section>

          <section>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 650, margin: '0 0 8px', color: 'var(--ink)' }}>
              3. Why We Use It
            </h2>
            <p>
              We process personal data solely to deliver, maintain, and support [APP NAME] for your school. This includes recording grades, compiling terminal report cards, tracking attendance, and facilitating authorized school-to-parent communications (such as bulk SMS notifications and report sharing).
            </p>
            <p>
              We never use school, teacher, student, or guardian data for advertising, profiling, or commercial monetization.
            </p>
          </section>

          <section>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 650, margin: '0 0 8px', color: 'var(--ink)' }}>
              4. Parental Consent
            </h2>
            <p>
              As the Data Controller, the subscribing school is legally responsible for securing valid consent from parents or legal guardians at student enrollment in compliance with the Ghana Data Protection Act, 2012 (Act 843) prior to recording student or guardian details into [APP NAME].
            </p>
          </section>

          <section>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 650, margin: '0 0 8px', color: 'var(--ink)' }}>
              5. Data Sharing
            </h2>
            <p>
              We never sell, rent, or trade personal data. Data is shared exclusively with verified cloud hosting and infrastructure sub-processors strictly required to run the service (such as encrypted cloud database hosting and licensed telecom SMS gateways).
            </p>
          </section>

          <section>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 650, margin: '0 0 8px', color: 'var(--ink)' }}>
              6. Retention and Deletion
            </h2>
            <p>
              School data is retained only while the school&rsquo;s account is active and in good standing.
            </p>
            <p>
              Upon subscription conclusion or written request from the headmaster, all student and school data will be exported to the school or permanently erased from active production databases within thirty (30) days.
            </p>
          </section>

          <section>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 650, margin: '0 0 8px', color: 'var(--ink)' }}>
              7. Security Safeguards
            </h2>
            <p>
              We enforce multi-layered security controls including TLS 1.3 encryption in transit, AES-256 encryption at rest, PostgreSQL Row Level Security (RLS) isolating each school tenant, and one-way bcrypt password hashing. Access is strictly limited to authorized school staff.
            </p>
          </section>

          <section>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 650, margin: '0 0 8px', color: 'var(--ink)' }}>
              8. Data Subject Rights
            </h2>
            <p>
              Under Act 843, data subjects have the right to access, rectify, or delete their personal records. Because the school is the Data Controller, parents and staff should direct requests to their school headmaster. Inquiries regarding technical processor obligations can be directed to [SUPPORT EMAIL].
            </p>
          </section>

          <section>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 650, margin: '0 0 8px', color: 'var(--ink)' }}>
              9. Children&rsquo;s Data
            </h2>
            <p>
              Student information is stored only as entered by authorized school staff. Students and minors have no direct login access to the software.
            </p>
          </section>

          <section>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 650, margin: '0 0 8px', color: 'var(--ink)' }}>
              10. Data Protection Commission Registration
            </h2>
            <p>
              Data Protection Commission (DPC) Registration: <strong>[REGISTRATION NUMBER or &ldquo;in progress&rdquo;]</strong>.
            </p>
          </section>

          <section>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 650, margin: '0 0 8px', color: 'var(--ink)' }}>
              11. Changes and Contact Details
            </h2>
            <p>
              We may update this policy periodically with advance notice to headmasters. For privacy inquiries, please contact:
            </p>
            <div style={{ background: 'var(--bg)', padding: 14, borderRadius: 8, fontSize: '0.88rem' }}>
              <p style={{ margin: '3px 0' }}><strong>Entity:</strong> [COMPANY/OWNER NAME]</p>
              <p style={{ margin: '3px 0' }}><strong>Platform:</strong> [APP NAME]</p>
              <p style={{ margin: '3px 0' }}><strong>Email:</strong> <a href="mailto:[SUPPORT EMAIL]">[SUPPORT EMAIL]</a></p>
              <p style={{ margin: '3px 0' }}><strong>Address:</strong> [ADDRESS]</p>
              <p style={{ margin: '3px 0' }}><strong>Governing Law:</strong> Republic of Ghana</p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default PrivacyPolicyPage;
