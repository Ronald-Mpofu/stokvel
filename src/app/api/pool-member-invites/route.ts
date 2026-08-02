// src/app/api/pool-member-invites/route.ts
// Group admins invite Pool Members into their group via this endpoint.
//
// Version 2.0 — authorisation + entitlement convergence.
//
// ── WHAT v1 DID ──────────────────────────────────────────────
// 1. NO AUTHORISATION ANYWHERE. Middleware only checks that the caller
//    is logged in, so any authenticated user could:
//      · POST an invite into ANY group, with invitedBy taken straight
//        from the request body — fully spoofable
//      · PUT with any invite id and accept SOMEONE ELSE'S invite,
//        inserting a GroupMember row for a group they have no
//        relationship with
//    That is a stranger adding themselves to your group.
//
// 2. GET with no query parameters returned EVERY invite on the
//    platform, across all groups, including pool member names and
//    email addresses.
//
// 3. The GroupMember insert supplied firstName / lastName / email /
//    phone but NO userId. Those rows are invisible to the entitlement
//    resolver, which joins on gm."userId" — so a member admitted this
//    way could never be entitled, while still counting toward group
//    size. Worst of both.
//
// 4. No `export const dynamic`, so Vercel could serve a cached list.
//
// ── WHAT v2 DOES ─────────────────────────────────────────────
// · GET requires either group-manager rights on ?groupId, or that
//   ?poolMemberId resolves to the caller's own email. No unscoped list.
// · POST requires requireGroupManager on the target group. invitedBy is
//   taken from the SESSION, never from the body.
// · PUT binds to the invited person: the caller's email must match the
//   PoolMember's email. Same principle as an invite token binding to
//   its email rather than to whoever happens to be logged in.
// · ACCEPT resolves a User by email and writes userId onto the
//   GroupMember row, so the member is visible to entitlement. The
//   legacy denormalised columns are still written, so nothing reading
//   them breaks.
// · Where no User exists for that email, the accept is REFUSED with
//   NEEDS_ACCOUNT rather than creating an orphaned row. Creating an
//   account here would mean minting credentials with no password, no
//   terms acceptance and no verified email.
//
// ── NOT IN PRISMA ────────────────────────────────────────────
// PoolMember, PoolMemberGroupInvite, and the denormalised GroupMember
// columns (firstName, lastName, email, phone, memberType) are raw SQL.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import prisma from '@/lib/prisma/client';
import { randomUUID } from 'crypto';
import {
  getSessionFromRequest,
  requireGroupManager,
  unauthorized,
  forbidden,
} from '@/lib/auth';
import { stampGroupReachedMinimum } from '@/lib/group-entitlement';

export const dynamic = 'force-dynamic';

const ok = (data: unknown, status = 200) =>
  NextResponse.json({ success: true, data }, { status });
const err = (error: string, status = 400, code?: string) =>
  NextResponse.json({ success: false, error, ...(code ? { code } : {}) }, { status });

const CreateInviteSchema = z.object({
  poolMemberId: z.string().uuid(),
  groupId:      z.string().min(1),
  message:      z.string().max(500).optional(),
  // invitedBy is deliberately ABSENT. v1 read it from the body, which
  // let any caller attribute an invite to anyone. It now comes from the
  // session and body values are ignored.
});

const RespondSchema = z.object({
  id:     z.string().uuid(),
  status: z.enum(['ACCEPTED', 'DECLINED']),
});

async function sql<T = Record<string, unknown>>(query: string, params: unknown[] = []) {
  return prisma.$queryRawUnsafe<T[]>(query, ...params);
}

