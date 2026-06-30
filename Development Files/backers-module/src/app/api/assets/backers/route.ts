// src/app/api/assets/backers/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma/client'
import Decimal from 'decimal.js'

// ── Schemas ───────────────────────────────────────────────────
const registerSchema = z.object({
  assetId:    z.string().uuid(),
  fullName:   z.string().min(2).max(100),
  email:      z.string().email(),
  phone:      z.string().min(7).max(20),
  nationalId: z.string().optional(),
  country:    z.string().optional(),
  city:       z.string().optional(),
  occupation: z.string().optional(),
  agreedToTerms: z.boolean().refine(v => v === true, 'Must agree to terms'),
  referralCode: z.string().optional(),
})

const approveSchema = z.object({
  backerId: z.string().uuid(),
  action:   z.enum(['APPROVE','REJECT','SUSPEND','REINSTATE']),
  reason:   z.string().optional(),
  approvedById: z.string().uuid().optional(),
})

const contributeSchema = z.object({
  backerId:      z.string().uuid(),
  assetId:       z.string().uuid(),
  amount:        z.coerce.number().positive(),
  paymentMethod: z.string().default('BANK_TRANSFER'),
  paymentRef:    z.string().optional(),
  notes:         z.string().optional(),
  recordedById:  z.string().optional(),
})

const kycSchema = z.object({
  backerId:      z.string().uuid(),
  action:        z.enum(['SUBMIT','VERIFY','REJECT']),
  documentUrl:   z.string().optional(),
  rejectionNote: z.string().optional(),
  verifiedById:  z.string().optional(),
})

// ── GET — fetch backers for an asset ─────────────────────────
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const assetId  = searchParams.get('assetId')
    const backerId = searchParams.get('backerId')

    // Single backer detail
    if (backerId) {
      const backer = await prisma.assetBacker.findUnique({
        where: { id: backerId },
        include: {
          contributions: { orderBy: { createdAt: 'desc' } },
          asset:         { select: { name: true, targetAmount: true, raisedAmount: true, group: { select: { name: true, currency: true } } } },
        },
      })
      if (!backer) return NextResponse.json({ success: false, error: 'Backer not found' }, { status: 404 })
      return NextResponse.json({ success: true, data: formatBacker(backer) })
    }

    if (!assetId) return NextResponse.json({ success: false, error: 'assetId required' }, { status: 400 })

    const [backers, asset] = await Promise.all([
      prisma.assetBacker.findMany({
        where: { assetId },
        include: { contributions: { orderBy: { createdAt: 'desc' } } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.asset.findUnique({
        where: { id: assetId },
        select: { name: true, targetAmount: true, raisedAmount: true, allowOutsiders: true, group: { select: { name: true, currency: true } } },
      }),
    ])

    if (!asset) return NextResponse.json({ success: false, error: 'Asset not found' }, { status: 404 })

    // Summary stats
    const active    = backers.filter(b => b.status === 'ACTIVE')
    const pending   = backers.filter(b => ['PENDING_KYC','PENDING_APPROVAL'].includes(b.status))
    const totalBacked = backers.reduce((s, b) => s + Number(b.totalContributed), 0)

    return NextResponse.json({
      success: true,
      data: {
        asset: {
          id:             assetId,
          name:           asset.name,
          targetAmount:   Number(asset.targetAmount),
          raisedAmount:   Number(asset.raisedAmount),
          allowOutsiders: asset.allowOutsiders,
          currency:       asset.group.currency,
          groupName:      asset.group.name,
        },
        backers: backers.map(formatBacker),
        summary: {
          total:       backers.length,
          active:      active.length,
          pending:     pending.length,
          totalBacked,
          totalOwnership: active.reduce((s, b) => s + Number(b.ownershipPct), 0),
        },
      },
    })
  } catch (e: any) {
    console.error('GET /api/assets/backers error:', e)
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}

// ── POST — register new backer ────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { action } = body

    // Route to sub-actions
    if (action === 'APPROVE' || action === 'REJECT' || action === 'SUSPEND' || action === 'REINSTATE') {
      return handleApproval(body)
    }
    if (action === 'CONTRIBUTE') {
      return handleContribution(body)
    }
    if (action === 'KYC') {
      return handleKyc(body)
    }

    // Default: register new backer
    const data = registerSchema.parse(body)

    // Check asset allows outsiders
    const asset = await prisma.asset.findUnique({
      where: { id: data.assetId },
      select: { allowOutsiders: true, name: true, group: { select: { currency: true } } },
    })
    if (!asset) return NextResponse.json({ success: false, error: 'Asset not found' }, { status: 404 })
    if (!asset.allowOutsiders) return NextResponse.json({ success: false, error: 'This campaign is not open to outside contributors' }, { status: 403 })

    // Check not already registered
    const existing = await prisma.assetBacker.findUnique({
      where: { assetId_email: { assetId: data.assetId, email: data.email.toLowerCase() } },
    })
    if (existing) return NextResponse.json({ success: false, error: 'An application with this email already exists for this campaign' }, { status: 409 })

    // Find referrer
    let referredById: string | undefined
    if (data.referralCode) {
      const ref = await prisma.assetBacker.findUnique({ where: { referralCode: data.referralCode } })
      referredById = ref?.id
    }

    const backer = await prisma.assetBacker.create({
      data: {
        assetId:          data.assetId,
        fullName:         data.fullName,
        email:            data.email.toLowerCase(),
        phone:            data.phone,
        nationalId:       data.nationalId,
        country:          data.country,
        city:             data.city,
        occupation:       data.occupation,
        currency:         asset.group.currency as any,
        agreedToTermsAt:  new Date(),
        referredById,
        status:           'PENDING_KYC',
        kycStatus:        'NOT_SUBMITTED',
      },
    })

    await prisma.auditLog.create({
      data: {
        action:      'CREATE',
        entityType:  'AssetBacker',
        entityId:    backer.id,
        description: `New backer registered: ${data.fullName} (${data.email}) for asset "${asset.name}"`,
      },
    })

    return NextResponse.json({
      success: true,
      data:    { id: backer.id, referralCode: backer.referralCode },
      message: `Application received for ${data.fullName}. Please submit your KYC documents to proceed.`,
    }, { status: 201 })

  } catch (e: any) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ success: false, error: 'Validation failed', details: e.errors.map(x => x.message).join('; ') }, { status: 400 })
    }
    console.error('POST /api/assets/backers error:', e)
    return NextResponse.json({ success: false, error: e.message || 'Failed' }, { status: 500 })
  }
}

