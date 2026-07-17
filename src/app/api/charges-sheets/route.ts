// src/app/api/charge-sheets/route.ts
// CRUD for group monthly subscription pricing (RefChargeSheet + RefChargeTier).
// SYSTEM_ADMIN only. Member annual fee is NOT managed here — it lives in
// RefJoiningFee (see /api/joining-fee).
//
// GET              → all sheets with nested tiers + addable countries (one call)
// POST             → create sheet for a country  { countryCode, currency, tiers }
// PUT    ?id=xxx   → update sheet                { currency?, isActive?, tiers? }
// DELETE ?id=xxx   → delete sheet (tiers cascade). DEFAULT cannot be deleted.

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { prisma } from '@/lib/prisma/client';
import { getSessionFromRequest } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// ------------------------------------------------------------------
// Validation
// ------------------------------------------------------------------
const TierSchema = z.object({
  minMembers: z.number().int().min(1),
  maxMembers: z.number().int().min(1).nullable(),
  monthlyFee: z.number().nonnegative(),
});

// Tiers must be contiguous from 1 with an open-ended last tier, so
// resolveGroupMonthlyPrice can never fall into a gap:
//   [1..10] [11..20] [21..null]  ✓
//   [1..10] [12..20]             ✗ gap at 11
//   [1..10] [11..20]             ✗ nothing above 20
const TiersArraySchema = z
  .array(TierSchema)
  .min(1, 'At least one tier is required')
  .superRefine((tiers, ctx) => {
    const sorted = [...tiers].sort((a, b) => a.minMembers - b.minMembers);
    if (sorted[0].minMembers !== 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'First tier must start at 1 member' });
      return;
    }
    for (let i = 0; i < sorted.length; i++) {
      const t = sorted[i];
      const isLast = i === sorted.length - 1;
      if (isLast) {
        if (t.maxMembers !== null) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Last tier must be open-ended (no max)' });
        }
      } else {
        if (t.maxMembers === null) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Only the last tier may be open-ended' });
          return;
        }
        if (t.maxMembers < t.minMembers) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Tier ${i + 1}: max is below min` });
          return;
        }
        if (sorted[i + 1].minMembers !== t.maxMembers + 1) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Gap or overlap between ${t.maxMembers} and ${sorted[i + 1].minMembers} members`,
          });
          return;
        }
      }
    }
  });

const CreateSchema = z.object({
  countryCode: z.string().min(2).max(10).transform((s) => s.toUpperCase()),
  currency: z.string().length(3).transform((s) => s.toUpperCase()),
  tiers: TiersArraySchema,
});

const UpdateSchema = z.object({
  currency: z.string().length(3).transform((s) => s.toUpperCase()).optional(),
  isActive: z.boolean().optional(),
  tiers: TiersArraySchema.optional(),
});

// ------------------------------------------------------------------
// Auth guard — SYSTEM_ADMIN only
// ------------------------------------------------------------------
async function requireSystemAdmin(req: NextRequest): Promise<NextResponse | null> {
  const session = await getSessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ success: false, error: 'Unauthorised. Please log in.' }, { status: 401 });
  }
  if (session.role !== 'SYSTEM_ADMIN') {
    return NextResponse.json({ success: false, error: 'Access denied. System Admin only.' }, { status: 403 });
  }
  return null;
}

