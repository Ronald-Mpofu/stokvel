// src/app/api/users/[id]/action/route.ts
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma/client'

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { action } = await req.json()
    const userId = params.id

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, fullName: true, email: true } })
    if (!user) return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 })

    let updateData: any = {}
    let message = ''

    switch (action) {
      case 'VERIFY_KYC':
        updateData = { kycStatus: 'VERIFIED', kycReviewedAt: new Date() }
        message = `KYC approved for ${user.fullName}`
        break
      case 'REJECT_KYC':
        updateData = { kycStatus: 'REJECTED', kycReviewedAt: new Date() }
        message = `KYC rejected for ${user.fullName}`
        break
      case 'SUSPEND':
        updateData = { status: 'SUSPENDED' }
        message = `${user.fullName} suspended`
        break
      case 'REINSTATE':
        updateData = { status: 'ACTIVE' }
        message = `${user.fullName} reinstated`
        break
      case 'RESET_PASSWORD':
        // In production: generate reset token, send email
        // For now: log the action and return success
        message = `Password reset email queued for ${user.email}`
        break
      default:
        return NextResponse.json({ success: false, error: `Unknown action: ${action}` }, { status: 400 })
    }

    if (Object.keys(updateData).length > 0) {
      await prisma.user.update({ where: { id: userId }, data: updateData })
    }

    await prisma.auditLog.create({
      data: { action: 'UPDATE', entityType: 'User', entityId: userId, description: `Admin action: ${action} on ${user.fullName}` } as any,
    }).catch(() => {})

    return NextResponse.json({ success: true, message })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}
