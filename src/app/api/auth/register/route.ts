// src/app/api/auth/register/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma/client'
import { hashPassword } from '@/lib/auth'
import { sendSms, SMS_TEMPLATES } from '@/lib/notifications/sms'

const registerSchema = z.object({
  fullName: z.string().min(2).max(100),
  email: z.string().email(),
  phone: z.string().regex(/^\+?[0-9]{9,15}$/, 'Invalid phone number'),
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Must contain uppercase')
    .regex(/[0-9]/, 'Must contain number'),
  country: z.string().optional(),
  city: z.string().optional(),
  referralCode: z.string().optional(),
  preferredCurrency: z.enum(['USD','ZAR','ZWG','KES','TZS','UGX','ZMW','BWP','MWK','EUR','GBP']).default('USD'),
})

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const data = registerSchema.parse(body)

    // Check uniqueness
    const existing = await prisma.user.findFirst({
      where: { OR: [{ email: data.email.toLowerCase() }, { phone: data.phone }] },
    })
    if (existing) {
      const field = existing.email === data.email.toLowerCase() ? 'email' : 'phone'
      return NextResponse.json(
        { success: false, error: `An account with this ${field} already exists` },
        { status: 409 }
      )
    }

    // Resolve referrer
    let referredById: string | undefined
    if (data.referralCode) {
      const referrer = await prisma.user.findUnique({
        where: { referralCode: data.referralCode },
        select: { id: true },
      })
      referredById = referrer?.id
    }

    const passwordHash = await hashPassword(data.password)

    const user = await prisma.user.create({
      data: {
        fullName: data.fullName,
        email: data.email.toLowerCase(),
        phone: data.phone,
        passwordHash,
        country: data.country,
        city: data.city,
        referredById,
        preferredCurrency: data.preferredCurrency,
        role: 'MEMBER',
      },
      select: { id: true, email: true, fullName: true, referralCode: true },
    })

    // Audit log
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: 'CREATE',
        entityType: 'User',
        entityId: user.id,
        ipAddress: req.ip || 'unknown',
        description: `New member registration: ${user.email}`,
      },
    })

    // Welcome SMS
    await sendSms({
      to: data.phone,
      userId: user.id,
      message: SMS_TEMPLATES.welcomeMember(data.fullName, 'Stokvel Platform'),
      templateId: 'welcome_member',
    })

    return NextResponse.json({
      success: true,
      data: { userId: user.id, email: user.email },
      message: 'Registration successful. Please complete KYC verification.',
    }, { status: 201 })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', details: error.errors },
        { status: 400 }
      )
    }
    console.error('Registration error:', error)
    return NextResponse.json(
      { success: false, error: 'Registration failed. Please try again.' },
      { status: 500 }
    )
  }
}
