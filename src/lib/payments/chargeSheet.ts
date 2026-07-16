// ============================================================
// src/lib/payments/chargeSheet.ts
// Resolves per-country pricing from RefChargeSheet / RefChargeTier.
// These tables are NOT in schema.prisma — raw SQL only.
// ============================================================

import { prisma } from '@/lib/prisma/client';
import type { ResolvedPrice } from './types';

const FALLBACK_COUNTRY = 'DEFAULT';

interface SheetRow {
  id: string;
  countryCode: string;
  currency: string;
  memberAnnualFee: string; // Decimal comes back as string from raw SQL
}

interface TierRow {
  minMembers: number;
  maxMembers: number | null;
  monthlyFee: string;
}

/**
 * Fetch the active charge sheet for a country, falling back to DEFAULT.
 * Single query — both candidate rows fetched at once, preferred one picked in JS.
 */
async function getSheet(countryCode: string): Promise<SheetRow | null> {
  const rows = await prisma.$queryRawUnsafe<SheetRow[]>(
    `SELECT "id", "countryCode", "currency", "memberAnnualFee"::text AS "memberAnnualFee"
     FROM "RefChargeSheet"
     WHERE "countryCode" IN ($1, $2) AND "isActive" = TRUE`,
    countryCode,
    FALLBACK_COUNTRY
  );
  const exact = rows.find((r) => r.countryCode === countryCode);
  return exact ?? rows.find((r) => r.countryCode === FALLBACK_COUNTRY) ?? null;
}

/**
 * Member annual subscription price for a country.
 */
export async function resolveMemberAnnualPrice(
  countryCode: string
): Promise<ResolvedPrice> {
  const sheet = await getSheet(countryCode);
  if (!sheet) {
    throw new Error(`No charge sheet found for ${countryCode} and no DEFAULT sheet exists`);
  }
  return {
    currency: sheet.currency,
    amount: parseFloat(sheet.memberAnnualFee),
    countryCode: sheet.countryCode,
  };
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
    throw new Error(`No charge sheet found for ${countryCode} and no DEFAULT sheet exists`);
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

  const tier = tiers[0];
  return {
    currency: sheet.currency,
    amount: parseFloat(tier.monthlyFee),
    countryCode: sheet.countryCode,
    tierMin: tier.minMembers,
    tierMax: tier.maxMembers,
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