// ------------------------------------------------------------------
// GET — sheets + tiers + addable countries, single response
// ------------------------------------------------------------------
export async function GET(req: NextRequest) {
  try {
    const guardErr = await requireSystemAdmin(req);
    if (guardErr) return guardErr;

    const [sheets, tiers, countries] = await Promise.all([
      prisma.$queryRawUnsafe<any[]>(
        `SELECT "id", "countryCode", "currency", "isActive",
                "effectiveFrom", "updatedAt"
         FROM "RefChargeSheet"
         ORDER BY CASE WHEN "countryCode" = 'DEFAULT' THEN 0 ELSE 1 END, "countryCode"`
      ),
      prisma.$queryRawUnsafe<any[]>(
        `SELECT "id", "sheetId", "minMembers", "maxMembers",
                "monthlyFee"::text AS "monthlyFee", "sortOrder"
         FROM "RefChargeTier"
         ORDER BY "sheetId", "minMembers"`
      ),
      // Countries eligible for a charge sheet = countries with joining
      // fee config. countryName comes along for the dropdown label.
      prisma.$queryRawUnsafe<any[]>(
        `SELECT "countryCode", "countryName", "currency"
         FROM "RefJoiningFee"
         WHERE "isActive" = true
         ORDER BY "countryName"`
      ),
    ]);

    const tiersBySheet: Record<string, any[]> = {};
    for (const t of tiers) {
      if (!tiersBySheet[t.sheetId]) tiersBySheet[t.sheetId] = [];
      tiersBySheet[t.sheetId].push({
        id: t.id,
        minMembers: t.minMembers,
        maxMembers: t.maxMembers,
        monthlyFee: Number(t.monthlyFee),
      });
    }

    const existing = new Set(sheets.map((s) => s.countryCode));
    const data = {
      sheets: sheets.map((s) => ({
        id: s.id,
        countryCode: s.countryCode,
        currency: s.currency,
        isActive: s.isActive,
        effectiveFrom: s.effectiveFrom,
        updatedAt: s.updatedAt,
        tiers: tiersBySheet[s.id] || [],
      })),
      availableCountries: countries
        .filter((c) => !existing.has(c.countryCode))
        .map((c) => ({
          countryCode: c.countryCode,
          countryName: c.countryName,
          currency: c.currency,
        })),
    };

    return NextResponse.json({ success: true, data });
  } catch (e: any) {
    console.error('GET /api/charge-sheets error:', e?.message);
    return NextResponse.json({ success: false, error: 'Failed to load charge sheets' }, { status: 500 });
  }
}

// ------------------------------------------------------------------
// POST — create a sheet + tiers
// ------------------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
    const guardErr = await requireSystemAdmin(req);
    if (guardErr) return guardErr;

    const body = await req.json();
    const parsed = CreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.errors[0]?.message || 'Invalid request' },
        { status: 400 }
      );
    }
    const { countryCode, currency, tiers } = parsed.data;

    const sheetId = randomUUID();
    const inserts = tiers
      .sort((a, b) => a.minMembers - b.minMembers)
      .map((t, i) =>
        prisma.$executeRawUnsafe(
          `INSERT INTO "RefChargeTier"
             ("id","sheetId","minMembers","maxMembers","monthlyFee","sortOrder")
           VALUES ($1,$2,$3,$4,$5,$6)`,
          randomUUID(), sheetId, t.minMembers, t.maxMembers, t.monthlyFee, i + 1
        )
      );

    await prisma.$transaction([
      prisma.$executeRawUnsafe(
        `INSERT INTO "RefChargeSheet" ("id","countryCode","currency")
         VALUES ($1,$2,$3)`,
        sheetId, countryCode, currency
      ),
      ...inserts,
    ]);

    return NextResponse.json({
      success: true,
      message: `Charge sheet created for ${countryCode}`,
      data: { id: sheetId },
    });
  } catch (e: any) {
    if (e?.message?.includes('23505') || e?.code === 'P2010') {
      // Unique violation on countryCode
      console.error('POST /api/charge-sheets conflict:', e?.message);
      return NextResponse.json(
        { success: false, error: 'A charge sheet already exists for this country' },
        { status: 409 }
      );
    }
    console.error('POST /api/charge-sheets error:', e?.message);
    return NextResponse.json({ success: false, error: 'Failed to create charge sheet' }, { status: 500 });
  }
}

