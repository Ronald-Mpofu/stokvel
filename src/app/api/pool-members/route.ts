// src/app/api/pool-members/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import prisma from '@/lib/prisma/client';
import { randomUUID } from 'crypto';

const ok = (data: unknown, status = 200) =>
  NextResponse.json({ success: true, data }, { status });
const err = (error: string, status = 400) =>
  NextResponse.json({ success: false, error }, { status });

// ── Zod schemas ────────────────────────────────────────────────
const CreatePoolMemberSchema = z.object({
  firstName:        z.string().min(1),
  lastName:         z.string().min(1),
  email:            z.string().email(),
  phone:            z.string().optional(),
  country:          z.string().min(2).max(3).default('ZA'),
  currency:         z.string().min(1).default('USD'),   // NOT NULL in DB — always required
  paymentMethod:    z.string().min(1).default('CASH'),
  joiningFeeAmount: z.number().positive().optional(),
  notes:            z.string().optional(),
});

const UpdatePoolMemberSchema = z.object({
  id:               z.string().min(1),
  firstName:        z.string().min(1).optional(),
  lastName:         z.string().min(1).optional(),
  phone:            z.string().optional(),
  country:          z.string().min(2).max(3).optional(),
  currency:         z.string().optional(),
  status:           z.enum(['ACTIVE','PENDING','SUSPENDED','CLOSED']).optional(),
  joiningFeeStatus: z.enum(['PENDING','PAID','EXPIRED','WAIVED']).optional(),
  paymentMethod:    z.string().min(1).optional(),
  notes:            z.string().optional(),
});

// ── GET /api/pool-members ──────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = req.nextUrl;
    const status  = searchParams.get('status')  || null;
    const country = searchParams.get('country') || null;
    const search  = searchParams.get('search')  || null;
    const page    = Math.max(1, parseInt(searchParams.get('page')  || '1'));
    const limit   = Math.min(100, parseInt(searchParams.get('limit') || '20'));
    const offset  = (page - 1) * limit;

    let whereClause = 'WHERE 1=1';
    const params: unknown[] = [];
    let p = 1;

    if (status) {
      whereClause += ` AND pm.status = $${p}`;
      params.push(status); p++;
    }
    if (country) {
      whereClause += ` AND pm.country = $${p}`;
      params.push(country); p++;
    }
    if (search) {
      whereClause += ` AND (
        pm."firstName" ILIKE $${p} OR
        pm."lastName"  ILIKE $${p} OR
        pm.email       ILIKE $${p}
      )`;
      params.push(`%${search}%`); p++;
    }

    const countQuery = `
      SELECT COUNT(*) AS total
      FROM "PoolMember" pm
      ${whereClause}
    `;

    const summaryQuery = `
      SELECT
        COUNT(*) FILTER (WHERE pm.status = 'ACTIVE') AS active,
        COUNT(*) FILTER (WHERE pm.status = 'PENDING') AS pending,
        COUNT(*) FILTER (WHERE pm."joiningFeeStatus" = 'PENDING' AND pm."joiningFeeAmount" IS NOT NULL) AS "feeUnpaid"
      FROM "PoolMember" pm
      ${whereClause}
    `;

    // Safe data query — no JOIN on PoolMemberGroupInvite (table may not exist yet)
    // groupInviteCount hardcoded to 0; update this once invite table is confirmed in DB
    const dataQuery = `
      SELECT
        pm.*,
        0 AS "groupInviteCount"
      FROM "PoolMember" pm
      ${whereClause}
      ORDER BY pm."createdAt" DESC
      LIMIT $${p} OFFSET $${p + 1}
    `;

    const [countResult, summaryResult, rows] = await Promise.all([
      prisma.$queryRawUnsafe<{ total: bigint }[]>(countQuery, ...params),
      prisma.$queryRawUnsafe<{ active: bigint; pending: bigint; feeUnpaid: bigint }[]>(summaryQuery, ...params),
      prisma.$queryRawUnsafe<Record<string, unknown>[]>(dataQuery, ...params, limit, offset),
    ]);

    const total   = Number(countResult[0]?.total ?? 0);
    const summary = summaryResult[0];

    return ok({
      items: rows,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      summary: {
        active:    Number(summary?.active    ?? 0),
        pending:   Number(summary?.pending   ?? 0),
        feeUnpaid: Number(summary?.feeUnpaid ?? 0),
      },
    });
  } catch (e: unknown) {
    const msg = (e as Error)?.message ?? '';
    console.error('GET /api/pool-members error:', msg);
    return err(msg || 'Failed to fetch pool members', 500);
  }
}

