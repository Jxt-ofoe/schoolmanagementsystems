import Link from 'next/link';

export function AuthFooter() {
  return (
    <p className="mt-4 text-center text-xs text-gray-500 dark:text-gray-400">
      By signing in, you agree to our{' '}
      <Link
        href="/terms"
        className="font-medium underline underline-offset-2 hover:text-gray-900 dark:hover:text-gray-200"
      >
        Terms &amp; Conditions
      </Link>{' '}
      and{' '}
      <Link
        href="/privacy"
        className="font-medium underline underline-offset-2 hover:text-gray-900 dark:hover:text-gray-200"
      >
        Privacy Policy
      </Link>
      .
    </p>
  );
}

export default AuthFooter;