// ------------------------------------------------------------------
// PUT ?id=xxx — update currency/isActive and/or replace tiers
// ------------------------------------------------------------------
export async function PUT(req: NextRequest) {
  try {
    const guardErr = await requireSystemAdmin(req);
    if (guardErr) return guardErr;

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ success: false, error: 'Missing sheet id' }, { status: 400 });
    }

    const body = await req.json();
    const parsed = UpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.errors[0]?.message || 'Invalid request' },
        { status: 400 }
      );
    }
    const { currency, isActive, tiers } = parsed.data;

    const existing: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id" FROM "RefChargeSheet" WHERE "id" = $1`,
      id
    );
    if (!existing.length) {
      return NextResponse.json({ success: false, error: 'Charge sheet not found' }, { status: 404 });
    }

    const ops: any[] = [];

    if (currency !== undefined || isActive !== undefined) {
      ops.push(
        prisma.$executeRawUnsafe(
          `UPDATE "RefChargeSheet"
           SET "currency" = COALESCE($2, "currency"),
               "isActive" = COALESCE($3, "isActive"),
               "updatedAt" = now()
           WHERE "id" = $1`,
          id, currency ?? null, isActive ?? null
        )
      );
    }

    if (tiers !== undefined) {
      // Replace-all: simplest correct model for tier edits — no diffing,
      // no orphan rows, contiguity already validated by Zod.
      ops.push(
        prisma.$executeRawUnsafe(`DELETE FROM "RefChargeTier" WHERE "sheetId" = $1`, id)
      );
      const sorted = [...tiers].sort((a, b) => a.minMembers - b.minMembers);
      for (let i = 0; i < sorted.length; i++) {
        const t = sorted[i];
        ops.push(
          prisma.$executeRawUnsafe(
            `INSERT INTO "RefChargeTier"
               ("id","sheetId","minMembers","maxMembers","monthlyFee","sortOrder")
             VALUES ($1,$2,$3,$4,$5,$6)`,
            randomUUID(), id, t.minMembers, t.maxMembers, t.monthlyFee, i + 1
          )
        );
      }
    }

    if (ops.length === 0) {
      return NextResponse.json({ success: false, error: 'Nothing to update' }, { status: 400 });
    }

    await prisma.$transaction(ops);

    return NextResponse.json({ success: true, message: 'Charge sheet updated' });
  } catch (e: any) {
    console.error('PUT /api/charge-sheets error:', e?.message);
    return NextResponse.json({ success: false, error: 'Failed to update charge sheet' }, { status: 500 });
  }
}

// ------------------------------------------------------------------
// DELETE ?id=xxx — remove a sheet (tiers cascade via FK)
// ------------------------------------------------------------------
export async function DELETE(req: NextRequest) {
  try {
    const guardErr = await requireSystemAdmin(req);
    if (guardErr) return guardErr;

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ success: false, error: 'Missing sheet id' }, { status: 400 });
    }

    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "countryCode" FROM "RefChargeSheet" WHERE "id" = $1`,
      id
    );
    if (!rows.length) {
      return NextResponse.json({ success: false, error: 'Charge sheet not found' }, { status: 404 });
    }
    if (rows[0].countryCode === 'DEFAULT') {
      // DEFAULT is the pricing fallback for every unconfigured country —
      // deleting it would make group activation fail platform-wide.
      return NextResponse.json(
        { success: false, error: 'The DEFAULT sheet cannot be deleted. Deactivate it instead.' },
        { status: 400 }
      );
    }

    await prisma.$executeRawUnsafe(`DELETE FROM "RefChargeSheet" WHERE "id" = $1`, id);

    return NextResponse.json({ success: true, message: `Charge sheet for ${rows[0].countryCode} deleted` });
  } catch (e: any) {
    console.error('DELETE /api/charge-sheets error:', e?.message);
    return NextResponse.json({ success: false, error: 'Failed to delete charge sheet' }, { status: 500 });
  }
}
