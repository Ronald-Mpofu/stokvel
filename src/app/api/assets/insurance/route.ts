import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma/client'

const insuranceSchema = z.object({
  assetId:          z.string().uuid(),
  insurer:          z.string().min(1),
  policyNumber:     z.string().min(1),
  policyType:       z.string(),
  coverAmount:      z.coerce.number().positive(),
  premiumAmount:    z.coerce.number().positive(),
  premiumFrequency: z.string().default('ANNUAL'),
  startDate:        z.string(),
  expiryDate:       z.string(),
  contactName:      z.string().optional(),
  contactPhone:     z.string().optional(),
  contactEmail:     z.string().optional(),
  documentUrl:      z.string().optional(),
  notes:            z.string().optional(),
})

const claimSchema = z.object({
  insuranceId:  z.string().uuid(),
  assetId:      z.string().uuid(),
  claimDate:    z.string(),
  description:  z.string().min(1),
  claimAmount:  z.coerce.number().positive(),
  referenceNo:  z.string().optional(),
  documentUrl:  z.string().optional(),
  notes:        z.string().optional(),
})

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const assetId = searchParams.get('assetId')
    if (!assetId) return NextResponse.json({ success:false, error:'assetId required' }, { status:400 })

    const policies = await prisma.assetInsurance.findMany({
      where: { assetId },
      include: { claims: true },
      orderBy: { expiryDate: 'asc' },
    })

    const now = new Date()
    const thirtyDays = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000)
    const active  = policies.filter(p => p.status === 'ACTIVE')
    const expiring = active.filter(p => new Date(p.expiryDate) <= thirtyDays)

    return NextResponse.json({
      success: true,
      data: {
        policies: policies.map(p => ({
          id:               p.id,
          insurer:          p.insurer,
          policyNumber:     p.policyNumber,
          policyType:       p.policyType,
          coverAmount:      Number(p.coverAmount),
          premiumAmount:    Number(p.premiumAmount),
          premiumFrequency: p.premiumFrequency,
          startDate:        p.startDate,
          expiryDate:       p.expiryDate,
          status:           p.status,
          contactName:      p.contactName,
          contactPhone:     p.contactPhone,
          contactEmail:     p.contactEmail,
          documentUrl:      p.documentUrl,
          notes:            p.notes,
          daysToExpiry:     Math.ceil((new Date(p.expiryDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
          claims: p.claims.map(c => ({
            id:            c.id,
            claimDate:     c.claimDate,
            description:   c.description,
            claimAmount:   Number(c.claimAmount),
            settledAmount: c.settledAmount ? Number(c.settledAmount) : null,
            status:        c.status,
            referenceNo:   c.referenceNo,
            settledAt:     c.settledAt,
          })),
        })),
        summary: {
          totalPolicies:   policies.length,
          activePolicies:  active.length,
          expiringSOon:    expiring.length,
          totalCover:      active.reduce((s,p) => s + Number(p.coverAmount), 0),
          annualPremium:   active.reduce((s,p) => {
            const m = p.premiumFrequency === 'MONTHLY' ? 12 : p.premiumFrequency === 'QUARTERLY' ? 4 : 1
            return s + Number(p.premiumAmount) * m
          }, 0),
          totalClaims:     policies.reduce((s,p) => s + p.claims.length, 0),
        },
      },
    })
  } catch (e: any) {
    return NextResponse.json({ success:false, error:e.message }, { status:500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    if (body.action === 'ADD_CLAIM') {
      const data = claimSchema.parse(body)
      const claim = await prisma.assetInsuranceClaim.create({
        data: {
          insuranceId: data.insuranceId,
          assetId:     data.assetId,
          claimDate:   new Date(data.claimDate),
          description: data.description,
          claimAmount: data.claimAmount,
          currency:    'USD' as any,
          referenceNo: data.referenceNo,
          documentUrl: data.documentUrl,
          notes:       data.notes,
        },
      })
      return NextResponse.json({ success:true, data:{ id:claim.id }, message:'Claim submitted' }, { status:201 })
    }

    if (body.action === 'UPDATE_CLAIM') {
      const { claimId, status, settledAmount } = body
      await prisma.assetInsuranceClaim.update({
        where: { id: claimId },
        data: {
          status,
          settledAmount: settledAmount || undefined,
          settledAt:     status === 'PAID' ? new Date() : undefined,
        },
      })
      return NextResponse.json({ success:true, message:'Claim updated' })
    }

    const data = insuranceSchema.parse(body)
    const policy = await prisma.assetInsurance.create({
      data: {
        assetId:          data.assetId,
        insurer:          data.insurer,
        policyNumber:     data.policyNumber,
        policyType:       data.policyType,
        coverAmount:      data.coverAmount,
        currency:         'USD' as any,
        premiumAmount:    data.premiumAmount,
        premiumFrequency: data.premiumFrequency,
        startDate:        new Date(data.startDate),
        expiryDate:       new Date(data.expiryDate),
        contactName:      data.contactName,
        contactPhone:     data.contactPhone,
        contactEmail:     data.contactEmail,
        documentUrl:      data.documentUrl,
        notes:            data.notes,
      },
    })

    return NextResponse.json({ success:true, data:{ id:policy.id }, message:`Policy ${data.policyNumber} added` }, { status:201 })
  } catch (e: any) {
    if (e instanceof z.ZodError) return NextResponse.json({ success:false, error:e.errors.map((x:any)=>x.message).join('; ') }, { status:400 })
    return NextResponse.json({ success:false, error:e.message }, { status:500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { policyId, status } = await req.json()
    await prisma.assetInsurance.update({ where:{ id:policyId }, data:{ status } })
    return NextResponse.json({ success:true, message:'Policy updated' })
  } catch (e: any) {
    return NextResponse.json({ success:false, error:e.message }, { status:500 })
  }
}
