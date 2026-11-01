import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  // Public routes (/privacy, /terms, /login, static files) are excluded
  // and pass through without authentication checks.
  return NextResponse.next();
}

/**
 * Exclude Next.js static files, images, favicon, and public legal routes (/privacy, /terms)
 */
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|privacy|terms).*)'],
};