// ── POST /api/pool-members ─────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = CreatePoolMemberSchema.safeParse(body);
    if (!parsed.success) return err(parsed.error.errors[0].message);

    const d = parsed.data;
    const id = randomUUID();

    const joiningFeeExpiry = d.joiningFeeAmount
      ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
      : null;

    const joiningFeeStatus = d.joiningFeeAmount ? 'PENDING' : 'WAIVED';

    const result = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(`
      INSERT INTO "PoolMember" (
        id, "firstName", "lastName", email, phone, country, currency,
        status, "joiningFeeStatus", "joiningFeeAmount", "joiningFeeExpiry",
        "paymentMethod", notes, "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        'PENDING',
        $8,
        $9, $10,
        $11,
        $12, NOW(), NOW()
      )
      RETURNING *
    `,
      id, d.firstName, d.lastName, d.email, d.phone ?? null, d.country, d.currency,
      joiningFeeStatus,
      d.joiningFeeAmount ?? null, joiningFeeExpiry,
      d.paymentMethod, d.notes ?? null
    );

    return ok(result[0], 201);
  } catch (e: unknown) {
    const msg = (e as Error)?.message ?? '';
    console.error('POST /api/pool-members error:', msg);
    if (msg.includes('already exists') || msg.includes('23505') || msg.includes('unique'))
      return err('A pool member with this email already exists');
    if (msg.includes('column'))         return err(`Database column error: ${msg}`);
    if (msg.includes('does not exist')) return err(`Schema error: ${msg}`);
    return err(msg || 'Failed to create pool member', 500);
  }
}

// ── PUT /api/pool-members ──────────────────────────────────────
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = UpdatePoolMemberSchema.safeParse(body);
    if (!parsed.success) return err(parsed.error.errors[0].message);

    const d = parsed.data;
    const sets: string[] = [];
    const params: unknown[] = [d.id];
    let p = 2;

    if (d.firstName)           { sets.push(`"firstName" = $${p++}`);        params.push(d.firstName); }
    if (d.lastName)            { sets.push(`"lastName" = $${p++}`);         params.push(d.lastName); }
    if (d.phone !== undefined) { sets.push(`phone = $${p++}`);              params.push(d.phone ?? null); }
    if (d.country)             { sets.push(`country = $${p++}`);            params.push(d.country); }
    if (d.currency !== undefined) { sets.push(`currency = $${p++}`);        params.push(d.currency ?? null); }
    if (d.notes !== undefined) { sets.push(`notes = $${p++}`);              params.push(d.notes ?? null); }
    if (d.status)              { sets.push(`status = $${p++}`);             params.push(d.status); }
    if (d.joiningFeeStatus) {
      sets.push(`"joiningFeeStatus" = $${p++}`);
      params.push(d.joiningFeeStatus);
      if (d.joiningFeeStatus === 'PAID') {
        sets.push(`"joiningFeePaid" = TRUE`);
        sets.push(`"joiningFeePaidAt" = NOW()`);
        sets.push(`"joiningFeeExpiry" = NOW() + INTERVAL '12 months'`);
      }
    }
    if (d.paymentMethod) { sets.push(`"paymentMethod" = $${p++}`); params.push(d.paymentMethod); }

    if (!sets.length) return err('No fields to update');
    sets.push(`"updatedAt" = NOW()`);

    const result = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(`
      UPDATE "PoolMember" SET ${sets.join(', ')}
      WHERE id = $1
      RETURNING *
    `, ...params);

    if (!result.length) return err('Pool member not found', 404);
    return ok(result[0]);
  } catch (e: unknown) {
    const msg = (e as Error)?.message ?? '';
    console.error('PUT /api/pool-members error:', msg);
    return err(msg || 'Failed to update pool member', 500);
  }
}

// ── DELETE /api/pool-members?id=xxx ───────────────────────────
export async function DELETE(req: NextRequest) {
  try {
    const id = req.nextUrl.searchParams.get('id');
    if (!id) return err('id is required');

    await prisma.$executeRawUnsafe(`
      UPDATE "PoolMember"
      SET status = 'CLOSED', "updatedAt" = NOW()
      WHERE id = $1
    `, id);

    return ok({ message: 'Pool member account closed' });
  } catch (e: unknown) {
    const msg = (e as Error)?.message ?? '';
    console.error('DELETE /api/pool-members error:', msg);
    return err(msg || 'Failed to close pool member account', 500);
  }
}
