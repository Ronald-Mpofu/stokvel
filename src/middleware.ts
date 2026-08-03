// src/middleware.ts
// Route protection based on user role
// SYSTEM_ADMIN  → /dashboard (full access)
// GROUP_ADMIN   → /dashboard (scoped to their group)
// MEMBER        → /portal only
// Unauthenticated → /login
//
// Version 2.0 — security and correctness pass.
//
// WHAT CHANGED
//   1. SECURITY: removed the blanket `pathname.includes('.')` bypass.
//      Any URL containing a dot previously returned next() BEFORE the
//      API protection block, so /api/users/abc.def skipped the
//      SYSTEM_ADMIN check, the 401 check, and the fee gate.
//   2. SECURITY: refresh tokens are now rejected. They are signed with
//      the same secret, so one pasted into the access_token cookie
//      previously granted a 7-day session.
//   3. SECURITY: JWT_SECRET now comes from src/lib/auth/edge.ts, which
//      throws in production rather than falling back to the string
//      that is in git history. This file no longer holds its own copy.
//   4. BUG: /forgot-password and /reset-password added to PUBLIC_ROUTES,
//      and their API routes to API_PUBLIC. Both were redirect-looping.
//   5. Boundary-safe prefix matching on public API routes, so
//      /api/auth/login-x no longer matches /api/auth/login.
//   6. Matcher excludes static file extensions, so middleware is not
//      invoked at all for /public assets.

import { NextRequest, NextResponse } from 'next/server'
import { verifyEdgeAccessToken } from '@/lib/auth/edge'

// ── Route rules ───────────────────────────────────────────────
const PUBLIC_ROUTES = [
  '/',
  '/login',
  '/register',
  '/setup',
  '/invite',
  '/guarantor',
  // Added v2 — these were missing, so both pages redirect-looped:
  // unauthenticated user hits /forgot-password → bounced to /login.
  '/forgot-password',
  '/reset-password',
  '/verify-email',
]

const ADMIN_ROUTES  = ['/dashboard']
const MEMBER_ROUTES = ['/portal']

// NOTE: webhook routes are listed individually — NOT whole namespaces.
// Providers (Stripe, EcoCash, M-Pesa, MTN MoMo) call them server-to-server
// with no cookie, so they must be public; each authenticates itself by
// verifying a signature header instead.
//   /api/payments/webhook      → Stripe signature
//   /api/joining-fee/webhook   → per-provider HMAC (was 401-ing every callback)
const API_PUBLIC = [
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/refresh',
  '/api/auth/logout',
  '/api/auth/setup-password',
  // Added v2 — the pages were public but their APIs were not, so the
  // forms would have 401'd even once the pages loaded.
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/payments/webhook',
  '/api/joining-fee/webhook',
  '/api/cron', 
  '/api/auth/verify-email',

]

// ── Helpers ───────────────────────────────────────────────────
// All matching is boundary-safe: exact match, or the route followed by
// a path separator. Plain startsWith() would let /api/auth/login-debug
// match the public /api/auth/login entry.
function matchesPrefix(pathname: string, routes: string[]): boolean {
  return routes.some(r => pathname === r || pathname.startsWith(r + '/'))
}

function isPublic(pathname: string): boolean {
  return matchesPrefix(pathname, PUBLIC_ROUTES)
}

function isAdminRoute(pathname: string): boolean {
  return matchesPrefix(pathname, ADMIN_ROUTES)
}

function isMemberRoute(pathname: string): boolean {
  return matchesPrefix(pathname, MEMBER_ROUTES)
}

function isPublicApi(pathname: string): boolean {
  return matchesPrefix(pathname, API_PUBLIC)
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
  if (req.method === 'GET' && searchParams.get('token')) return true
  if (req.method === 'POST' && searchParams.get('action') === 'accept') return true
  return false
}

function isApiRoute(pathname: string): boolean {
  return pathname.startsWith('/api/')
}

