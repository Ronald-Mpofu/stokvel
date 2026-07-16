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
const PUBLIC_ROUTES   = ['/', '/login', '/register', '/setup', '/invite', '/guarantor']
const ADMIN_ROUTES    = ['/dashboard']
const MEMBER_ROUTES   = ['/portal']
// NOTE: /api/payments/webhook is listed individually — NOT the whole
// /api/payments namespace. Stripe calls it server-to-server with no
// cookie, so it must be public; it authenticates itself by verifying
// the Stripe signature header instead.
const API_PUBLIC      = ['/api/auth/login', '/api/auth/register', '/api/auth/refresh', '/api/auth/logout', '/api/auth/setup-password', '/api/payments/webhook']

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

// Public invitation operations reachable WITHOUT a session:
//   GET  /api/invitations?token=...      → invitee validates the link
//   POST /api/invitations?action=accept  → invitee creates account + joins
// The ?action=accept query lets us whitelist the accept POST here without
// reading the request body in middleware. The route handler independently
// enforces that this public surface can ONLY run the accept path.
function isPublicInvitationApi(req: NextRequest): boolean {
  const { pathname, searchParams } = req.nextUrl
  if (pathname !== '/api/invitations') return false
  if (req.method === 'GET'  && searchParams.get('token')) return true
  if (req.method === 'POST' && searchParams.get('action') === 'accept') return true
  return false
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
  if (isPublic(pathname) || isPublicApi(pathname) || isPublicInvitationApi(req)) {
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
    // /api/payments/ MUST be exempt: an unpaid user calling checkout to
    // pay their joining fee would otherwise be blocked by the very gate
    // they are trying to clear. These routes enforce their own auth.
    if (
      feePaid === false &&
      !FEE_EXEMPT_ROLES.includes(role) &&
      !pathname.startsWith('/api/auth/') &&
      !pathname.startsWith('/api/joining-fee') &&
      !pathname.startsWith('/api/payments/')
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
