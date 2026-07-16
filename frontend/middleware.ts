import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  // In demo mode, allow all routes without authentication
  // Auth is handled client-side via the AuthProvider
  return NextResponse.next()
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/agents/:path*',
    '/matches/:path*',
    '/auth/login',
    '/auth/signup',
  ],
}
