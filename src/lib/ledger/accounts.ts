// src/lib/ledger/accounts.ts
//
// Chart of accounts, seeded per group.
//
// WHY THIS EXISTS
//   LedgerAccount and LedgerEntry have been in schema.prisma since the
//   beginning but have never held a row — LedgerEntry requires an
//   accountId, and with no accounts there was nothing to post to. This
//   module creates the accounts so the double-entry side can finally run.
//
// WHY THE ACCOUNTS ARE SHAPED THIS WAY
//   A stokvel is not a trading business, and getting this wrong makes
//   every report wrong. Member contributions are NOT income: the group
//   owes that money back to its members, so contributions credit a
//   LIABILITY (Member Funds), not an income account. Only interest,
//   penalties and rental genuinely belong to the group as income.
//
// PLATFORM REVENUE IS OUT OF SCOPE
//   Joining fees and subscriptions are Windfall's revenue, not the
//   group's. They must never appear in a group's books. Those 17 FEE
//   transactions belong to a separate platform-level ledger.

import prisma from '@/lib/prisma/client'

export type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE'

export interface AccountSeed {
  code: string
  name: string
  type: AccountType
  description: string
}

// Codes follow the conventional ranges: 1xxx assets, 2xxx liabilities,
// 3xxx equity, 4xxx income, 5xxx expenses.
export const CHART_OF_ACCOUNTS: AccountSeed[] = [
  // ── Assets ────────────────────────────────────────────────
  { code: '1000', name: 'Contributions Receivable', type: 'ASSET',
    description: 'Contributions invoiced to members but not yet confirmed as paid' },
  { code: '1100', name: 'Group Bank Account', type: 'ASSET',
    description: 'Funds held in the group\u2019s own bank or mobile wallet account' },
  { code: '1200', name: 'Loans Receivable', type: 'ASSET',
    description: 'Principal advanced to members and not yet repaid' },
  { code: '1300', name: 'Interest Receivable', type: 'ASSET',
    description: 'Loan interest accrued but not yet received' },

  // ── Liabilities ───────────────────────────────────────────
  // Member Funds is the account most systems get wrong. Contributions
  // are money the group HOLDS FOR members, not money it has earned.
  { code: '2000', name: 'Member Funds', type: 'LIABILITY',
    description: 'Contributions held on behalf of members and repayable to them' },
  { code: '2100', name: 'Payouts Payable', type: 'LIABILITY',
    description: 'Payouts due to members and not yet settled' },
  { code: '2200', name: 'Insurance Pool', type: 'LIABILITY',
    description: 'Ring-fenced reserve against member default' },
  { code: '2300', name: 'Maintenance Reserve', type: 'LIABILITY',
    description: 'Reserve held against asset and property upkeep' },

  // ── Equity ────────────────────────────────────────────────
  { code: '3000', name: 'Accumulated Surplus', type: 'EQUITY',
    description: 'Retained surplus from interest, penalties and income' },

  // ── Income ────────────────────────────────────────────────
  { code: '4000', name: 'Loan Interest Income', type: 'INCOME',
    description: 'Interest earned on loans advanced to members' },
  { code: '4100', name: 'Penalty Income', type: 'INCOME',
    description: 'Late-payment penalties levied under the group constitution' },
  { code: '4200', name: 'Rental Income', type: 'INCOME',
    description: 'Rental received on group-owned property and assets' },
  { code: '4300', name: 'Investment Income', type: 'INCOME',
    description: 'Dividends, distributions and realised gains' },

  // ── Expenses ──────────────────────────────────────────────
  { code: '5000', name: 'Bank Charges', type: 'EXPENSE',
    description: 'Transfer fees and account charges' },
  { code: '5100', name: 'Maintenance & Repairs', type: 'EXPENSE',
    description: 'Upkeep of group-owned assets and property' },
  { code: '5200', name: 'Insurance Premiums', type: 'EXPENSE',
    description: 'Premiums paid on group-owned assets' },
  { code: '5300', name: 'Bad Debts Written Off', type: 'EXPENSE',
    description: 'Member obligations judged irrecoverable' },
]

/**
 * Ensures a group has its chart of accounts, and returns code -> id.
 *
 * Seeded LAZILY on first use rather than at group creation, so existing
 * groups pick the accounts up without a backfill script.
 *
 * createMany with skipDuplicates leans on @@unique([groupId, code]) in
 * schema.prisma, which makes this idempotent AND safe under concurrency:
 * two simultaneous activations cannot produce duplicate accounts.
 */
export async function ensureChartOfAccounts(groupId: string): Promise<Map<string, string>> {
  const existing = await prisma.ledgerAccount.findMany({
    where:  { groupId },
    select: { id: true, code: true },
  })

  if (existing.length < CHART_OF_ACCOUNTS.length) {
    await prisma.ledgerAccount.createMany({
      data: CHART_OF_ACCOUNTS.map(a => ({
        groupId,
        code:        a.code,
        name:        a.name,
        type:        a.type,
        description: a.description,
        isActive:    true,
      })),
      skipDuplicates: true,
    })

    const refreshed = await prisma.ledgerAccount.findMany({
      where:  { groupId },
      select: { id: true, code: true },
    })
    return new Map(refreshed.map(a => [a.code, a.id]))
  }

  return new Map(existing.map(a => [a.code, a.id]))
}

/** Account codes referenced by posting logic, named rather than inlined. */
export const ACC = {
  CONTRIBUTIONS_RECEIVABLE: '1000',
  GROUP_BANK:               '1100',
  LOANS_RECEIVABLE:         '1200',
  INTEREST_RECEIVABLE:      '1300',
  MEMBER_FUNDS:             '2000',
  PAYOUTS_PAYABLE:          '2100',
  INSURANCE_POOL:           '2200',
  MAINTENANCE_RESERVE:      '2300',
  ACCUMULATED_SURPLUS:      '3000',
  LOAN_INTEREST_INCOME:     '4000',
  PENALTY_INCOME:           '4100',
  RENTAL_INCOME:            '4200',
  INVESTMENT_INCOME:        '4300',
  BANK_CHARGES:             '5000',
  MAINTENANCE_EXPENSE:      '5100',
  INSURANCE_EXPENSE:        '5200',
  BAD_DEBTS:                '5300',
} as const

/** Reporting period label for LedgerEntry.period, e.g. "2026-08". */
export function periodOf(d: Date | string): string {
  const dt = new Date(d)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`
}
