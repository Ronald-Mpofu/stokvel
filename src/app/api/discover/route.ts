// src/app/api/discover/route.ts
// Pool Members browse Public groups (the service their joining fee pays for)
// and request to join. Group managers approve or decline requests.
// A request = GroupMember row with status PENDING; approval flips it ACTIVE.
// Raw SQL with explicit enum casts throughout, so this works even before
// `prisma generate` picks up the new PENDING enum value.
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma/client'
import { randomUUID } from 'crypto'
import { getSessionFromRequest, unauthorized, requireGroupManager } from '@/lib/auth'

export const dynamic = 'force-dynamic'

async function sql(query: string, params: any[] = []) {
  return prisma.$queryRawUnsafe(query, ...params) as Promise<any[]>
}
async function exec(query: string, params: any[] = []) {
  return prisma.$executeRawUnsafe(query, ...params)
}

// ── GET ───────────────────────────────────────────────────────
// default            → Public ACTIVE groups + the caller's request status
// ?pendingFor=<gid>  → PENDING join requests for a group (managers only)
export async function GET(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req)
    if (!session) return unauthorized()

    const { searchParams } = new URL(req.url)
    const pendingFor = searchParams.get('pendingFor')

    // ── Admin: list pending join requests for a group ─────────
    if (pendingFor) {
      const guardErr = await requireGroupManager(req, pendingFor)
      if (guardErr) return guardErr
      const rows = await sql(
        `SELECT gm.id, gm."userId", gm."createdAt", u."fullName", u.email, u.phone, u.tier
         FROM "GroupMember" gm
         JOIN "User" u ON u.id = gm."userId"
         WHERE gm."groupId" = $1 AND gm.status = 'PENDING'
         ORDER BY gm."createdAt" ASC`, [pendingFor])
      return NextResponse.json({
        success: true,
        data: rows.map(r => ({
          id: r.id, userId: r.userId, fullName: r.fullName,
          email: r.email, phone: r.phone, tier: r.tier, requestedAt: r.createdAt,
        })),
      })
    }

    // ── Pool member: browse Public groups ─────────────────────
    const rows = await sql(
      `SELECT
         g.id, g.name, g.description, g.country, g.currency,
         g."contributionAmount", g."contributionFrequency", g."maxMembers",
         COALESCE(g.city, '')     AS city,
         COALESCE(g.branding, '')     AS branding,
         COALESCE(g."publicAdvert", '') AS "publicAdvert",
         (SELECT COUNT(*) FROM "GroupMember" WHERE "groupId" = g.id AND status = 'ACTIVE')::int AS "memberCount",
         my.status AS "myStatus"
       FROM "Group" g
       LEFT JOIN "GroupMember" my ON my."groupId" = g.id AND my."userId" = $1
       WHERE g."deletedAt" IS NULL
         AND g.status = 'ACTIVE'
         AND COALESCE(g."groupType", 'PRIVATE') = 'PUBLIC'
       ORDER BY g."createdAt" DESC`, [session.id])

    return NextResponse.json({
      success: true,
      data: rows.map((g: any) => ({
        id:                    g.id,
        name:                  g.name,
        description:           g.description,
        country:               g.country,
        city:                  g.city,
        currency:              g.currency,
        contributionAmount:    Number(g.contributionAmount),
        contributionFrequency: g.contributionFrequency,
        branding:              g.branding,
        publicAdvert:          g.publicAdvert || '',
        memberCount:           Number(g.memberCount),
        maxMembers:            g.maxMembers,
        isFull:                Number(g.memberCount) >= g.maxMembers,
        myStatus:              g.myStatus || null,   // null | PENDING | ACTIVE | ...
      })),
    })
  } catch (e: any) {
    console.error('GET /api/discover error:', e)
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}