// ── GET /api/pool-member-invites?groupId=x OR ?poolMemberId=x ─
export async function GET(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return unauthorized();

    const { searchParams } = req.nextUrl;
    const groupId      = searchParams.get('groupId');
    const poolMemberId = searchParams.get('poolMemberId');
    const status       = searchParams.get('status');

    // v1 returned every invite on the platform when called bare.
    if (!groupId && !poolMemberId) {
      return err('Specify groupId or poolMemberId', 400);
    }

    if (groupId) {
      const guardErr = await requireGroupManager(req, groupId);
      if (guardErr) return guardErr;
    }

    if (poolMemberId) {
      // A pool member may read their OWN invites. Anyone else needs
      // group-manager rights, which the groupId branch above covers.
      const owner = await sql<{ email: string }>(
        `SELECT email FROM "PoolMember" WHERE id = $1`,
        [poolMemberId]
      );
      const isOwner =
        owner.length > 0 &&
        String(owner[0].email).toLowerCase() === session.email.toLowerCase();
      if (!isOwner && !groupId) {
        return forbidden('Not authorised to view these invites');
      }
    }

    const where: string[] = ['1=1'];
    const params: unknown[] = [];
    let p = 1;

    if (groupId)      { where.push(`i."groupId" = $${p++}`);      params.push(groupId); }
    if (poolMemberId) { where.push(`i."poolMemberId" = $${p++}`); params.push(poolMemberId); }
    if (status)       { where.push(`i.status = $${p++}`);         params.push(status); }

    const rows = await sql(`
      SELECT
        i.*,
        pm."firstName", pm."lastName", pm.email, pm.country, pm.status AS "poolMemberStatus",
        g.name AS "groupName"
      FROM "PoolMemberGroupInvite" i
      JOIN "PoolMember" pm ON pm.id = i."poolMemberId"
      JOIN "Group" g ON g.id = i."groupId"
      WHERE ${where.join(' AND ')}
      ORDER BY i."createdAt" DESC
    `, params);

    return ok(rows);
  } catch (e: unknown) {
    console.error('GET /api/pool-member-invites error:', (e as Error)?.message);
    return err('Failed to fetch invites', 500);
  }
}

// ── POST — admin sends invite ──────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return unauthorized();

    const body = await req.json();
    const parsed = CreateInviteSchema.safeParse(body);
    if (!parsed.success) return err(parsed.error.errors[0].message);

    const d = parsed.data;

    // Only a manager of the TARGET group may invite into it.
    const guardErr = await requireGroupManager(req, d.groupId);
    if (guardErr) return guardErr;

    // Invites are only meaningful for a group people can actually join.
    // Consistent with the rule that invitations wait until a group is
    // ACTIVE — a DRAFT group has not been paid for and cannot confer
    // entitlement on anyone who accepts.
    const grp = await sql<{ status: string; deletedAt: Date | null }>(
      `SELECT status::text AS status, "deletedAt" FROM "Group" WHERE id = $1`,
      [d.groupId]
    );
    if (!grp.length || grp[0].deletedAt) return err('Group not found', 404);
    if (grp[0].status !== 'ACTIVE') {
      return err(
        'This group is not active yet. Activate it before inviting members.',
        409,
        'GROUP_NOT_ACTIVE'
      );
    }

    const existing = await sql<{ id: string }>(`
      SELECT id FROM "PoolMemberGroupInvite"
      WHERE "poolMemberId" = $1 AND "groupId" = $2 AND status = 'PENDING'
    `, [d.poolMemberId, d.groupId]);

    if (existing.length > 0) {
      return err('A pending invite already exists for this member and group', 409);
    }

    const id = randomUUID();
    const result = await sql(`
      INSERT INTO "PoolMemberGroupInvite"
        (id, "poolMemberId", "groupId", "invitedBy", status, message, "expiresAt", "createdAt")
      VALUES
        ($1, $2, $3, $4, 'PENDING', $5, NOW() + INTERVAL '30 days', NOW())
      RETURNING *
    `, [id, d.poolMemberId, d.groupId, session.id, d.message ?? null]);

    return ok(result[0], 201);
  } catch (e: unknown) {
    console.error('POST /api/pool-member-invites error:', (e as Error)?.message);
    return err('Failed to send invite', 500);
  }
}

