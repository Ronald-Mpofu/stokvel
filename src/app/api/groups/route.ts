// src/app/api/groups/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma/client'
import { getClaimsFromRequest, getSessionFromRequest, requireGroupManager, hasPermission } from '@/lib/auth'
import { syncGroupSubscriptionTier } from '@/lib/payments/groupTier'
import { stampGroupActivated, stampGroupReachedMinimum } from '@/lib/group-entitlement'

export const dynamic = 'force-dynamic'

// Raw driver errors leak table names, column names and SQL fragments to
// the client. Log the real thing, return something safe in production.
const IS_PROD = process.env.NODE_ENV === 'production'
function safeError(e: any, fallback: string): string {
  return IS_PROD ? fallback : (e?.message || fallback)
}

// Page size ceiling. The Groups page currently loads everything and
// filters client-side; DEFAULT_LIMIT is far above today's row count so
// nothing changes yet, but the endpoint can no longer return an
// unbounded array. `pagination` in the response carries the cursor.
const DEFAULT_LIMIT = 200
const MAX_LIMIT = 500

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
    // OR groups where they hold an ACTIVE GROUP_ADMIN / TREASURER role.
    //
    // v2: reads verified JWT claims instead of loading the user row —
    // this handler only needed id and role, both of which are claims.
    // Saves one round trip on every call.
    const claims = await getClaimsFromRequest(req)
    if (!claims) {
      return NextResponse.json({ success: false, error: 'Not authenticated' }, { status: 401 })
    }
    const seesAll = ['SYSTEM_ADMIN', 'NATIONAL_ADMIN', 'AUDITOR'].includes(claims.role)

    const { searchParams } = new URL(req.url)
    const cursor = searchParams.get('cursor')
    const search = searchParams.get('search')?.trim() || null
    const status = searchParams.get('status')
    const limit = Math.min(
      Math.max(Number(searchParams.get('limit')) || DEFAULT_LIMIT, 1),
      MAX_LIMIT
    )

    // Scope is now a bound parameter rather than concatenated SQL, so
    // there is one query shape regardless of role. $2 short-circuits
    // the whole predicate for platform-wide roles.
    //
    // Cursor resolves the anchor row's createdAt via subquery instead of
    // casting a client-supplied timestamp — that keeps the comparison in
    // the column's own type and avoids a cast that would defeat
    // idx_group_createdat_live.
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
        -- Officer display names resolved here rather than client-side.
        -- The page used to look these up in the lazily-fetched member
        -- roster, which meant the name was blank until the roster
        -- landed, and stayed blank forever for any officer whose
        -- membership was not ACTIVE (the roster's default filter) or
        -- who had no GroupMember row at all. Resolving against "User"
        -- makes the name independent of roster status, roster timing
        -- and roster membership.
        --
        -- Both joins are nested loops on "User".id (primary key), so
        -- this costs no extra round trip and no extra scan.
        t."fullName" as "treasurerName",
        s."fullName" as "secretaryName",
        (SELECT COUNT(*) FROM "GroupMember" WHERE "groupId" = g.id AND status <> 'EXITED') as "memberCount",
        (SELECT COUNT(*) FROM "Loan" WHERE "groupId" = g.id) as "loanCount"
      FROM "Group" g
      JOIN "User" u ON u.id = g."adminUserId"
      LEFT JOIN "User" t ON t.id = g."treasurerId" AND t."deletedAt" IS NULL
      LEFT JOIN "User" s ON s.id = g."secretaryId" AND s."deletedAt" IS NULL
      WHERE g."deletedAt" IS NULL
        AND (
          $2::boolean IS TRUE
          OR g."adminUserId" = $1::text
          OR EXISTS (
            SELECT 1 FROM "GroupMember" gm
            WHERE gm."groupId" = g.id
              AND gm."userId"  = $1::text
              AND gm.role      IN ('GROUP_ADMIN', 'TREASURER')
              AND gm.status    = 'ACTIVE'
          )
        )
        AND (
          $3::text IS NULL
          OR (g."createdAt", g.id) <
             ((SELECT c."createdAt" FROM "Group" c WHERE c.id = $3::text), $3::text)
        )
        AND ($4::text IS NULL OR g.name ILIKE '%' || $4::text || '%')
        AND ($5::text IS NULL OR g.status::text = $5::text)
      ORDER BY g."createdAt" DESC, g.id DESC
      LIMIT $6::int
    `, [claims.id, seesAll, cursor, search, status && status !== 'ALL' ? status : null, limit + 1])

    const hasMore = groups.length > limit
    const page = hasMore ? groups.slice(0, limit) : groups

    const formatted = page.map((g: any) => ({
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
      // Additive fields. Empty string (not null) so the page can use
      // `treasurerName || fallback` without a null check, matching the
      // convention already used by treasurerId/secretaryId above.
      // Empty means either unassigned or assigned to a deleted user —
      // both render as the em-dash placeholder.
      treasurerName:         g.treasurerName || '',
      secretaryName:         g.secretaryName || '',
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

    // `data` stays a plain array so the existing page needs no changes.
    // `pagination` is additive — wire it up when the list grows.
    return NextResponse.json({
      success: true,
      data: formatted,
      pagination: {
        limit,
        returned: formatted.length,
        hasMore,
        nextCursor: hasMore ? formatted[formatted.length - 1].id : null,
      },
    })
  } catch (e: any) {
    console.error('GET /api/groups error:', e)
    return NextResponse.json({ success: false, error: safeError(e, 'Failed to load groups') }, { status: 500 })
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

    // ── Entitlement: stamp reachedMinimumAt if applicable ──────
    // A brand-new group has one member against a minMembers of 4, so
    // this is normally a no-op. It runs anyway because minMembers can be
    // configured lower, and because the helper is the single place that
    // decision lives — duplicating the threshold check here would be a
    // second copy to keep in sync.
    //
    // NOT stamping activatedAt: groups are created as DRAFT. Activation
    // is a paid action handled in PUT and in the Stripe webhook.
    await stampGroupReachedMinimum(group.id)

    // Set extra columns via raw SQL (not in Prisma schema)
    if (body.branding || body.treasurerId || body.secretaryId || body.city || body.zipCode || body.groupType || body.publicAdvert) {
      await exec(
        `UPDATE "Group" SET branding=$1,"treasurerId"=$2,"secretaryId"=$3,city=$4,"zipCode"=$5,"groupType"=$6,"publicAdvert"=$7 WHERE id=$8`,
        [body.branding||null, body.treasurerId||null, body.secretaryId||null, body.city||null, body.zipCode||null, body.groupType||'PRIVATE', body.publicAdvert||null, group.id]
      )
    }

    // ── Seed the Windfall Schemes (added v2) ──────────────────
    // v1 never created these, so every group made after
    // seed-windfall-schemes.sql ran had ZERO scheme rows. The UI hid it:
    // WindfallSchemesHub falls into legacy mode when schemeRows is empty
    // and just omits the Remove/Enable controls, so nothing looked broken
    // while group admins quietly lost the ability to manage schemes.
    //
    // Scheme types come from pg_enum rather than a hardcoded list, so
    // this cannot drift from the actual WindfallSchemeType enum and picks
    // up any new value automatically.
    //
    // Names and descriptions are copied from existing rows of the same
    // type so new groups match the ones the original seed created.
    //
    // ON CONFLICT DO NOTHING against WindfallScheme_groupId_schemeType_key
    // makes this idempotent and safe alongside the backfill migration.
    // A failure here must NOT lose the group — it is recoverable by
    // re-running 07-backfill-windfall-schemes.sql.
    try {
      await exec(`
        INSERT INTO "WindfallScheme" ("groupId", "schemeType", "name", "description", "status")
        SELECT
          $1::text,
          e.enumlabel::"WindfallSchemeType",
          COALESCE(
            (SELECT w.name FROM "WindfallScheme" w
              WHERE w."schemeType" = e.enumlabel::"WindfallSchemeType"
              ORDER BY w."createdAt" LIMIT 1),
            initcap(replace(e.enumlabel, '_', ' '))
          ),
          (SELECT w.description FROM "WindfallScheme" w
            WHERE w."schemeType" = e.enumlabel::"WindfallSchemeType"
              AND w.description IS NOT NULL
            ORDER BY w."createdAt" LIMIT 1),
          'ACTIVE'::"WindfallSchemeStatus"
        FROM (
          SELECT en.enumlabel
          FROM pg_enum en
          JOIN pg_type ty ON ty.oid = en.enumtypid
          WHERE ty.typname = 'WindfallSchemeType'
        ) e
        ON CONFLICT ("groupId", "schemeType") DO NOTHING
      `, [group.id])
    } catch (e: any) {
      console.error('POST /api/groups scheme seed failed for', group.id, e?.message)
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
    return NextResponse.json({ success: false, error: safeError(e, 'Request failed') }, { status: 500 })
  }
}

// ── PUT — update group ────────────────────────────────────────
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json()
    const data = updateSchema.parse(body)

    // ── AUTHORISATION (added v2) ──────────────────────────────
    // v1 had NO guard here. Middleware only enforces that the caller is
    // authenticated, so any logged-in user could rename any group,
    // change its contribution amount, penalty rate, currency, officers
    // or status simply by passing that group's id.
    //
    // verifyStatus: true costs one extra query to re-check live account
    // standing rather than trusting the token snapshot — appropriate for
    // a financial mutation.
    const guardErr = await requireGroupManager(req, data.id, { verifyStatus: true })
    if (guardErr) return guardErr

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

    // ── Entitlement: stamp activatedAt on transition to ACTIVE ─
    // Starts the 60-day ramp-up window, during which members of a
    // below-minimum group remain entitled. Without this, every group
    // activated from here leaves activatedAt null and — if it never
    // reaches minMembers — its members silently lose entitlement.
    //
    // This PUT path covers reactivation (PAUSED → ACTIVE on a live
    // subscription). FIRST activation goes through the Stripe webhook,
    // which flips status to ACTIVE after payment — stampGroupActivated
    // MUST be called there too, or new groups are never stamped.
    //
    // Stamps only on an actual transition, and never overwrites an
    // existing value, so repeated saves cannot restart the window.
    if (data.status === 'ACTIVE' && existing[0].status !== 'ACTIVE') {
      await stampGroupActivated(data.id)
    }

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
    return NextResponse.json({ success: false, error: safeError(e, 'Request failed') }, { status: 500 })
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

    // ── AUTHORISATION (added v2) ──────────────────────────────
    // v1 had NO guard here either. Any authenticated user could
    // soft-delete any group whose blocker checks came back clear —
    // including groups they had never been a member of.
    const guardErr = await requireGroupManager(req, id, { verifyStatus: true })
    if (guardErr) return guardErr

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
    return NextResponse.json({ success: false, error: safeError(e, 'Delete check failed') }, { status: 500 })
  }
}