// ── POST ──────────────────────────────────────────────────────
// { action:'REQUEST', groupId }            → pool member requests to join
// { action:'APPROVE'|'DECLINE', requestId } → group manager decides
export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req)
    if (!session) return unauthorized()
    const body = await req.json()

    // ── Request to join a Public group ────────────────────────
    if (body.action === 'REQUEST') {
      const { groupId } = body
      if (!groupId) return NextResponse.json({ success: false, error: 'groupId required' }, { status: 400 })

      const g = await sql(
        `SELECT g.id, g.name, g."maxMembers", g.status,
                COALESCE(g."groupType", 'PRIVATE') AS "groupType",
                (SELECT COUNT(*) FROM "GroupMember" WHERE "groupId" = g.id AND status = 'ACTIVE')::int AS "memberCount"
         FROM "Group" g WHERE g.id = $1 AND g."deletedAt" IS NULL`, [groupId])
      if (!g.length) return NextResponse.json({ success: false, error: 'Group not found' }, { status: 404 })
      const grp = g[0]
      if (grp.groupType !== 'PUBLIC') return NextResponse.json({ success: false, error: 'This group is not open to join requests' }, { status: 403 })
      if (grp.status !== 'ACTIVE')    return NextResponse.json({ success: false, error: 'This group is not currently active' }, { status: 409 })
      if (Number(grp.memberCount) >= grp.maxMembers) return NextResponse.json({ success: false, error: 'This group is full' }, { status: 409 })

      const existing = await sql(
        `SELECT id, status FROM "GroupMember" WHERE "groupId" = $1 AND "userId" = $2`, [groupId, session.id])
      if (existing.length) {
        const st = existing[0].status
        if (st === 'PENDING') return NextResponse.json({ success: false, error: 'You have already requested to join this group.' }, { status: 409 })
        if (st === 'ACTIVE')  return NextResponse.json({ success: false, error: 'You are already a member of this group.' }, { status: 409 })
        return NextResponse.json({ success: false, error: `You cannot request to join (previous membership status: ${st}).` }, { status: 409 })
      }

      await exec(
        `INSERT INTO "GroupMember" (id, "groupId", "userId", role, status, "joinedAt", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, 'MEMBER'::"UserRole", 'PENDING'::"MemberStatus", NOW(), NOW(), NOW())`,
        [randomUUID(), groupId, session.id])

      return NextResponse.json({ success: true, message: `Request sent! The admin of "${grp.name}" will review it.` })
    }

    // ── Approve / decline a request (group managers) ───────────
    if (body.action === 'APPROVE' || body.action === 'DECLINE') {
      const { requestId } = body
      if (!requestId) return NextResponse.json({ success: false, error: 'requestId required' }, { status: 400 })

      const rows = await sql(
        `SELECT gm.id, gm."groupId", gm.status, u."fullName"
         FROM "GroupMember" gm JOIN "User" u ON u.id = gm."userId"
         WHERE gm.id = $1`, [requestId])
      if (!rows.length) return NextResponse.json({ success: false, error: 'Request not found' }, { status: 404 })
      const reqRow = rows[0]
      if (reqRow.status !== 'PENDING') return NextResponse.json({ success: false, error: 'This request is no longer pending' }, { status: 409 })

      const guardErr = await requireGroupManager(req, reqRow.groupId)
      if (guardErr) return guardErr

      if (body.action === 'APPROVE') {
        await exec(
          `UPDATE "GroupMember"
           SET status = 'ACTIVE'::"MemberStatus", "approvedById" = $2, "approvedAt" = NOW(), "joinedAt" = NOW(), "updatedAt" = NOW()
           WHERE id = $1`, [requestId, session.id])
        return NextResponse.json({ success: true, message: `${reqRow.fullName} has been admitted to the group.` })
      }

      await exec(`DELETE FROM "GroupMember" WHERE id = $1 AND status = 'PENDING'`, [requestId])
      return NextResponse.json({ success: true, message: `Request from ${reqRow.fullName} declined.` })
    }

    return NextResponse.json({ success: false, error: 'Unknown action' }, { status: 400 })
  } catch (e: any) {
    console.error('POST /api/discover error:', e)
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}
