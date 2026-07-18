// src/app/api/groups/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma/client'
import { getSessionFromRequest, hasPermission } from '@/lib/auth'
import { syncGroupSubscriptionTier } from '@/lib/payments/groupTier'

export const dynamic = 'force-dynamic'

async function sql(query: string, params: any[] = []) {
  return prisma.$queryRawUnsafe(query, ...params) as Promise<any[]>
}
async function exec(query: string, params: any[] = []) {
  return prisma.$executeRawUnsafe(query, ...params)
}

const updateSchema = z.object({
  id:                    z.string().uuid(),
  name:                  z.string().min(2),
  description:           z.string().nullish().transform(v => v || null),
  currency:              z.string().default('USD'),
  contributionAmount:    z.coerce.number().nonnegative(),  // allow 0 for drafts being configured; activation must not be blocked by an unset amount
  contributionDay:       z.coerce.number().int().min(1).max(28),
  contributionFrequency: z.string().default('monthly'),
  maxMembers:            z.coerce.number().int().min(2),
  penaltyRate:           z.coerce.number().min(0).max(1),
  insurancePoolPct:      z.coerce.number().min(0).max(1),
  payoutStrategy:        z.string(),
  country:               z.string().nullish().transform(v => v || null),
  region:                z.string().nullish().transform(v => v || null),
  branding:              z.string().nullish().transform(v => v || null),
  status:                z.enum(['DRAFT','ACTIVE','PAUSED','COMPLETED','DISSOLVED']).optional(),
  treasurerId:           z.string().nullish().transform(v => v || null),
  secretaryId:           z.string().nullish().transform(v => v || null),
  city:                  z.string().nullish().transform(v => v || null),
  zipCode:               z.string().nullish().transform(v => v || null),
  groupType:             z.enum(['PRIVATE','PUBLIC']).default('PRIVATE'),
  publicAdvert:          z.string().max(600).optional().nullable(),
})

// ── GET ───────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    // ── Role-based scoping (BR 1 & 4) ────────────────────────
    // SYSTEM_ADMIN / NATIONAL_ADMIN / AUDITOR see all groups.
    // Everyone else sees only groups they created (adminUserId)
    // OR groups where they hold an ACTIVE GROUP_ADMIN member role.
    const session = await getSessionFromRequest(req)
    if (!session) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
    }
    const seesAll  = ['SYSTEM_ADMIN', 'NATIONAL_ADMIN', 'AUDITOR'].includes(session.role)
    const scopeSql = seesAll ? '' : `AND (
        g."adminUserId" = $1
        OR EXISTS (
          SELECT 1 FROM "GroupMember" gm
          WHERE gm."groupId" = g.id
            AND gm."userId"  = $1
            AND gm.role      = 'GROUP_ADMIN'
            AND gm.status    = 'ACTIVE'
        )
      )`
    const params = seesAll ? [] : [session.id]

    // Use raw SQL to include branding column (not in Prisma schema yet)
    const groups = await sql(`
      SELECT
        g.id, g.name, g.description, g.status, g.currency,
        g."contributionAmount", g."contributionDay", g."contributionFrequency",
        g."maxMembers", g."minMembers", g."penaltyRate", g."insurancePoolPct",
        g."platformFeePct", g."payoutStrategy", g."escrowBalance",
        g."insurancePoolBalance", g.country, g.region,
        g."logoUrl", g."adminUserId", g."createdAt", g."updatedAt",
        g."deletedAt",
        COALESCE(g.branding, '')      as branding,
        COALESCE(g."treasurerId", '') as "treasurerId",
        COALESCE(g."secretaryId", '')  as "secretaryId",
        COALESCE(g.city, '')           as city,
        COALESCE(g."zipCode", '')      as "zipCode",
        COALESCE(g."groupType", 'PRIVATE') as "groupType",
        COALESCE(g."publicAdvert", '')     as "publicAdvert",
        u."fullName" as "adminName", u.email as "adminEmail",
        (SELECT COUNT(*) FROM "GroupMember" WHERE "groupId" = g.id) as "memberCount",
        (SELECT COUNT(*) FROM "Loan" WHERE "groupId" = g.id) as "loanCount"
      FROM "Group" g
      JOIN "User" u ON u.id = g."adminUserId"
      WHERE g."deletedAt" IS NULL
      ${scopeSql}
      ORDER BY g."createdAt" DESC
    `, params)

    const formatted = groups.map((g: any) => ({
      id:                    g.id,
      name:                  g.name,
      description:           g.description,
      status:                g.status,
      currency:              g.currency,
      contributionAmount:    Number(g.contributionAmount),
      contributionDay:       Number(g.contributionDay),
      contributionFrequency: g.contributionFrequency,
      maxMembers:            Number(g.maxMembers),
      minMembers:            Number(g.minMembers),
      penaltyRate:           Number(g.penaltyRate),
      insurancePoolPct:      Number(g.insurancePoolPct),
      platformFeePct:        Number(g.platformFeePct),
      payoutStrategy:        g.payoutStrategy,
      escrowBalance:         Number(g.escrowBalance),
      insurancePoolBalance:  Number(g.insurancePoolBalance),
      country:               g.country,
      region:                g.region,
      logoUrl:               g.logoUrl,
      branding:              g.branding    || '',
      treasurerId:           g.treasurerId || '',
      secretaryId:           g.secretaryId  || '',
      city:                  g.city         || '',
      zipCode:               g.zipCode      || '',
      groupType:             g.groupType    || 'PRIVATE',
      publicAdvert:          g.publicAdvert || '',
      adminName:             g.adminName,
      adminEmail:            g.adminEmail,
      adminUserId:           g.adminUserId,
      memberCount:           Number(g.memberCount),
      loanCount:             Number(g.loanCount),
      activeCycle:           null,
      createdAt:             g.createdAt,
      updatedAt:             g.updatedAt,
    }))

    return NextResponse.json({ success: true, data: formatted })
  } catch (e: any) {
    console.error('GET /api/groups error:', e)
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}

