// src/lib/auth/index.ts
// Authentication utilities — JWT, password hashing, session management
// Version 2.0 — performance and security pass
//
// WHAT CHANGED FROM v1
//   1. Guards no longer hit the database. getClaimsFromRequest() reads
//      the verified JWT and returns immediately. requireGroupManager
//      drops from 3 sequential queries to 1.
//   2. canManageGroup() merges its two queries into one relation filter.
//   3. Refresh tokens can no longer be used as access tokens.
//   4. JWT_SECRET fallback throws in production instead of silently
//      signing with a value that is in git history.
//   5. Per-request memoisation so repeated calls in one request cost
//      one query, not N.
//
// EVERY v1 EXPORT IS PRESERVED with identical signatures and semantics.
// Existing call sites keep working unchanged; they simply get faster
// where they were using the guards.

import bcrypt from 'bcryptjs'
import { cache } from 'react'
import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma/client'
import type { SessionUser, AuthTokenPayload, UserRole } from '@/types'

const JWT_EXPIRY = process.env.JWT_EXPIRY || '15m'
const REFRESH_EXPIRY = process.env.REFRESH_TOKEN_EXPIRY || '7d'

// bcrypt cost. 12 is ~4096 rounds; 10 is ~1024 and is the accepted
// production floor. Configurable so it can be tuned without a code
// change. Never set below 10.
const BCRYPT_COST = Math.max(10, Number(process.env.BCRYPT_COST) || 12)

// ── Secret resolution ─────────────────────────────────────────
// Resolved lazily, not at module load, so a missing env var surfaces as
// a clear runtime error rather than breaking the build. In production a
// missing secret THROWS: signing with a fallback that lives in git
// history would let anyone forge a SYSTEM_ADMIN token.
let cachedSecret: Uint8Array | null = null

function getJwtSecret(): Uint8Array {
  if (cachedSecret) return cachedSecret

  const raw = process.env.JWT_SECRET
  const isProd = process.env.NODE_ENV === 'production'

  if (!raw) {
    if (isProd) {
      throw new Error(
        '[auth] JWT_SECRET is not set. Refusing to sign or verify tokens ' +
        'with the development fallback in production.'
      )
    }
    console.warn('[auth] JWT_SECRET not set — using INSECURE development fallback.')
    cachedSecret = new TextEncoder().encode('fallback-dev-secret-change-in-production')
    return cachedSecret
  }

  if (isProd && raw.length < 32) {
    throw new Error(
      '[auth] JWT_SECRET must be at least 32 characters. ' +
      'Generate one with: openssl rand -base64 48'
    )
  }

  cachedSecret = new TextEncoder().encode(raw)
  return cachedSecret
}

// joiningFeePaid is a raw-SQL column (not in schema.prisma), so it is
// not part of SessionUser. Callers that have loaded it — login and
// refresh — pass it through so it reaches the JWT. Anything else omits
// it and the middleware gate fails open, as before.
export type TokenUser = SessionUser & { joiningFeePaid?: boolean }

// Verified JWT claims. This is what the guards use. No database.
export type AuthClaims = {
  id: string
  email: string
  role: UserRole
  fullName: string
  joiningFeePaid?: boolean
}

// ── Password ──────────────────────────────────────────────────
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

// Constant-ish-time compare for the "user not found" path. Returning
// early when no user matches makes that path measurably faster, which
// lets an attacker enumerate the user table with a stopwatch. Call this
// with `null` instead of skipping the compare.
const DUMMY_HASH = '$2a$12$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy'

export async function verifyPasswordSafe(
  password: string,
  hash: string | null | undefined
): Promise<boolean> {
  const ok = await bcrypt.compare(password, hash || DUMMY_HASH)
  return hash ? ok : false
}

