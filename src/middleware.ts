// src/middleware.ts
// Route protection based on user role
// SYSTEM_ADMIN  → /dashboard (full access)
// GROUP_ADMIN   → /dashboard (scoped to their group)
// MEMBER        → /portal only
// Unauthenticated → /login

import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify } from 'jose'

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'fallback-dev-secret-change-in-production'
)

// ── Route rules ───────────────────────────────────────────────
const PUBLIC_ROUTES   = ['/', '/login', '/invite', '/guarantor']
const ADMIN_ROUTES    = ['/dashboard']
const MEMBER_ROUTES   = ['/portal']
const API_PUBLIC      = ['/api/auth/login', '/api/auth/register', '/api/auth/refresh']

// ── Helpers ───────────────────────────────────────────────────
function isPublic(pathname: string): boolean {
  return PUBLIC_ROUTES.some(r => pathname === r || pathname.startsWith(r + '/'))
}

function isAdminRoute(pathname: string): boolean {
  return ADMIN_ROUTES.some(r => pathname === r || pathname.startsWith(r + '/'))
}

function isMemberRoute(pathname: string): boolean {
  return MEMBER_ROUTES.some(r => pathname === r || pathname.startsWith(r + '/'))
}

function isPublicApi(pathname: string): boolean {
  return API_PUBLIC.some(r => pathname.startsWith(r))
}

function isApiRoute(pathname: string): boolean {
  return pathname.startsWith('/api/')
}

// ── Admin roles — can access dashboard ───────────────────────
const ADMIN_ROLES = ['SYSTEM_ADMIN', 'NATIONAL_ADMIN', 'GROUP_ADMIN', 'TREASURER', 'INVESTMENT_MANAGER', 'AUDITOR']

// ── Middleware ────────────────────────────────────────────────
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Always allow public pages and public API routes
  if (isPublic(pathname) || isPublicApi(pathname)) {
    return NextResponse.next()
  }

  // Allow static assets and Next.js internals
  if (
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/favicon') ||
    pathname.includes('.')
  ) {
    return NextResponse.next()
  }

  // ── Extract and verify JWT ────────────────────────────────
  const token = req.cookies.get('access_token')?.value
  let role: string | null = null
  let userId: string | null = null

  if (token) {
    try {
      const { payload } = await jwtVerify(token, JWT_SECRET)
      role   = (payload.role as string) || null
      userId = (payload.sub as string) || null
    } catch {
      // Token invalid or expired
      role   = null
      userId = null
    }
  }

  // ── API route protection ──────────────────────────────────
  if (isApiRoute(pathname)) {
    // User Management API — SYSTEM_ADMIN only
    if (pathname.startsWith('/api/users')) {
      if (!role || role !== 'SYSTEM_ADMIN') {
        return NextResponse.json(
          { success: false, error: 'Access denied. System Admin only.' },
          { status: 403 }
        )
      }
    }

    // All other protected API routes — must be authenticated
    if (!role) {
      return NextResponse.json(
        { success: false, error: 'Unauthorised. Please log in.' },
        { status: 401 }
      )
    }

    return NextResponse.next()
  }

  // ── No token — redirect to login ──────────────────────────
  if (!token || !role) {
    const loginUrl = new URL('/login', req.url)
    loginUrl.searchParams.set('redirect', pathname)
    return NextResponse.redirect(loginUrl)
  }

  // ── Dashboard route — admin roles only ───────────────────
  if (isAdminRoute(pathname)) {
    if (ADMIN_ROLES.includes(role)) {
      return NextResponse.next()
    }
    // MEMBER trying to access dashboard → redirect to portal
    return NextResponse.redirect(new URL('/portal', req.url))
  }

  // ── Portal route — all authenticated users ───────────────
  if (isMemberRoute(pathname)) {
    // Admins can also view the portal (they're members too)
    return NextResponse.next()
  }

  // Default — allow
  return NextResponse.next()
}

// ── Matcher — which routes middleware runs on ─────────────────
export const config = {
  matcher: [
    /*
     * Run on all paths EXCEPT:
     * - _next/static (static files)
     * - _next/image (image optimisation)
     * - favicon.ico
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
