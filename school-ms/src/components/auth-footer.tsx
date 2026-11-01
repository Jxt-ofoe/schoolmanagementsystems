import { Link } from 'react-router-dom';

export function AuthFooter() {
  return (
    <p
      className="muted small"
      style={{
        marginTop: 16,
        textAlign: 'center',
        fontSize: '0.82rem',
        lineHeight: 1.5,
      }}
    >
      By signing in, you agree to our{' '}
      <Link
        to="/terms"
        style={{
          textDecoration: 'underline',
          textUnderlineOffset: '2px',
          fontWeight: 500,
        }}
      >
        Terms &amp; Conditions
      </Link>{' '}
      and{' '}
      <Link
        to="/privacy"
        style={{
          textDecoration: 'underline',
          textUnderlineOffset: '2px',
          fontWeight: 500,
        }}
      >
        Privacy Policy
      </Link>
      .
    </p>
  );
}

export default AuthFooter;
