// src/app/api/pool-member-invites/route.ts
// Group admins invite Pool Members into their group via this endpoint.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import prisma from '@/lib/prisma/client';
import { randomUUID } from 'crypto';

const ok = (data: unknown, status = 200) =>
  NextResponse.json({ success: true, data }, { status });
const err = (error: string, status = 400) =>
  NextResponse.json({ success: false, error }, { status });

const CreateInviteSchema = z.object({
  poolMemberId: z.string().uuid(),
  groupId:      z.string().min(1),
  invitedBy:    z.string().min(1),
  message:      z.string().max(500).optional(),
});

const RespondSchema = z.object({
  id:     z.string().uuid(),
  status: z.enum(['ACCEPTED', 'DECLINED']),
});

// ── GET /api/pool-member-invites?groupId=x OR ?poolMemberId=x ─
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const groupId      = searchParams.get('groupId');
    const poolMemberId = searchParams.get('poolMemberId');
    const status       = searchParams.get('status');

    let where = 'WHERE 1=1';
    const params: unknown[] = [];
    let p = 1;

    if (groupId)      { where += ` AND i."groupId" = $${p++}`;       params.push(groupId); }
    if (poolMemberId) { where += ` AND i."poolMemberId" = $${p++}`;  params.push(poolMemberId); }
    if (status)       { where += ` AND i.status = $${p++}`;          params.push(status); }

    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(`
      SELECT
        i.*,
        pm."firstName", pm."lastName", pm.email, pm.country, pm.status AS "poolMemberStatus",
        g.name AS "groupName"
      FROM "PoolMemberGroupInvite" i
      JOIN "PoolMember" pm ON pm.id = i."poolMemberId"
      JOIN "Group" g ON g.id = i."groupId"
      ${where}
      ORDER BY i."createdAt" DESC
    `, ...params);

    return ok(rows);
  } catch (e: unknown) {
    console.error('GET /api/pool-member-invites error:', (e as Error)?.message);
    return err('Failed to fetch invites', 500);
  }
}

// ── POST /api/pool-member-invites — admin sends invite ─────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = CreateInviteSchema.safeParse(body);
    if (!parsed.success) return err(parsed.error.errors[0].message);

    const d = parsed.data;

    // Guard: don't create duplicate pending invite
    const existing = await prisma.$queryRawUnsafe<{ id: string }[]>(`
      SELECT id FROM "PoolMemberGroupInvite"
      WHERE "poolMemberId" = $1 AND "groupId" = $2 AND status = 'PENDING'
    `, d.poolMemberId, d.groupId);

    if (existing.length > 0) {
      return err('A pending invite already exists for this member and group');
    }

    const id = randomUUID();
    const result = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(`
      INSERT INTO "PoolMemberGroupInvite"
        (id, "poolMemberId", "groupId", "invitedBy", status, message, "expiresAt", "createdAt")
      VALUES
        ($1, $2, $3, $4, 'PENDING', $5, NOW() + INTERVAL '30 days', NOW())
      RETURNING *
    `, id, d.poolMemberId, d.groupId, d.invitedBy, d.message ?? null);

    return ok(result[0], 201);
  } catch (e: unknown) {
    console.error('POST /api/pool-member-invites error:', (e as Error)?.message);
    return err('Failed to send invite', 500);
  }
}

// ── PUT /api/pool-member-invites — pool member responds ────────
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = RespondSchema.safeParse(body);
    if (!parsed.success) return err(parsed.error.errors[0].message);

    const { id, status } = parsed.data;

    const result = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(`
      UPDATE "PoolMemberGroupInvite"
      SET status = $2, "respondedAt" = NOW()
      WHERE id = $1 AND status = 'PENDING'
      RETURNING *
    `, id, status);

    if (!result.length) return err('Invite not found or already responded');

    // If accepted → create GroupMember record with memberType = GROUP_MEMBER
    if (status === 'ACCEPTED') {
      const inv = result[0] as Record<string, string>;
      const pool = await prisma.$queryRawUnsafe<Record<string, string>[]>(`
        SELECT * FROM "PoolMember" WHERE id = $1
      `, inv.poolMemberId);

      if (pool.length) {
        const pm = pool[0];
        const gmId = randomUUID();
        // Insert into GroupMember (raw SQL — not in Prisma schema for new columns)
        await prisma.$executeRawUnsafe(`
          INSERT INTO "GroupMember"
            (id, "groupId", "firstName", "lastName", email, phone, status, "memberType", "createdAt", "updatedAt")
          VALUES
            ($1, $2, $3, $4, $5, $6, 'ACTIVE'::"MemberStatus", 'GROUP_MEMBER'::"MemberType", NOW(), NOW())
          ON CONFLICT (email, "groupId") DO NOTHING
        `, gmId, inv.groupId, pm.firstName, pm.lastName, pm.email, pm.phone ?? null);
      }
    }

    return ok(result[0]);
  } catch (e: unknown) {
    console.error('PUT /api/pool-member-invites error:', (e as Error)?.message);
    return err('Failed to update invite', 500);
  }
}
