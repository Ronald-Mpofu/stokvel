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

// ── Password ──────────────────────────────────────────────────
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

// ── JWT ───────────────────────────────────────────────────────
export async function signAccessToken(user: SessionUser): Promise<string> {
  return new SignJWT({
    sub: user.id,
    email: user.email,
    role: user.role,
    name: user.fullName,
  })
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