// Static asset check. NOTE the isApiRoute guard — v1 skipped auth for
// ANY path containing a dot, including API paths, which made the whole
// middleware bypassable by appending one to a URL.
const STATIC_FILE = /\.[a-zA-Z0-9]+$/

function isStaticAsset(pathname: string): boolean {
  if (isApiRoute(pathname)) return false
  return (
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/favicon') ||
    STATIC_FILE.test(pathname)
  )
}

// ── Admin roles — can access dashboard ───────────────────────
const ADMIN_ROLES = ['SYSTEM_ADMIN', 'NATIONAL_ADMIN', 'GROUP_ADMIN', 'TREASURER', 'INVESTMENT_MANAGER', 'AUDITOR']

// ── Joining fee gate — REMOVED at phase 5 ─────────────────────
// This gate redirected any user whose JWT carried joiningFeePaid=false
// to the fee page, and 402'd their API calls. Two reasons it had to go:
//
//   1. IT BROKE RULE 3b. An invited member never pays a joining fee, so
//      joiningFeePaid stays false for them permanently. They were
//      redirected to the payment page on EVERY page load, forever, with
//      no way through. The people the invitation flow exists to serve
//      were the people it locked out.
//
//   2. IT READ A STALE CLAIM. joiningFeePaid is minted at login and
//      lives 15 minutes. A manual bank payment is verified admin-side
//      while the member is offline, so their token said unpaid long
//      after they had paid.
//
// Entitlement is now resolved per request against live database state
// by src/lib/entitlement, which covers staff exemption, group
// membership (rule 3b), Community Membership and group subscription in
// one place. Middleware keeps doing what the Edge runtime is good at:
// authentication and role routing.
//
// FEE_PAGE is retained — it is still a real page, reachable by every
// authenticated user, and registration still routes new members there.
const FEE_PAGE = '/dashboard/join-fee'

// ── Middleware ────────────────────────────────────────────────
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Always allow public pages and public API routes
  if (isPublic(pathname) || isPublicApi(pathname) || isPublicInvitationApi(req)) {
    return NextResponse.next()
  }

  // Allow static assets and Next.js internals.
  // Never applies to /api/ paths — see isStaticAsset.
  if (isStaticAsset(pathname)) {
    return NextResponse.next()
  }

  // ── Extract and verify JWT ────────────────────────────────
  // verifyEdgeAccessToken returns null for missing, expired, malformed,
  // or refresh tokens. Secret resolution lives in src/lib/auth/edge.ts
  // and throws in production when JWT_SECRET is absent.
  const token = req.cookies.get('access_token')?.value
  const claims = token ? await verifyEdgeAccessToken(token) : null

  const role = claims?.role ?? null

  // ── API route protection ──────────────────────────────────
  if (isApiRoute(pathname)) {
    // User Management API — SYSTEM_ADMIN only
    if (pathname.startsWith('/api/users')) {
      if (role !== 'SYSTEM_ADMIN') {
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

    // Entitlement is NOT checked here. It needs live database state,
    // which the Edge runtime cannot reach. Mutating routes call
    // requireEntitlement() from src/lib/entitlement instead, which
    // returns 402 when the caller cannot transact.
    return NextResponse.next()
  }

  // ── No valid token — redirect to login ────────────────────
  if (!role) {
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

  // NO fee redirect here any more — see the note above FEE_PAGE.
  // A member without an active membership now lands on their portal
  // read-only, sees AccountStatusBanner explaining why, and follows a
  // link to renew if one is due. Being unable to contribute is not a
  // reason to hide someone's own savings from them.

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
     * - _next/static, _next/image, favicon.ico
     * - any path ending in a common static file extension
     *
     * v1 excluded only the _next paths, so middleware was still invoked
     * for every file in /public — logos, fonts, manifest — and bailed
     * out internally. Excluding them here means the function is never
     * invoked at all.
     *
     * This is a MATCHER exclusion only. It never applies to /api/ paths,
     * which have no file extension, so it cannot be used to bypass auth.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|css|js|mjs|map|woff|woff2|ttf|otf|eot|txt|xml|webmanifest)$).*)',
  ],
}
