// src/app/api/users/route.ts
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma/client'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const role      = searchParams.get('role')
    const status    = searchParams.get('status')
    const kycStatus = searchParams.get('kycStatus')
    const search    = searchParams.get('search')
    // Reverse lookup: narrow the list to members of one group.
    const groupId   = searchParams.get('groupId')

    const where: any = {}
    if (role)      where.role      = role
    if (status)    where.status    = status
    if (kycStatus) where.kycStatus = kycStatus
    if (search) {
      where.OR = [
        { fullName: { contains: search, mode: 'insensitive' } },
        { email:    { contains: search, mode: 'insensitive' } },
        { phone:    { contains: search, mode: 'insensitive' } },
      ]
    }
    // Relation filter — resolved in SQL, not by post-filtering the page.
    // EXITED is excluded so a departed member does not keep showing up
    // under a group they have left.
    if (groupId) {
      where.groupMemberships = {
        some: { groupId, status: { not: 'EXITED' } },
      }
    }

    // The group list that populates the filter dropdown. Runs in
    // PARALLEL with the user query rather than after it, so it adds a
    // query but no extra latency — the round trip to Tokyo is the cost
    // that matters, and this one overlaps.
    const [users, allGroups] = await Promise.all([
      prisma.user.findMany({
        where,
        select: {
          id: true, fullName: true, email: true, phone: true,
          role: true, status: true, kycStatus: true, tier: true,
          reputationScore: true, country: true, city: true,
          createdAt: true, lastLoginAt: true, emailVerifiedAt: true,
          isBlacklisted: true, blacklistReason: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.$queryRawUnsafe<any[]>(
        `SELECT id, name, status::text AS status
         FROM "Group"
         WHERE "deletedAt" IS NULL
         ORDER BY name ASC`
      ),
    ])

    // ── Subscription status ───────────────────────────────────
    // ONE extra query for the whole page rather than a lookup per row.
    // Derived, never stored: a stored status is a second source of truth
    // that drifts the first time a webhook is missed.
    //
    // Precedence matters — the first match wins:
    //   EXEMPT     staff, or an invited member in a qualifying group
    //              (rule 3b). Never chase these people for money.
    //   PAID       membership active and in date
    //   ENDING     active but will not renew — the churn signal
    //   SUBMITTED  a manual payment is awaiting verification
    //   FAILED     an attempt errored; worth contacting
    //   EXPIRED    lapsed
    //   UNPAID     registered, never attempted payment
    const subs = users.length
      ? await prisma.$queryRawUnsafe<any[]>(
          `
          SELECT
            u."id",
            cm."status"            AS cm_status,
            cm."expiresAt"         AS cm_expires_at,
            cm."cancelAtPeriodEnd" AS cm_cancelling,
            cm."currency"          AS cm_currency,
            cm."amountPaid"        AS cm_amount,
            pa."status"            AS attempt_status,
            pa."provider"          AS attempt_provider,
            pa."createdAt"         AS attempt_at,
            pa."memberReference"   AS member_reference,
            inv."invoiceNo"        AS invoice_no,
            (u."role"::text IN ('SYSTEM_ADMIN','NATIONAL_ADMIN','AUDITOR')) AS is_staff,
            EXISTS (
              SELECT 1 FROM "GroupMember" gm
              JOIN "Group" g ON g.id = gm."groupId"
              WHERE gm."userId" = u."id"
                AND gm."status" IN ('ACTIVE'::"MemberStatus",'SUSPENDED'::"MemberStatus",'DEFAULTED'::"MemberStatus")
                AND g."status"  IN ('ACTIVE'::"GroupStatus",'PAUSED'::"GroupStatus",'COMPLETED'::"GroupStatus")
                AND g."deletedAt" IS NULL
            ) AS in_group,
            -- Which groups this user belongs to, aggregated in the query
            -- that was already running. Fetching memberships per user
            -- would be one Tokyo round trip each — 50 users would cost
            -- roughly eight seconds. This costs nothing extra.
            --
            -- EXITED is excluded, so this array is the set of live
            -- memberships and groupCount is derived from its length.
            -- The old groupCount came from _count on the relation, which
            -- counted EXITED rows too — the number and the group names
            -- would have disagreed on screen.
            (
              SELECT json_agg(
                json_build_object(
                  'id',          g.id,
                  'name',        g.name,
                  'role',        gm."role"::text,
                  'status',      gm."status"::text,
                  'groupStatus', g."status"::text
                ) ORDER BY g.name
              )
              FROM "GroupMember" gm
              JOIN "Group" g ON g.id = gm."groupId"
              WHERE gm."userId" = u."id"
                AND gm."status" <> 'EXITED'::"MemberStatus"
                AND g."deletedAt" IS NULL
            ) AS groups
          FROM "User" u
          LEFT JOIN "CommunityMembership" cm ON cm."userId" = u."id"
          LEFT JOIN LATERAL (
            SELECT p."status", p."provider", p."createdAt", p."memberReference", p."invoiceId"
            FROM "PaymentAttempt" p
            WHERE p."userId" = u."id"
            ORDER BY p."createdAt" DESC
            LIMIT 1
          ) pa ON true
          LEFT JOIN "JoiningFeeInvoice" inv ON inv."id" = pa."invoiceId"
          WHERE u."id" = ANY($1::text[])
          `,
          users.map(u => u.id)
        )
      : []

    const subById = new Map<string, any>(subs.map(s => [s.id, s]))
    function deriveStatus(s: any): { status: string; detail: string | null } {
      if (!s) return { status: 'UNPAID', detail: null }

      const now = Date.now()
      const expires = s.cm_expires_at ? new Date(s.cm_expires_at).getTime() : null
      const current = s.cm_status === 'ACTIVE' && expires !== null && expires > now

      if (s.is_staff) return { status: 'EXEMPT', detail: 'Staff role' }
      // Rule 3b — an invited member in an active group owes nothing.
      // Without this they sit as UNPAID forever and get chased for a fee
      // they are not charged.
      if (!current && s.in_group) return { status: 'EXEMPT', detail: 'Group member' }

      if (current && s.cm_cancelling) return { status: 'ENDING', detail: null }
      if (current) return { status: 'PAID', detail: null }

      if (s.attempt_status === 'PENDING' || s.attempt_status === 'INITIATED') {
        return { status: 'SUBMITTED', detail: s.attempt_provider || null }
      }
      if (s.attempt_status === 'FAILED') {
        return { status: 'FAILED', detail: s.attempt_provider || null }
      }
      if (s.cm_status) return { status: 'EXPIRED', detail: null }
      return { status: 'UNPAID', detail: null }
    }

    // ── Subscription filter ───────────────────────────────────
    // Applied AFTER derivation, because the status is computed rather
    // than stored — there is no column to put in a WHERE clause.
    //
    // POOL is the "who is a Community Member" view: currently paid,
    // including those who have chosen not to renew. Someone whose
    // membership ends next month is still a member today, and is
    // exactly who you would want to see.
    //
    // Note this filters the fetched page, not the query. Fine while
    // /api/users returns every user; when pagination lands, this moves
    // into the SQL as a lateral-derived column.
    const subscriptionFilter = searchParams.get('subscription')

    const rows = users.map(u => {
      const s = subById.get(u.id)
      const { status: subscriptionStatus, detail } = deriveStatus(s)
      const groups = (s?.groups ?? []) as any[]
      return {
        ...u,
        reputationScore: Number(u.reputationScore),
        groups,
        // Derived from the array above so the count and the listed
        // group names can never disagree.
        groupCount: groups.length,
        subscriptionStatus,
        subscriptionDetail: detail,
        subscriptionExpiresAt: s?.cm_expires_at ?? null,
        subscriptionCurrency: s?.cm_currency ?? null,
        subscriptionAmount: s?.cm_amount != null ? Number(s.cm_amount) : null,
        paymentReference: s?.member_reference ?? s?.invoice_no ?? null,
        lastAttemptAt: s?.attempt_at ?? null,
      }
    })

    const filtered = !subscriptionFilter || subscriptionFilter === 'ALL'
      ? rows
      : subscriptionFilter === 'POOL'
        ? rows.filter(r => r.subscriptionStatus === 'PAID' || r.subscriptionStatus === 'ENDING')
        : rows.filter(r => r.subscriptionStatus === subscriptionFilter)

    return NextResponse.json({
      success: true,
      data: filtered,
      // Additive. Populates the group filter dropdown. Deliberately the
      // FULL live group list, not the groups present in `data` — if it
      // were derived from the results, selecting a group would collapse
      // the dropdown to that one group and you could not switch away.
      meta: {
        groups: (allGroups || []).map(g => ({
          id: g.id, name: g.name, status: g.status,
        })),
      },
    })
  } catch (e: any) {
    console.error('GET /api/users error:', e)
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}

// ── POST /api/users — provision a staff user (SYSTEM_ADMIN only) ──
// Creates the account with an unusable random password and returns a
// one-time setup link for the admin to share. Staff roles are fee-exempt
// by role in middleware, so no joining fee is involved.
// NOTE: middleware already restricts /api/users to SYSTEM_ADMIN; the
// session check below is defence-in-depth, not the only barrier.

import { z } from 'zod'
import { randomUUID, randomBytes, createHash } from 'crypto'
import { getSessionFromRequest, hashPassword } from '@/lib/auth'

export const dynamic = 'force-dynamic'

const STAFF_ROLES = ['SYSTEM_ADMIN', 'NATIONAL_ADMIN', 'AUDITOR'] as const

const provisionSchema = z.object({
  fullName: z.string().min(2).max(120),
  email: z.string().email(),
  phone: z.string().min(6).max(20).regex(/^\+?[0-9\s-]+$/, 'Invalid phone'),
  role: z.enum(STAFF_ROLES),
})

export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req)
    if (!session || session.role !== 'SYSTEM_ADMIN') {
      return NextResponse.json(
        { success: false, error: 'Access denied. System Admin only.' },
        { status: 403 }
      )
    }

    const parsed = provisionSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.errors[0]?.message || 'Invalid input' },
        { status: 400 }
      )
    }
    const email = parsed.data.email.toLowerCase().trim()
    const phone = parsed.data.phone.replace(/[\s-]/g, '')
    const { fullName, role } = parsed.data

    // One query for both uniqueness checks
    const existing = await prisma.user.findFirst({
      where: { OR: [{ email }, { phone }] },
      select: { email: true },
    })
    if (existing) {
      return NextResponse.json(
        { success: false, error: 'A user with this email or phone already exists' },
        { status: 409 }
      )
    }

    // Unusable random password — never known to anyone; replaced at setup
    const passwordHash = await hashPassword(randomBytes(32).toString('hex'))

    let user
    try {
      user = await prisma.user.create({
        data: { email, phone, passwordHash, fullName: fullName.trim(), role },
        select: { id: true, email: true, fullName: true, role: true },
      })
    } catch (e: any) {
      if (e?.code === 'P2002') {
        return NextResponse.json(
          { success: false, error: 'A user with this email or phone already exists' },
          { status: 409 }
        )
      }
      throw e
    }

    // One-time setup token (72h). Stored hashed; raw value returned once.
    const rawToken = randomBytes(32).toString('hex')
    const tokenHash = createHash('sha256').update(rawToken).digest('hex')
    await prisma.$executeRawUnsafe(
      `INSERT INTO "UserSetupToken" ("id","userId","tokenHash","createdById","expiresAt")
       VALUES ($1,$2,$3,$4, now() + interval '72 hours')`,
      randomUUID(), user.id, tokenHash, session.id
    )

    await prisma.auditLog.create({
      data: {
        userId: session.id,
        action: 'CREATE',
        entityType: 'User',
        entityId: user.id,
        description: `Provisioned ${role} account for ${user.email}`,
        ipAddress: req.ip || 'unknown',
        userAgent: req.headers.get('user-agent') || undefined,
      },
    })

    const origin = req.nextUrl.origin
    return NextResponse.json({
      success: true,
      message: 'Staff user created. Share the setup link — it expires in 72 hours.',
      data: {
        user,
        setupLink: `${origin}/setup/${rawToken}`,
      },
    })
  } catch (e: any) {
    console.error('POST /api/users error:', e?.message)
    return NextResponse.json({ success: false, error: 'Failed to create user' }, { status: 500 })
  }
}