// True when a stored hash was produced at a different cost than the
// current setting. Call after a successful login to re-hash gradually:
//   if (needsRehash(user.passwordHash)) { ...update with hashPassword() }
export function needsRehash(hash: string): boolean {
  const m = /^\$2[aby]\$(\d{2})\$/.exec(hash)
  return m ? Number(m[1]) !== BCRYPT_COST : true
}

// ── JWT ───────────────────────────────────────────────────────
export async function signAccessToken(user: TokenUser): Promise<string> {
  const claims: Record<string, unknown> = {
    sub: user.id,
    email: user.email,
    role: user.role,
    name: user.fullName,
    typ: 'access',
  }

  // Only emit the claim when the caller actually knows the value.
  // Defaulting an unknown to `false` would lock the user out: the
  // middleware treats `false` as "unpaid — redirect to fee page" but
  // treats `undefined` as "unknown — allow through".
  if (typeof user.joiningFeePaid === 'boolean') {
    claims.joiningFeePaid = user.joiningFeePaid
  }

  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(JWT_EXPIRY)
    .sign(getJwtSecret())
}

export async function signRefreshToken(userId: string): Promise<string> {
  return new SignJWT({ sub: userId, type: 'refresh', typ: 'refresh' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(REFRESH_EXPIRY)
    .sign(getJwtSecret())
}

/**
 * Verify any token. Preserved from v1 for compatibility.
 * Prefer verifyAccessToken / verifyRefreshToken — this one does not
 * check what kind of token it was handed.
 */
export async function verifyToken(token: string): Promise<AuthTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret())
    return payload as unknown as AuthTokenPayload
  } catch {
    return null
  }
}

/**
 * Verify a token and reject refresh tokens.
 *
 * SECURITY: v1 signed refresh tokens with the same secret and never
 * checked the type, so a 7-day refresh token was accepted anywhere an
 * access token was, defeating the 15-minute expiry.
 *
 * Backwards compatible: v1 access tokens carry no `typ` claim and still
 * pass. Only tokens explicitly marked as refresh are rejected.
 */
export async function verifyAccessToken(token: string): Promise<AuthTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret())
    if (payload.typ === 'refresh' || (payload as any).type === 'refresh') return null
    if (!payload.sub) return null
    return payload as unknown as AuthTokenPayload
  } catch {
    return null
  }
}

/** Verify a refresh token. Rejects access tokens. */
export async function verifyRefreshToken(token: string): Promise<{ sub: string } | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret())
    const isRefresh = payload.typ === 'refresh' || (payload as any).type === 'refresh'
    if (!isRefresh || !payload.sub) return null
    return { sub: String(payload.sub) }
  } catch {
    return null
  }
}

// ── Claims (ZERO database queries) ────────────────────────────
// This is what authorisation should use. Verifying a signature is a few
// hundred microseconds of local CPU. Fetching the same data from the
// database is a network round trip.
//
// TRADE-OFF: claims are a snapshot from when the token was issued. If a
// user is suspended or demoted, their existing token stays valid until
// it expires. With a 15-minute access token that window is bounded and
// this is the standard trade. Where it is unacceptable — destructive or
// financial operations — pass { verifyStatus: true } to the guards
// below, which adds one query to re-check live status.

function claimsFromPayload(payload: AuthTokenPayload | null): AuthClaims | null {
  if (!payload?.sub) return null
  const p = payload as any
  return {
    id: String(payload.sub),
    email: String(p.email ?? ''),
    role: p.role as UserRole,
    fullName: String(p.name ?? ''),
    joiningFeePaid:
      typeof p.joiningFeePaid === 'boolean' ? p.joiningFeePaid : undefined,
  }
}

function tokenFromRequest(req: NextRequest): string | null {
  const authHeader = req.headers.get('authorization')
  return (
    authHeader?.replace('Bearer ', '') ||
    req.cookies.get('access_token')?.value ||
    null
  )
}

// Per-request memo. A single request may call the guards several times;
// without this each call re-verifies the signature.
const claimsCache = new WeakMap<NextRequest, AuthClaims | null>()