// ── Approval handler ──────────────────────────────────────────
async function handleApproval(body: any): Promise<NextResponse> {
  const { backerId, action, reason, approvedById } = approveSchema.parse(body)

  const backer = await prisma.assetBacker.findUnique({ where: { id: backerId }, include: { asset: true } })
  if (!backer) return NextResponse.json({ success: false, error: 'Backer not found' }, { status: 404 })

  const updateData: any = {}
  let message = ''

  if (action === 'APPROVE') {
    if (backer.kycStatus !== 'VERIFIED') return NextResponse.json({ success: false, error: 'KYC must be verified before approving' }, { status: 400 })
    updateData.status      = 'ACTIVE'
    updateData.approvedAt  = new Date()
    updateData.approvedById = approvedById
    message = `${backer.fullName} approved as a backer.`
  } else if (action === 'REJECT') {
    updateData.status          = 'REJECTED'
    updateData.rejectedAt      = new Date()
    updateData.rejectionReason = reason
    message = `${backer.fullName} application rejected.`
  } else if (action === 'SUSPEND') {
    updateData.status = 'SUSPENDED'
    message = `${backer.fullName} suspended.`
  } else if (action === 'REINSTATE') {
    updateData.status = 'ACTIVE'
    message = `${backer.fullName} reinstated.`
  }

  await prisma.assetBacker.update({ where: { id: backerId }, data: updateData })
  await prisma.auditLog.create({
    data: { action:'UPDATE', entityType:'AssetBacker', entityId:backerId, description:`${action}: ${backer.fullName}. ${reason||''}` },
  })

  return NextResponse.json({ success: true, message })
}

