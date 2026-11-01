// TODO: Have a lawyer review before launch.
import { Link } from 'react-router-dom';

export function TermsAndConditionsPage() {
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
            Terms &amp; Conditions
          </h1>
          <p className="muted small" style={{ margin: 0 }}>
            Last updated: November 1, 2026
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 24, fontSize: '0.94rem', lineHeight: 1.65 }}>
          <section>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 650, margin: '0 0 8px', color: 'var(--ink)' }}>
              1. Acceptance of Terms
            </h2>
            <p>
              These Terms &amp; Conditions (&ldquo;Terms&rdquo;) form a legally binding agreement between [COMPANY/OWNER NAME] (&ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;) and the subscribing educational institution (&ldquo;School,&rdquo; &ldquo;you,&rdquo; or &ldquo;your&rdquo;).
            </p>
            <p>
              By signing in, creating a school account, or using [APP NAME], the headmaster or authorized school representative confirms acceptance of these Terms and our Privacy Policy.
            </p>
          </section>

          <section>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 650, margin: '0 0 8px', color: 'var(--ink)' }}>
              2. Accounts and User Access
            </h2>
            <p>
              Access is limited to authorized school personnel (headmasters and teachers). Students and parents have no direct system access.
            </p>
            <p>
              The headmaster creates and manages teacher accounts. The School is responsible for maintaining credential security and promptly deactivating accounts for departing teachers.
            </p>
          </section>

          <section>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 650, margin: '0 0 8px', color: 'var(--ink)' }}>
              3. School Responsibilities &amp; Parental Consent
            </h2>
            <p>
              The School operates as the Data Controller under the Ghana Data Protection Act, 2012 (Act 843).
            </p>
            <p>
              The School warrants that it has lawful authority to record student and guardian details and must obtain parent/guardian consent upon student enrollment. The School is solely responsible for ensuring the accuracy of all grades, attendance records, and student information entered.
            </p>
          </section>

          <section>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 650, margin: '0 0 8px', color: 'var(--ink)' }}>
              4. Acceptable Use
            </h2>
            <p>
              You agree to use [APP NAME] strictly for lawful school management purposes. You agree not to attempt unauthorized access to other schools&rsquo; records, reverse-engineer the system, introduce malicious scripts, or misuse bulk messaging features.
            </p>
          </section>

          <section>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 650, margin: '0 0 8px', color: 'var(--ink)' }}>
              5. Data Ownership
            </h2>
            <p>
              The School retains 100% ownership of all student records, examination marks, and attendance data entered into the platform. We use this data solely to provide the SaaS service to you.
            </p>
          </section>

          <section>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 650, margin: '0 0 8px', color: 'var(--ink)' }}>
              6. Availability and Backups
            </h2>
            <p>
              We provide regular encrypted database backups and work to maximize system availability. However, the service is provided &ldquo;as is&rdquo; without warranties of continuous, uninterrupted operation.
            </p>
          </section>

          <section>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 650, margin: '0 0 8px', color: 'var(--ink)' }}>
              7. Fees and Payment
            </h2>
            <p>
              [PLACEHOLDER: Subscription pricing per student per semester, billing dates, accepted payment methods including Mobile Money and Bank Transfer, and account suspension policies for overdue balances.]
            </p>
          </section>

          <section>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 650, margin: '0 0 8px', color: 'var(--ink)' }}>
              8. Termination, Data Export and Deletion
            </h2>
            <p>
              Either party may terminate with thirty (30) days written notice. The School may export its complete records prior to termination. Following termination, school data will be permanently deleted from active servers.
            </p>
          </section>

          <section>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 650, margin: '0 0 8px', color: 'var(--ink)' }}>
              9. Limitation of Liability
            </h2>
            <p>
              To the fullest extent permitted by law, [COMPANY/OWNER NAME] shall not be liable for indirect, incidental, or consequential damages. Total liability is capped at the subscription fees paid by the School in the preceding twelve (12) months.
            </p>
          </section>

          <section>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 650, margin: '0 0 8px', color: 'var(--ink)' }}>
              10. Governing Law
            </h2>
            <p>
              These Terms are governed by the laws of the Republic of Ghana, including the Data Protection Act, 2012 (Act 843). Any disputes shall be submitted to the exclusive jurisdiction of the courts of Ghana.
            </p>
          </section>

          <section>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 650, margin: '0 0 8px', color: 'var(--ink)' }}>
              11. Changes to Terms &amp; Contact Details
            </h2>
            <p>
              We may update these Terms periodically. Continued use constitutes acceptance. For inquiries, contact:
            </p>
            <div style={{ background: 'var(--bg)', padding: 14, borderRadius: 8, fontSize: '0.88rem' }}>
              <p style={{ margin: '3px 0' }}><strong>Entity:</strong> [COMPANY/OWNER NAME]</p>
              <p style={{ margin: '3px 0' }}><strong>Platform:</strong> [APP NAME]</p>
              <p style={{ margin: '3px 0' }}><strong>Support Email:</strong> <a href="mailto:[SUPPORT EMAIL]">[SUPPORT EMAIL]</a></p>
              <p style={{ margin: '3px 0' }}><strong>Address:</strong> [ADDRESS]</p>
              <p style={{ margin: '3px 0' }}><strong>Jurisdiction:</strong> Republic of Ghana</p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

export default TermsAndConditionsPage;
