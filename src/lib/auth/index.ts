// src/lib/auth/index.ts
// Authentication utilities — JWT, password hashing, session management

import bcrypt from 'bcryptjs'
import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma/client'
import type { SessionUser, AuthTokenPayload, UserRole } from '@/types'

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'fallback-dev-secret-change-in-production'
)
const JWT_EXPIRY = process.env.JWT_EXPIRY || '15m'
const REFRESH_EXPIRY = process.env.REFRESH_TOKEN_EXPIRY || '7d'

// joiningFeePaid is a raw-SQL column (not in schema.prisma), so it is
// not part of SessionUser. Callers that have loaded it — login and
// refresh — pass it through so it reaches the JWT. Anything else omits
// it and the middleware gate fails open, as before.
export type TokenUser = SessionUser & { joiningFeePaid?: boolean }

// ── Password ──────────────────────────────────────────────────
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

// ── JWT ───────────────────────────────────────────────────────
export async function signAccessToken(user: TokenUser): Promise<string> {
  const claims: Record<string, unknown> = {
    sub: user.id,
    email: user.email,
    role: user.role,
    name: user.fullName,
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
    .sign(JWT_SECRET)
}

export async function signRefreshToken(userId: string): Promise<string> {
  return new SignJWT({ sub: userId, type: 'refresh' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(REFRESH_EXPIRY)
    .sign(JWT_SECRET)
}

export async function verifyToken(token: string): Promise<AuthTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET)
    return payload as unknown as AuthTokenPayload
  } catch {
    return null
  }
}

// ── Session from cookies ──────────────────────────────────────
export async function getSession(): Promise<SessionUser | null> {
  try {
    const cookieStore = cookies()
    const token = cookieStore.get('access_token')?.value
    if (!token) return null
    const payload = await verifyToken(token)
    if (!payload) return null
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true, email: true, fullName: true, role: true,
        tier: true, kycStatus: true, reputationScore: true,
        profilePhotoUrl: true, status: true,
      },
    })
    if (!user || user.status !== 'ACTIVE') return null
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
  } catch {
    return null
  }
}

// ── Session from Request (API routes) ────────────────────────
export async function getSessionFromRequest(req: NextRequest): Promise<SessionUser | null> {
  const authHeader = req.headers.get('authorization')
  const token = authHeader?.replace('Bearer ', '') ||
    req.cookies.get('access_token')?.value
  if (!token) return null
  const payload = await verifyToken(token)
  if (!payload) return null
  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    select: {
      id: true, email: true, fullName: true, role: true,
      tier: true, kycStatus: true, reputationScore: true,
      profilePhotoUrl: true, status: true,
    },
  })
  if (!user || user.status !== 'ACTIVE') return null
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
// Roles that bypass per-group checks entirely.
export const SUPER_ROLES = ['SYSTEM_ADMIN', 'NATIONAL_ADMIN']

/**
 * Can this user manage the given group?
 * True when they created the group (adminUserId) OR hold an ACTIVE
 * GROUP_ADMIN / TREASURER member role in it.
 */
export async function canManageGroup(userId: string, groupId: string): Promise<boolean> {
  const g = await prisma.group.findUnique({ where: { id: groupId }, select: { adminUserId: true } })
  if (g?.adminUserId === userId) return true
  const m = await prisma.groupMember.findFirst({
    where:  { groupId, userId, status: 'ACTIVE', role: { in: ['GROUP_ADMIN', 'TREASURER'] as any } },
    select: { id: true },
  })
  return !!m
}

/**
 * Route guard: verifies the request has a session and the caller may
 * manage `groupId`. Returns null when authorised; a ready NextResponse
 * (401/403) when not. Usage:
 *   const guardErr = await requireGroupManager(req, groupId)
 *   if (guardErr) return guardErr
 */
export async function requireGroupManager(req: NextRequest, groupId: string | null | undefined): Promise<NextResponse | null> {
  const session = await getSessionFromRequest(req)
  if (!session) return unauthorized()
  if (SUPER_ROLES.includes(session.role)) return null
  if (!groupId) return forbidden('Group could not be resolved for this request')
  if (!(await canManageGroup(session.id, groupId))) return forbidden('Not authorised for this group')
  return null
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
  response.cookies.delete('access_token')
  response.cookies.delete('refresh_token')
  return response
}
