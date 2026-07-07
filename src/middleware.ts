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
const API_PUBLIC      = ['/api/auth/login', '/api/auth/register', '/api/auth/refresh', '/api/auth/logout']

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

// ── Joining fee gate ──────────────────────────────────────────
// Staff roles never pay. Community roles (MEMBER, GROUP_ADMIN,
// TREASURER, INVESTMENT_MANAGER) must pay before using the platform.
const FEE_EXEMPT_ROLES = ['SYSTEM_ADMIN', 'NATIONAL_ADMIN', 'AUDITOR']
const FEE_PAGE = '/dashboard/join-fee'

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
  let feePaid: boolean | undefined = undefined

  if (token) {
    try {
      const { payload } = await jwtVerify(token, JWT_SECRET)
      role    = (payload.role as string) || null
      userId  = (payload.sub as string) || null
      // Claim added by login/register. Older tokens won't carry it —
      // undefined means "unknown", and the gate deliberately fails open
      // for unknown so pre-existing sessions are not locked out.
      feePaid = typeof payload.joiningFeePaid === 'boolean'
        ? (payload.joiningFeePaid as boolean)
        : undefined
    } catch {
      // Token invalid or expired
      role    = null
      userId  = null
      feePaid = undefined
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

    // Joining fee gate for APIs — unpaid users may only reach auth
    // and joining-fee endpoints. Prevents bypassing the page gate by
    // calling APIs directly.
    if (
      feePaid === false &&
      !FEE_EXEMPT_ROLES.includes(role) &&
      !pathname.startsWith('/api/auth/') &&
      !pathname.startsWith('/api/joining-fee')
    ) {
      return NextResponse.json(
        { success: false, error: 'Joining fee payment required before using the platform.' },
        { status: 402 }
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

  // ── Joining fee page — reachable by EVERY authenticated user ──
  // Must come BEFORE the admin check: MEMBERs would otherwise be
  // bounced to /portal and could never reach the payment page.
  if (pathname === FEE_PAGE || pathname.startsWith(FEE_PAGE + '/')) {
    return NextResponse.next()
  }

  // ── Joining fee gate ──────────────────────────────────────
  // Explicitly-unpaid community users go to the fee page first.
  // feePaid === undefined (older token) passes — refresh/login
  // will pick up the claim.
  if (feePaid === false && !FEE_EXEMPT_ROLES.includes(role)) {
    return NextResponse.redirect(new URL(FEE_PAGE, req.url))
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