/** Verified claims from an API request. No database. */
export async function getClaimsFromRequest(req: NextRequest): Promise<AuthClaims | null> {
  if (claimsCache.has(req)) return claimsCache.get(req)!
  const token = tokenFromRequest(req)
  const claims = token ? claimsFromPayload(await verifyAccessToken(token)) : null
  claimsCache.set(req, claims)
  return claims
}

/** Verified claims from cookies (server components). No database. */
export const getClaims = cache(async (): Promise<AuthClaims | null> => {
  try {
    const token = cookies().get('access_token')?.value
    if (!token) return null
    return claimsFromPayload(await verifyAccessToken(token))
  } catch {
    return null
  }
})

// ── Session (database-backed) ─────────────────────────────────
// Use ONLY where you need fields the token does not carry — tier,
// kycStatus, reputationScore, profilePhotoUrl — or where live status
// must be confirmed. For authorisation, use the claims helpers above.

const SESSION_SELECT = {
  id: true, email: true, fullName: true, role: true,
  tier: true, kycStatus: true, reputationScore: true,
  profilePhotoUrl: true, status: true,
} as const

type SessionRow = {
  id: string
  email: string
  fullName: string
  role: string
  tier: string
  kycStatus: string
  reputationScore: unknown
  profilePhotoUrl: string | null
  status: string
}

function toSessionUser(user: SessionRow): SessionUser {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role as UserRole,
    tier: user.tier as any,
    kycStatus: user.kycStatus as any,
    reputationScore: Number(user.reputationScore),
    profilePhotoUrl: user.profilePhotoUrl,
  }
}

async function loadSession(userId: string): Promise<SessionUser | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: SESSION_SELECT,
  })
  if (!user || user.status !== 'ACTIVE') return null
  return toSessionUser(user as SessionRow)
}

/**
 * Full session from cookies. One database query.
 * Memoised per request — a layout and a page both calling this cost
 * one query between them, not two.
 */
export const getSession = cache(async (): Promise<SessionUser | null> => {
  try {
    const claims = await getClaims()
    if (!claims) return null
    return await loadSession(claims.id)
  } catch {
    return null
  }
})

const sessionCache = new WeakMap<NextRequest, SessionUser | null>()

/** Full session from an API request. One database query, memoised per request. */
export async function getSessionFromRequest(req: NextRequest): Promise<SessionUser | null> {
  if (sessionCache.has(req)) return sessionCache.get(req)!
  const claims = await getClaimsFromRequest(req)
  const session = claims ? await loadSession(claims.id) : null
  sessionCache.set(req, session)
  return session
}

// ── Role guards ───────────────────────────────────────────────
export const ROLE_HIERARCHY: Record<UserRole, number> = {
  SYSTEM_ADMIN: 7,
  NATIONAL_ADMIN: 6,
  GROUP_ADMIN: 5,
  TREASURER: 4,
  INVESTMENT_MANAGER: 3,
  MEMBER: 2,
  AUDITOR: 1,
}

export function hasPermission(userRole: UserRole, requiredRole: UserRole): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole]
}

// ── API Route guard helper ────────────────────────────────────
export function unauthorized(message = 'Unauthorized'): NextResponse {
  return NextResponse.json({ success: false, error: message }, { status: 401 })
}

export function forbidden(message = 'Forbidden'): NextResponse {
  return NextResponse.json({ success: false, error: message }, { status: 403 })
}

// ── Group-scoped authorisation (BR 4–6) ──────────────────────
export const SUPER_ROLES = ['SYSTEM_ADMIN', 'NATIONAL_ADMIN']

/**
 * Can this user manage the given group?
 * True when they created the group (adminUserId) OR hold an ACTIVE
 * GROUP_ADMIN / TREASURER member role in it.
 *
 * ONE query. v1 used two sequential queries; the relation filter below
 * compiles to a single statement with an EXISTS subquery, covered by
 * idx_groupmember_groupid_status.
 */