// ── POST — create group ───────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    // Resolve the group admin from the authenticated session — direct JWT verify,
    // no hardcoded email, no extra HTTP round-trip. getSessionFromRequest also
    // enforces that the user exists and is ACTIVE.
    const session = await getSessionFromRequest(req)
    if (!session) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
    }

    // Default: the logged-in user owns the group. A SYSTEM_ADMIN / NATIONAL_ADMIN
    // may create a group on behalf of another user via body.adminUserId.
    let adminUserId = session.id
    if (body.adminUserId && body.adminUserId !== session.id) {
      if (!hasPermission(session.role, 'NATIONAL_ADMIN')) {
        return NextResponse.json({ success: false, error: 'Not permitted to assign a different admin' }, { status: 403 })
      }
      adminUserId = body.adminUserId
    }

    const adminUser = await prisma.user.findFirst({
      where:  { id: adminUserId, deletedAt: null },
      select: { id: true },
    })
    if (!adminUser) {
      return NextResponse.json({ success: false, error: 'Admin user not found' }, { status: 400 })
    }

    // Create group with Prisma (branding stored via raw SQL after)
    const group = await prisma.group.create({
      data: {
        name:                  body.name,
        description:           body.description || null,
        adminUserId:           adminUser.id,
        currency:              body.currency || 'USD',
        contributionAmount:    body.contributionAmount,
        contributionDay:       body.contributionDay || 1,
        contributionFrequency: body.contributionFrequency || 'monthly',
        maxMembers:            body.maxMembers || 10,
        penaltyRate:           body.penaltyRate || 0.20,
        insurancePoolPct:      body.insurancePoolPct || 0.015,
        payoutStrategy:        body.payoutStrategy || 'SENIORITY',
        country:               body.country || null,
        region:                body.region || null,
      },
    })

    // ── Auto-membership: the admin is a member of their own group ──
    // Keeps member counts honest, lets the admin join schemes, and powers
    // the member-role visibility branch of the Overview scoping.
    try {
      await prisma.groupMember.create({
        data: {
          groupId:      group.id,
          userId:       adminUser.id,
          role:         'GROUP_ADMIN',
          status:       'ACTIVE',
          approvedById: session.id,
          approvedAt:   new Date(),
        },
      })
    } catch (e: any) {
      if (e?.code !== 'P2002') throw e   // already a member — fine
    }

    // Set extra columns via raw SQL (not in Prisma schema)
    if (body.branding || body.treasurerId || body.secretaryId || body.city || body.zipCode || body.groupType || body.publicAdvert) {
      await exec(
        `UPDATE "Group" SET branding=$1,"treasurerId"=$2,"secretaryId"=$3,city=$4,"zipCode"=$5,"groupType"=$6,"publicAdvert"=$7 WHERE id=$8`,
        [body.branding||null, body.treasurerId||null, body.secretaryId||null, body.city||null, body.zipCode||null, body.groupType||'PRIVATE', body.publicAdvert||null, group.id]
      )
    }

    await prisma.auditLog.create({
      data: {
        action:      'CREATE',
        entityType:  'Group',
        entityId:    group.id,
        description: `Group "${body.name}" created`,
      } as any,
    })

    return NextResponse.json({
      success: true,
      data:    { id: group.id },
      message: `"${body.name}" group created successfully`,
    }, { status: 201 })
  } catch (e: any) {
    console.error('POST /api/groups error:', e)
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}