// ── Contribution handler ──────────────────────────────────────
async function handleContribution(body: any): Promise<NextResponse> {
  const data = contributeSchema.parse(body)

  const backer = await prisma.assetBacker.findUnique({
    where: { id: data.backerId },
    include: { asset: { include: { backers: { where: { status: 'ACTIVE' } }, ownerships: true, group: { select: { currency: true } } } } },
  })
  if (!backer) return NextResponse.json({ success: false, error: 'Backer not found' }, { status: 404 })
  if (backer.status !== 'ACTIVE') return NextResponse.json({ success: false, error: 'Backer must be active to contribute' }, { status: 400 })

  const newTotal = new Decimal(backer.totalContributed).plus(data.amount)

  await prisma.$transaction(async (tx) => {
    // Record contribution
    await tx.backerContribution.create({
      data: {
        backerId:      data.backerId,
        assetId:       data.assetId,
        amount:        data.amount,
        currency:      backer.asset.group.currency as any,
        paymentMethod: data.paymentMethod,
        paymentRef:    data.paymentRef,
        notes:         data.notes,
        recordedById:  data.recordedById,
      },
    })

    // Update backer total
    await tx.assetBacker.update({
      where: { id: data.backerId },
      data:  { totalContributed: newTotal },
    })

    // Update asset raised amount
    await tx.asset.update({
      where: { id: data.assetId },
      data:  { raisedAmount: { increment: data.amount } },
    })

    // Recalculate ALL ownership percentages (members + backers combined)
    const allOwnerships = await tx.assetOwnership.findMany({ where: { assetId: data.assetId } })
    const allBackers    = await tx.assetBacker.findMany({ where: { assetId: data.assetId, status: 'ACTIVE' } })
    const asset         = await tx.asset.findUnique({ where: { id: data.assetId }, select: { raisedAmount: true } })
    const newRaised     = Number(asset?.raisedAmount || 0)

    if (newRaised > 0) {
      // Update member ownership pcts
      for (const o of allOwnerships) {
        const pct = (Number(o.amountContributed) / newRaised) * 100
        await tx.assetOwnership.update({ where: { id: o.id }, data: { ownershipPct: pct } })
      }
      // Update backer ownership pcts
      for (const b of allBackers) {
        const contributed = b.id === data.backerId ? Number(newTotal) : Number(b.totalContributed)
        const pct = (contributed / newRaised) * 100
        await tx.assetBacker.update({ where: { id: b.id }, data: { ownershipPct: pct } })
      }
    }

    // Transaction record
    await tx.transaction.create({
      data: {
        type:          'ASSET_CONTRIBUTION',
        status:        'COMPLETED',
        amount:        data.amount,
        currency:      backer.asset.group.currency as any,
        assetId:       data.assetId,
        reference:     data.paymentRef || `BACKER-${Date.now()}`,
        paymentMethod: data.paymentMethod as any,
        description:   `Backer contribution: ${backer.fullName} → ${backer.asset.name}`,
      },
    })

    await tx.auditLog.create({
      data: {
        action:      'CREATE',
        entityType:  'BackerContribution',
        entityId:    data.backerId,
        description: `Backer ${backer.fullName} contributed $${data.amount} to "${backer.asset.name}"`,
      },
    })
  })

  return NextResponse.json({
    success: true,
    message: `$${data.amount} contribution recorded for ${backer.fullName}.`,
    data:    { newTotal: Number(newTotal) },
  })
}

// ── KYC handler ───────────────────────────────────────────────
async function handleKyc(body: any): Promise<NextResponse> {
  const { backerId, action, documentUrl, rejectionNote, verifiedById } = kycSchema.parse(body)

  const updateData: any = {}
  let message = ''

  if (action === 'SUBMIT') {
    updateData.kycStatus     = 'SUBMITTED'
    updateData.kycDocumentUrl = documentUrl
    // Advance status from PENDING_KYC → PENDING_APPROVAL
    updateData.status         = 'PENDING_APPROVAL'
    message = 'KYC documents submitted. Awaiting admin review.'
  } else if (action === 'VERIFY') {
    updateData.kycStatus      = 'VERIFIED'
    updateData.kycVerifiedAt  = new Date()
    updateData.kycVerifiedBy  = verifiedById
    message = 'KYC verified. Backer can now be approved.'
  } else if (action === 'REJECT') {
    updateData.kycStatus         = 'REJECTED'
    updateData.kycRejectedAt     = new Date()
    updateData.kycRejectionNote  = rejectionNote
    updateData.status            = 'PENDING_KYC'
    message = 'KYC rejected. Backer must resubmit documents.'
  }

  await prisma.assetBacker.update({ where: { id: backerId }, data: updateData })
  return NextResponse.json({ success: true, message })
}

// ── Format helper ─────────────────────────────────────────────
function formatBacker(b: any) {
  return {
    id:             b.id,
    assetId:        b.assetId,
    fullName:       b.fullName,
    email:          b.email,
    phone:          b.phone,
    country:        b.country,
    city:           b.city,
    occupation:     b.occupation,
    kycStatus:      b.kycStatus,
    kycDocumentUrl: b.kycDocumentUrl,
    kycVerifiedAt:  b.kycVerifiedAt,
    status:         b.status,
    approvedAt:     b.approvedAt,
    rejectionReason: b.rejectionReason,
    totalContributed: Number(b.totalContributed),
    ownershipPct:   Number(b.ownershipPct),
    currency:       b.currency,
    referralCode:   b.referralCode,
    agreedToTermsAt: b.agreedToTermsAt,
    notes:          b.notes,
    createdAt:      b.createdAt,
    contributions:  b.contributions?.map((c: any) => ({
      id:            c.id,
      amount:        Number(c.amount),
      paymentMethod: c.paymentMethod,
      paymentRef:    c.paymentRef,
      notes:         c.notes,
      createdAt:     c.createdAt,
    })) || [],
  }
}