export async function canManageGroup(userId: string, groupId: string): Promise<boolean> {
  const hit = await prisma.group.findFirst({
    where: {
      id: groupId,
      OR: [
        { adminUserId: userId },
        {
          members: {
            some: {
              userId,
              status: 'ACTIVE',
              role: { in: ['GROUP_ADMIN', 'TREASURER'] as any },
            },
          },
        },
      ],
    },
    select: { id: true },
  })
  return !!hit
}

export type GuardOptions = {
  /**
   * Re-check live account status against the database, costing one
   * extra query. Default false — the 15-minute token expiry bounds how
   * long a suspended user stays usable.
   *
   * Set true on destructive and financial operations: member removal,
   * scheme deletion, payouts, disbursements.
   */
  verifyStatus?: boolean
}

/**
 * Route guard: verifies the request has a session and the caller may
 * manage `groupId`. Returns null when authorised; a ready NextResponse
 * (401/403) when not. Usage is unchanged from v1:
 *   const guardErr = await requireGroupManager(req, groupId)
 *   if (guardErr) return guardErr
 *
 * Query count: 3 in v1 → 1 here (0 for super roles).
 */
export async function requireGroupManager(
  req: NextRequest,
  groupId: string | null | undefined,
  opts: GuardOptions = {}
): Promise<NextResponse | null> {
  const claims = opts.verifyStatus
    ? await getSessionFromRequest(req)
    : await getClaimsFromRequest(req)

  if (!claims) return unauthorized()
  if (SUPER_ROLES.includes(claims.role)) return null
  if (!groupId) return forbidden('Group could not be resolved for this request')
  if (!(await canManageGroup(claims.id, groupId))) {
    return forbidden('Not authorised for this group')
  }
  return null
}

/**
 * Guard for routes needing only a signed-in user. Zero queries by
 * default. Returns the claims on success so the handler does not have
 * to resolve the session again.
 */
export async function requireAuth(
  req: NextRequest,
  opts: GuardOptions = {}
): Promise<{ error: NextResponse; claims: null } | { error: null; claims: AuthClaims }> {
  const claims = opts.verifyStatus
    ? await getSessionFromRequest(req)
    : await getClaimsFromRequest(req)
  if (!claims) return { error: unauthorized(), claims: null }
  return { error: null, claims: claims as AuthClaims }
}

/**
 * Guard for a minimum role. Zero queries by default.
 *   const { error, claims } = await requireRole(req, 'TREASURER')
 *   if (error) return error
 */
export async function requireRole(
  req: NextRequest,
  requiredRole: UserRole,
  opts: GuardOptions = {}
): Promise<{ error: NextResponse; claims: null } | { error: null; claims: AuthClaims }> {
  const { error, claims } = await requireAuth(req, opts)
  if (error) return { error, claims: null }
  if (!hasPermission(claims.role, requiredRole)) {
    return { error: forbidden(`Requires ${requiredRole} or higher`), claims: null }
  }
  return { error: null, claims }
}

// ── Set auth cookies ──────────────────────────────────────────
export function setAuthCookies(
  response: NextResponse,
  accessToken: string,
  refreshToken: string
): NextResponse {
  const isProd = process.env.NODE_ENV === 'production'
  response.cookies.set('access_token', accessToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: 60 * 15,  // 15 minutes
    path: '/',
  })
  response.cookies.set('refresh_token', refreshToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7,  // 7 days
    path: '/',
  })
  return response
}

export function clearAuthCookies(response: NextResponse): NextResponse {
  // Explicit path so deletion matches how the cookies were written.
  response.cookies.set('access_token', '', { maxAge: 0, path: '/' })
  response.cookies.set('refresh_token', '', { maxAge: 0, path: '/' })
  return response
}
