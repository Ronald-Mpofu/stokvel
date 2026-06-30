// src/app/api/payment-methods/route.ts
// Returns available payment methods for a given country.

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma/client';

const ok = (data: unknown) => NextResponse.json({ success: true, data });
const err = (error: string, status = 400) =>
  NextResponse.json({ success: false, error }, { status });

// GET /api/payment-methods?country=ZA
export async function GET(req: NextRequest) {
  try {
    const country = req.nextUrl.searchParams.get('country') || 'ZA';

    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(`
      SELECT method, "isDefault", "displayName"
      FROM "CountryPaymentMethod"
      WHERE country = $1 AND "isActive" = TRUE
      ORDER BY "isDefault" DESC, "displayName" ASC
    `, country);

    // Fallback: always include Credit Card if country not in DB
    if (!rows.length) {
      return ok([{ method: 'CREDIT_CARD', isDefault: true, displayName: 'Credit Card' }]);
    }

    return ok(rows);
  } catch (e: unknown) {
    console.error('GET /api/payment-methods error:', (e as Error)?.message);
    return err('Failed to fetch payment methods', 500);
  }
}
