// src/app/api/auth/reset-password/route.ts
// Step 2 of password reset: user submits the raw token (from the URL) plus a
// new password. We hash the token, find a matching row that is unused and
// unexpired, set the new password hash, and burn the token.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createHash } from 'crypto'
import prisma from '@/lib/prisma/client'
import { hashPassword } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const schema = z.object({
  token:    z.string().min(20),
  password: z.string().min(8, 'Password must be at least 8 characters'),
})

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { token, password } = schema.parse(body)

    const tokenHash = hashToken(token)

    const rows = await prisma.$queryRawUnsafe(
      `SELECT id, "userId"
       FROM "PasswordResetToken"
       WHERE "tokenHash" = $1 AND "usedAt" IS NULL AND "expiresAt" > NOW()
       LIMIT 1`,
      tokenHash,
    ) as any[]

    if (!rows.length) {
      return NextResponse.json(
        { success: false, error: 'This reset link is invalid or has expired. Please request a new one.' },
        { status: 400 },
      )
    }

    const { id: tokenId, userId } = rows[0]
    const newHash = await hashPassword(password)

    // Update the password, then burn the token. Kept as two statements so
    // passwordHash (a real schema.prisma column) uses the typed client while
    // the raw-SQL token table stays on $executeRawUnsafe.
    await prisma.user.update({ where: { id: userId }, data: { passwordHash: newHash } })
    await prisma.$executeRawUnsafe(
      `UPDATE "PasswordResetToken" SET "usedAt" = NOW() WHERE id = $1`,
      tokenId,
    )

    return NextResponse.json({ success: true, message: 'Your password has been reset. You can now sign in.' })
  } catch (e: any) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: e.errors.map(x => x.message).join('; ') }, { status: 400 })
    }
    console.error('POST /api/auth/reset-password error:', e?.message)
    return NextResponse.json({ success: false, error: 'Could not reset password. Please try again.' }, { status: 500 })
  }
}
