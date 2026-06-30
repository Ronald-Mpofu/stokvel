// src/app/api/auth/me/route.ts
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma/client'
import { jwtVerify } from 'jose'

export async function GET(req: NextRequest) {
  // 1. Dev override — ?as=email (checked FIRST so it always wins in dev)
  const asEmail = req.nextUrl.searchParams.get('as')
  if (asEmail) {
    const user = await prisma.user.findUnique({
      where:  { email: asEmail },
      select: { id: true, fullName: true, email: true, role: true },
    })
    if (user) return NextResponse.json({ success: true, data: user, dev: true })
    return NextResponse.json({ success: false, error: `No user found with email: ${asEmail}` }, { status: 404 })
  }

  // 2. JWT cookie
  try {
    const token = req.cookies.get('access_token')?.value
    if (token) {
      const secret = new TextEncoder().encode(process.env.JWT_SECRET || 'stokvel-secret-key-2025')
      const { payload } = await jwtVerify(token, secret)
      const user = await prisma.user.findUnique({
        where:  { id: payload.sub as string },
        select: { id: true, fullName: true, email: true, role: true },
      })
      if (user) return NextResponse.json({ success: true, data: user })
    }
  } catch {
    // No valid JWT — fall through
  }

  // 3. Portal user cookie
  const portalUserId = req.cookies.get('portal_user_id')?.value
  if (portalUserId) {
    const user = await prisma.user.findUnique({
      where:  { id: portalUserId },
      select: { id: true, fullName: true, email: true, role: true },
    })
    if (user) return NextResponse.json({ success: true, data: user })
  }

  // 4. Fallback — first admin for local dev
  const admin = await prisma.user.findFirst({
    where:   { role: { in: ['SYSTEM_ADMIN', 'GROUP_ADMIN'] } },
    select:  { id: true, fullName: true, email: true, role: true },
    orderBy: { createdAt: 'asc' },
  })
  return NextResponse.json({ success: true, data: admin, dev: true })
}