// ── PUT — pool member responds ─────────────────────────────────
export async function PUT(req: NextRequest) {
  try {
    const session = await getSessionFromRequest(req);
    if (!session) return unauthorized();

    const body = await req.json();
    const parsed = RespondSchema.safeParse(body);
    if (!parsed.success) return err(parsed.error.errors[0].message);

    const { id, status } = parsed.data;

    // Load BEFORE updating, so the invite can be bound to the caller.
    // v1 updated first and never checked who was calling.
    const invRows = await sql<{
      id: string;
      poolMemberId: string;
      groupId: string;
      status: string;
      expiresAt: Date | null;
      email: string;
      firstName: string | null;
      lastName: string | null;
      phone: string | null;
    }>(`
      SELECT i.id, i."poolMemberId", i."groupId", i.status, i."expiresAt",
             pm.email, pm."firstName", pm."lastName", pm.phone
      FROM "PoolMemberGroupInvite" i
      JOIN "PoolMember" pm ON pm.id = i."poolMemberId"
      WHERE i.id = $1
    `, [id]);

    if (!invRows.length) return err('Invite not found', 404);
    const inv = invRows[0];

    if (inv.status !== 'PENDING') return err('Invite already responded to', 409);
    if (inv.expiresAt && new Date(inv.expiresAt) < new Date()) {
      return err('This invite has expired', 410, 'EXPIRED');
    }

    // BINDING: the invite belongs to an email address, not to whoever
    // is logged in. Without this, anyone could accept anyone's invite.
    if (String(inv.email).toLowerCase() !== session.email.toLowerCase()) {
      return forbidden('This invitation was issued to a different account');
    }

    // ── DECLINE ──────────────────────────────────────────────
    if (status === 'DECLINED') {
      const declined = await sql(`
        UPDATE "PoolMemberGroupInvite"
        SET status = 'DECLINED', "respondedAt" = NOW()
        WHERE id = $1 AND status = 'PENDING'
        RETURNING *
      `, [id]);
      if (!declined.length) return err('Invite not found or already responded');
      return ok(declined[0]);
    }

    // ── ACCEPT ───────────────────────────────────────────────
    // The session IS the User, since the email binding above already
    // matched. Writing session.id onto the GroupMember row is what
    // makes this member visible to the entitlement resolver.
    const userId = session.id;

    const alreadyMember = await sql<{ id: string }>(
      `SELECT id FROM "GroupMember" WHERE "groupId" = $1 AND "userId" = $2`,
      [inv.groupId, userId]
    );

    if (!alreadyMember.length) {
      // Raw SQL rather than Prisma: the denormalised columns
      // (firstName, lastName, email, phone, memberType) are not in
      // schema.prisma and may be NOT NULL, so they must still be
      // written. userId is the addition that v1 was missing.
      await prisma.$executeRawUnsafe(`
        INSERT INTO "GroupMember"
          (id, "groupId", "userId", "firstName", "lastName", email, phone,
           status, "memberType", "joinedAt", "createdAt", "updatedAt")
        VALUES
          ($1, $2, $3, $4, $5, $6, $7,
           'ACTIVE'::"MemberStatus", 'GROUP_MEMBER'::"MemberType", NOW(), NOW(), NOW())
        ON CONFLICT DO NOTHING
      `, randomUUID(), inv.groupId, userId,
         inv.firstName, inv.lastName, inv.email, inv.phone ?? null);
    }

    const accepted = await sql(`
      UPDATE "PoolMemberGroupInvite"
      SET status = 'ACCEPTED', "respondedAt" = NOW()
      WHERE id = $1 AND status = 'PENDING'
      RETURNING *
    `, [id]);

    if (!accepted.length) return err('Invite not found or already responded');

    // ── Entitlement: stamp reachedMinimumAt ──────────────────
    // Meaningful now that the row carries a userId. Never throws, so a
    // stamping failure cannot undo a join that already succeeded.
    await stampGroupReachedMinimum(inv.groupId);

    return ok(accepted[0]);
  } catch (e: unknown) {
    console.error('PUT /api/pool-member-invites error:', (e as Error)?.message);
    return err('Failed to update invite', 500);
  }
}