// ── PUT — update group ────────────────────────────────────────
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json()
    const data = updateSchema.parse(body)

    // Check group exists (status + maxMembers also needed below:
    // status for the activation payment gate, maxMembers to detect
    // capacity changes that move the subscription tier)
    const existing = await sql(
      `SELECT id, name, status, "maxMembers", "deletedAt" FROM "Group" WHERE id = $1`, [data.id]
    )
    if (!existing.length || existing[0].deletedAt) {
      return NextResponse.json({ success: false, error: 'Group not found' }, { status: 404 })
    }

    // ── Activation is a PAID action ───────────────────────────
    // Business rule: the group subscription is charged when the group
    // is activated. Setting status=ACTIVE directly through this PUT
    // would bypass payment entirely, so it is only allowed when a live
    // GROUP_MONTHLY subscription already exists (e.g. reactivating from
    // PAUSED while the subscription kept running). Otherwise the client
    // must go through /api/payments/group-checkout — the Stripe webhook
    // performs the actual flip to ACTIVE once payment lands.
    if (data.status === 'ACTIVE' && existing[0].status !== 'ACTIVE') {
      const liveSub = await sql(
        `SELECT id FROM "PlatformSubscription"
         WHERE "groupId" = $1
           AND scope = 'GROUP_MONTHLY'
           AND status IN ('active', 'past_due')
         LIMIT 1`, [data.id]
      )
      if (!liveSub.length) {
        return NextResponse.json({
          success: false,
          requiresPayment: true,
          error: 'Activating a group requires a group subscription. Complete the payment step to activate.',
        }, { status: 402 })
      }
    }

    // Update ALL fields via raw SQL — bypasses Prisma client schema limitations
    await exec(`
      UPDATE "Group" SET
        name                  = $1,
        description           = $2,
        currency              = $3::"CurrencyCode",
        "contributionAmount"  = $4,
        "contributionDay"     = $5,
        "contributionFrequency" = $6,
        "maxMembers"          = $7,
        "penaltyRate"         = $8,
        "insurancePoolPct"    = $9,
        "payoutStrategy"      = $10::"PayoutStrategy",
        country               = $11,
        region                = $12,
        branding              = $13,
        "treasurerId"         = $14,
        "secretaryId"         = $15,
        city                  = $16,
        "zipCode"             = $17,
        "groupType"           = $18,
        "publicAdvert"        = $19,
        status                = COALESCE($20::"GroupStatus", status),
        "updatedAt"           = NOW()
      WHERE id = $21
    `, [
      data.name,
      data.description,
      data.currency,
      data.contributionAmount,
      data.contributionDay,
      data.contributionFrequency,
      data.maxMembers,
      data.penaltyRate,
      data.insurancePoolPct,
      data.payoutStrategy,
      data.country,
      data.region,
      data.branding,
      data.treasurerId    || null,
      data.secretaryId    || null,
      data.city           || null,
      data.zipCode        || null,
      data.groupType      || 'PRIVATE',
      data.publicAdvert   || null,
      data.status         || null,
      data.id,
    ])

    // ── Capacity changed → re-sync the Stripe tier ────────────
    // Billing is by configured capacity (maxMembers). If the admin
    // changed it on a subscribed group, the subscription price moves
    // to the matching tier from the NEXT invoice (no proration).
    // The helper never throws — a sync failure must not fail the save.
    if (
      data.maxMembers !== undefined &&
      Number(existing[0].maxMembers) !== Number(data.maxMembers)
    ) {
      await syncGroupSubscriptionTier(data.id)
    }

    await prisma.auditLog.create({
      data: {
        action:      'UPDATE',
        entityType:  'Group',
        entityId:    data.id,
        description: `Group "${data.name}" updated`,
      } as any,
    })

    return NextResponse.json({ success: true, message: `"${data.name}" updated successfully` })
  } catch (e: any) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({
        success: false,
        error: 'Validation: ' + e.errors.map(x => x.message).join('; ')
      }, { status: 400 })
    }
    console.error('PUT /api/groups error:', e)
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}

