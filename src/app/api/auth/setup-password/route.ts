// src/app/api/auth/setup-password/route.ts
// Public — redeems a one-time staff setup token and sets the password.
// GET  ?token=xxx        → validity check (page uses this to show name/expiry state)
// POST { token, password } → set password, mark token used, audit log
// Requires: '/api/auth/setup-password' in middleware API_PUBLIC.

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createHash } from 'crypto'
import prisma from '@/lib/prisma/client'
import { hashPassword } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const setupSchema = z.object({
  token: z.string().length(64, 'Invalid setup link'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
})

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

// Single indexed lookup joining token → user
async function findValidToken(rawToken: string) {
  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT t."id" AS "tokenId", t."userId", t."expiresAt", t."usedAt",
            u."fullName", u."email"
     FROM "UserSetupToken" t
     JOIN "User" u ON u."id" = t."userId"
     WHERE t."tokenHash" = $1
     LIMIT 1`,
    hashToken(rawToken)
  )
  return rows[0] || null
}

export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get('token') || ''
    if (token.length !== 64) {
      return NextResponse.json({ success: false, error: 'Invalid setup link' }, { status: 400 })
    }
    const row = await findValidToken(token)
    if (!row) {
      return NextResponse.json({ success: false, error: 'Setup link not found' }, { status: 404 })
    }
    if (row.usedAt) {
      return NextResponse.json({ success: false, error: 'This setup link has already been used' }, { status: 410 })
    }
    if (new Date(row.expiresAt) < new Date()) {
      return NextResponse.json({ success: false, error: 'This setup link has expired. Ask your administrator for a new one.' }, { status: 410 })
    }
    return NextResponse.json({ success: true, data: { fullName: row.fullName } })
  } catch (e: any) {
    console.error('GET /api/auth/setup-password error:', e?.message)
    return NextResponse.json({ success: false, error: 'Could not validate setup link' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsed = setupSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.errors[0]?.message || 'Invalid input' },
        { status: 400 }
      )
    }
    const { token, password } = parsed.data

    const row = await findValidToken(token)
    if (!row || row.usedAt || new Date(row.expiresAt) < new Date()) {
      return NextResponse.json(
        { success: false, error: 'This setup link is invalid, used, or expired' },
        { status: 410 }
      )
    }

    const passwordHash = await hashPassword(password)

    // Mark used atomically FIRST — a second concurrent redeem must lose.
    const updated = await prisma.$executeRawUnsafe(
      `UPDATE "UserSetupToken" SET "usedAt" = now()
       WHERE "id" = $1 AND "usedAt" IS NULL`,
      row.tokenId
    )
    if (Number(updated) === 0) {
      return NextResponse.json(
        { success: false, error: 'This setup link has already been used' },
        { status: 410 }
      )
    }

    await prisma.user.update({
      where: { id: row.userId },
      data: { passwordHash, emailVerifiedAt: new Date() },
    })

    await prisma.auditLog.create({
      data: {
        userId: row.userId,
        action: 'UPDATE',
        entityType: 'User',
        entityId: row.userId,
        description: `Staff account activated via setup link (${row.email})`,
        ipAddress: req.ip || 'unknown',
        userAgent: req.headers.get('user-agent') || undefined,
      },
    })

    return NextResponse.json({ success: true, message: 'Password set. You can now sign in.' })
  } catch (e: any) {
    console.error('POST /api/auth/setup-password error:', e?.message)
    return NextResponse.json({ success: false, error: 'Could not set password' }, { status: 500 })
  }
}
