// ============================================================
// src/lib/payments/chargeSheet.ts
//
// Pricing resolution. Two distinct sources — no overlap:
//   RefJoiningFee                  → member ANNUAL fee (canonical)
//   RefChargeSheet + RefChargeTier → group MONTHLY tiers
//
// None of these tables are in schema.prisma — raw SQL only.
// ============================================================

import { prisma } from '@/lib/prisma/client';
import type { ResolvedPrice } from './types';

const FALLBACK_COUNTRY = 'DEFAULT';

interface JoiningFeeRow {
  countryCode: string;
  currency: string;
  amount: string; // Decimal returns as string from raw SQL
  paymentMethods: unknown;
}

interface SheetRow {
  id: string;
  countryCode: string;
  currency: string;
}

interface TierRow {
  minMembers: number;
  maxMembers: number | null;
  monthlyFee: string;
}

/** paymentMethods may come back as a JSON array or a JSON string. */
function parseMethods(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

// ------------------------------------------------------------
// MEMBER ANNUAL — sourced from RefJoiningFee
// ------------------------------------------------------------

/**
 * Member annual subscription price for a country.
 * No DEFAULT fallback — mirrors the existing /api/joining-fee
 * behaviour, which rejects unconfigured countries outright.
 */
export async function resolveMemberAnnualPrice(
  countryCode: string
): Promise<ResolvedPrice> {
  const rows = await prisma.$queryRawUnsafe<JoiningFeeRow[]>(
    `SELECT "countryCode", "currency", "amount"::text AS "amount", "paymentMethods"
     FROM "RefJoiningFee"
     WHERE "countryCode" = $1 AND "isActive" = true
     LIMIT 1`,
    countryCode
  );

  if (rows.length === 0) {
    throw new Error(`No joining fee configured for ${countryCode}`);
  }

  return {
    currency: rows[0].currency,
    amount: parseFloat(rows[0].amount),
    countryCode: rows[0].countryCode,
  };
}

/**
 * Which payment methods a country offers. Used to decide whether the
 * Stripe (CARD) path is even available before creating a checkout.
 */
export async function getCountryPaymentMethods(
  countryCode: string
): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{ paymentMethods: unknown }>>(
    `SELECT "paymentMethods" FROM "RefJoiningFee"
     WHERE "countryCode" = $1 AND "isActive" = true
     LIMIT 1`,
    countryCode
  );
  return rows.length ? parseMethods(rows[0].paymentMethods) : [];
}

export async function supportsCard(countryCode: string): Promise<boolean> {
  return (await getCountryPaymentMethods(countryCode)).includes('CARD');
}

// ------------------------------------------------------------
// GROUP MONTHLY — sourced from RefChargeSheet + RefChargeTier
// ------------------------------------------------------------

/**
 * Fetch the active charge sheet for a country, falling back to DEFAULT.
 * One query — both candidates fetched together, preference applied in JS.
 */
async function getSheet(countryCode: string): Promise<SheetRow | null> {
  const rows = await prisma.$queryRawUnsafe<SheetRow[]>(
    `SELECT "id", "countryCode", "currency"
     FROM "RefChargeSheet"
     WHERE "countryCode" IN ($1, $2) AND "isActive" = TRUE`,
    countryCode,
    FALLBACK_COUNTRY
  );
  const exact = rows.find((r) => r.countryCode === countryCode);
  return exact ?? rows.find((r) => r.countryCode === FALLBACK_COUNTRY) ?? null;
}

/**
 * Group monthly subscription price for a country + member count.
 * Tier match: minMembers <= count AND (maxMembers IS NULL OR maxMembers >= count)
 */
export async function resolveGroupMonthlyPrice(
  countryCode: string,
  memberCount: number
): Promise<ResolvedPrice> {
  const sheet = await getSheet(countryCode);
  if (!sheet) {
    throw new Error(
      `No charge sheet found for ${countryCode} and no DEFAULT sheet exists`
    );
  }

  const tiers = await prisma.$queryRawUnsafe<TierRow[]>(
    `SELECT "minMembers", "maxMembers", "monthlyFee"::text AS "monthlyFee"
     FROM "RefChargeTier"
     WHERE "sheetId" = $1
       AND "minMembers" <= $2
       AND ("maxMembers" IS NULL OR "maxMembers" >= $2)
     ORDER BY "minMembers" DESC
     LIMIT 1`,
    sheet.id,
    memberCount
  );

  if (tiers.length === 0) {
    throw new Error(
      `No charge tier matches ${memberCount} members for sheet ${sheet.countryCode}`
    );
  }

  return {
    currency: sheet.currency,
    amount: parseFloat(tiers[0].monthlyFee),
    countryCode: sheet.countryCode,
    tierMin: tiers[0].minMembers,
    tierMax: tiers[0].maxMembers,
  };
}

/**
 * Billable member count for tier resolution.
 * ACTIVE + SUSPENDED occupy seats; EXITED / BLACKLISTED / DEFAULTED do not.
 */
export async function getBillableMemberCount(groupId: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<Array<{ count: string }>>(
    `SELECT COUNT(*)::text AS "count"
     FROM "GroupMember"
     WHERE "groupId" = $1
       AND "status" IN ('ACTIVE'::"MemberStatus", 'SUSPENDED'::"MemberStatus")`,
    groupId
  );
  return parseInt(rows[0]?.count ?? '0', 10);
}