// ── DELETE ────────────────────────────────────────────────────
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const id          = searchParams.get('id')
    const confirmName = searchParams.get('confirmName')
    const forceDelete = searchParams.get('force') === 'true'

    if (!id) return NextResponse.json({ success: false, error: 'Group ID required' }, { status: 400 })

    const rows = await sql(`
      SELECT g.id, g.name, g."deletedAt",
        g."escrowBalance", g."insurancePoolBalance",
        (SELECT COUNT(*) FROM "GroupMember" WHERE "groupId" = g.id AND status = 'ACTIVE') as "activeMembers",
        (SELECT COUNT(*) FROM "Cycle" WHERE "groupId" = g.id AND status = 'ACTIVE') as "activeCycles",
        (SELECT COUNT(*) FROM "Loan" WHERE "groupId" = g.id AND status IN ('ACTIVE','APPROVED','PENDING_APPROVAL')) as "activeLoans",
        (SELECT COUNT(*) FROM "PropertyGroup" WHERE "groupId" = g.id AND status != 'SOLD') as "activeProperties",
        (SELECT COUNT(*) FROM "GroupMember" WHERE "groupId" = g.id) as "memberCount"
      FROM "Group" g WHERE g.id = $1
    `, [id])

    if (!rows.length || rows[0].deletedAt) {
      return NextResponse.json({ success: false, error: 'Group not found' }, { status: 404 })
    }

    const group = rows[0]
    const blockers: string[] = []
    const warnings: string[] = []

    if (Number(group.activeMembers) > 0)    blockers.push(`${group.activeMembers} active member(s) must be removed first`)
    if (Number(group.activeCycles)  > 0)    blockers.push('Group has an active payout cycle — close it first')
    if (Number(group.activeLoans)   > 0)    blockers.push(`${group.activeLoans} active loan(s) must be settled first`)
    if (Number(group.activeProperties) > 0) blockers.push(`${group.activeProperties} active property investment(s) must be closed first`)
    if (Number(group.escrowBalance) > 0)    warnings.push(`Escrow balance of $${Number(group.escrowBalance).toFixed(2)} will be forfeited`)
    if (Number(group.insurancePoolBalance) > 0) warnings.push(`Insurance pool of $${Number(group.insurancePoolBalance).toFixed(2)} will be forfeited`)

    if (!forceDelete) {
      return NextResponse.json({
        success:   blockers.length === 0,
        canDelete: blockers.length === 0,
        blockers, warnings,
        group: { id: group.id, name: group.name, memberCount: Number(group.memberCount) },
      })
    }

    if (blockers.length > 0) {
      return NextResponse.json({ success: false, error: 'Cannot delete: ' + blockers[0], blockers }, { status: 400 })
    }

    if (!confirmName || confirmName.toLowerCase() !== group.name.toLowerCase()) {
      return NextResponse.json({
        success: false,
        error: `Confirmation name does not match. Type "${group.name}" exactly.`,
      }, { status: 400 })
    }

    await exec(`UPDATE "Group" SET "deletedAt" = NOW(), status = 'DISSOLVED'::"GroupStatus", "updatedAt" = NOW() WHERE id = $1`, [id])

    await prisma.auditLog.create({
      data: {
        action: 'DELETE', entityType: 'Group', entityId: id,
        description: `Group "${group.name}" soft-deleted`,
      } as any,
    })

    return NextResponse.json({ success: true, message: `"${group.name}" has been deleted successfully` })
  } catch (e: any) {
    console.error('DELETE /api/groups error:', e)
    return NextResponse.json({ success: false, error: `Delete check failed: ${e.message}` }, { status: 500 })
  }
}
