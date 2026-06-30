// src/app/api/auth/me/route.ts
// Returns the current logged-in user from the JWT cookie
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma/client'
import { jwtVerify } from 'jose'

export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get('access_token')?.value
    if (!token) {
      // Fallback: return first admin for local dev
      const admin = await prisma.user.findFirst({
        where: { role: { in: ['SYSTEM_ADMIN', 'GROUP_ADMIN'] } },
        select: { id: true, fullName: true, email: true, role: true },
        orderBy: { createdAt: 'asc' },
      })
      return NextResponse.json({ success: true, data: admin, dev: true })
    }

    const secret  = new TextEncoder().encode(process.env.JWT_SECRET || 'stokvel-secret-key-2025')
    const { payload } = await jwtVerify(token, secret)
    const userId  = payload.sub as string

    const user = await prisma.user.findUnique({
      where:  { id: userId },
      select: { id: true, fullName: true, email: true, role: true },
    })

    if (!user) return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 })
    return NextResponse.json({ success: true, data: user })
  } catch (e: any) {
    // Token invalid — return first admin for dev
    const admin = await prisma.user.findFirst({
      where: { role: { in: ['SYSTEM_ADMIN', 'GROUP_ADMIN'] } },
      select: { id: true, fullName: true, email: true, role: true },
      orderBy: { createdAt: 'asc' },
    })
    return NextResponse.json({ success: true, data: admin, dev: true })
  }
}
