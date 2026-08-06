// src/lib/ledger/generate.ts
//
// Invoice generation. Turns a scheme's obligation schedule into
// LedgerInvoice rows, one per contribution due.
//
// THE ROTATING-POOL CASE IS WHY THIS EXISTS
//   In a rotating pool, member A does not pay "the group" — A pays
//   whichever member holds that cycle's position, directly. So the
//   payee differs per cycle, and an invoice must name a PERSON. That is
//   the whole reason LedgerInvoice carries payeeType/payeeId rather
//   than assuming the group is always the counterparty.
//
// GENERATED UP FRONT, NOT CYCLE BY CYCLE
//   At activation the full rotation is known, so every invoice for every
//   cycle is written at once. A member sees their entire obligation
//   schedule from day one — twelve invoices naming twelve different
//   payees — which is exactly what a physical stokvel passbook shows.
//
// IDEMPOTENT
//   The partial unique index on (sourceType, sourceId) means a retried
//   activation cannot double-bill anyone. Generation can be re-run.

import { randomUUID } from 'crypto'
import prisma from '@/lib/prisma/client'
import { ensureChartOfAccounts } from './accounts'

async function sql(query: string, params: any[] = []) {
  return prisma.$queryRawUnsafe(query, ...params) as Promise<any[]>
}
async function exec(query: string, params: any[] = []) {
  return prisma.$executeRawUnsafe(query, ...params)
}

export interface GenerateResult {
  generated: number
  skipped: number
  errors: string[]
}

/**
 * Allocates the next invoice number for a group.
 * Uses the next_ledger_number() function, which is atomic — MAX(seq)+1
 * would race under concurrent activation and issue duplicate numbers.
 */
async function nextInvoiceNumber(groupId: string, prefix: string): Promise<{ seq: number; formatted: string }> {
  const rows = await sql(`SELECT * FROM next_ledger_number($1, 'INVOICE', $2)`, [groupId, prefix])
  const r = rows[0]
  if (!r) throw new Error('Could not allocate an invoice number')
  return { seq: Number(r.seq), formatted: String(r.formatted) }
}

/**
 * Generates invoices for every contribution in an activated savings pool.
 *
 * Called after handleActivate has written SavingsContribution rows and,
 * for rotating pools, SavingsRotationPayout positions. Both must already
 * exist: the schedule supplies the due dates, the rotation supplies the
 * payee for each cycle.
 */
export async function generateInvoicesForPool(poolId: string, createdById?: string | null): Promise<GenerateResult> {
  const result: GenerateResult = { generated: 0, skipped: 0, errors: [] }

  const pools = await sql(
    `SELECT sp.id, sp."groupId", sp.name, sp.currency, sp."poolType",
            sp."contributionFrequency", g.name AS "groupName"
       FROM "SavingsPool" sp
       JOIN "Group" g ON g.id = sp."groupId"
      WHERE sp.id = $1 LIMIT 1`,
    [poolId],
  )
  if (!pools.length) {
    result.errors.push('Pool not found')
    return result
  }
  const pool       = pools[0]
  const isRotating = (pool.poolType || 'MATURITY') === 'ROTATING'

  // Accounts are not used by invoice rows themselves, but seeding here
  // means the chart exists before any payment is confirmed and posted.
  await ensureChartOfAccounts(pool.groupId)

  const settingsRows = await sql(
    `SELECT "invoicePrefix" FROM "LedgerSettings" WHERE "groupId" = $1 LIMIT 1`,
    [pool.groupId],
  )
  const prefix = settingsRows[0]?.invoicePrefix || 'INV'

  // Contributions already scheduled, with any existing invoice detected
  // in the same pass so nothing is billed twice.
  const dues = await sql(
    `SELECT sc.id, sc."userId", sc."periodNumber", sc."dueDate", sc."amountDue",
            u."fullName" AS "payerName",
            EXISTS (
              SELECT 1 FROM "LedgerInvoice" li
               WHERE li."sourceType" = 'SAVINGS_CONTRIBUTION'
                 AND li."sourceId"   = sc.id
                 AND li.status <> 'CANCELLED'
            ) AS "alreadyInvoiced"
       FROM "SavingsContribution" sc
       JOIN "User" u ON u.id = sc."userId"
      WHERE sc."poolId" = $1
      ORDER BY sc."periodNumber" ASC, u."fullName" ASC`,
    [poolId],
  )
  if (!dues.length) return result

  // Rotation positions: cycle number -> recipient. Absent for maturity
  // pools, where the payee is the group itself.
  const rotation = isRotating
    ? await sql(
        `SELECT srp.position, srp."userId", u."fullName"
           FROM "SavingsRotationPayout" srp
           JOIN "User" u ON u.id = srp."userId"
          WHERE srp."poolId" = $1
          ORDER BY srp.position ASC`,
        [poolId],
      )
    : []
  const payeeByCycle = new Map<number, { userId: string; fullName: string }>(
    rotation.map((r: any) => [Number(r.position), { userId: r.userId, fullName: r.fullName }]),
  )

  const cadence = pool.contributionFrequency === 'WEEKLY' ? 'Week'
    : pool.contributionFrequency === 'FORTNIGHTLY' ? 'Fortnight' : 'Month'

  for (const d of dues) {
    if (d.alreadyInvoiced) { result.skipped++; continue }

    // THE RECIPIENT STILL CONTRIBUTES. Confirmed as this group's rule,
    // and it is what makes the arithmetic hold: the pot is calculated as
    // contribution x ALL members, so if the cycle's recipient were exempt
    // the pot would be short by exactly one share.
    //
    // Their invoice is therefore raised like everyone else's, with
    // themselves as payee. It is a self-obligation that nets to no cash
    // movement — they retain their own share out of the pot rather than
    // transferring it and receiving it back. It is billed rather than
    // skipped so that every member's passbook shows a complete
    // contribution history with no unexplained gaps.
    const payee = isRotating ? payeeByCycle.get(Number(d.periodNumber)) : null
    if (isRotating && !payee) {
      result.errors.push(`No rotation position for cycle ${d.periodNumber}`)
      continue
    }
    const isSelfContribution = isRotating && payee!.userId === d.userId

    try {
      const num = await nextInvoiceNumber(pool.groupId, prefix)
      const description = !isRotating
        ? `${pool.name} — ${cadence} ${d.periodNumber} contribution`
        : isSelfContribution
          ? `${pool.name} — ${cadence} ${d.periodNumber} contribution (your payout cycle — retained from your pot)`
          : `${pool.name} — ${cadence} ${d.periodNumber} contribution to ${payee!.fullName}`

      const invoiceId = randomUUID()

      await exec(
        `INSERT INTO "LedgerInvoice" (
           id, "groupId", "schemeId", "invoiceNumber", "invoiceSeq",
           "sourceType", "sourceId", "payerType", "payerId",
           "payeeType", "payeeId", currency, subtotal, total,
           status, "dueDate", "periodLabel", "periodNumber",
           description, "createdById"
         ) VALUES (
           $1,$2,NULL,$3,$4,'SAVINGS_CONTRIBUTION',$5,'MEMBER',$6,
           $7,$8,$9,$10,$10,'ISSUED',$11,$12,$13,$14,$15
         )`,
        [
          invoiceId, pool.groupId, num.formatted, num.seq,
          d.id, d.userId,
          isRotating ? 'MEMBER' : 'GROUP',
          isRotating ? payee!.userId : null,
          pool.currency, Number(d.amountDue),
          new Date(d.dueDate),
          `${cadence} ${d.periodNumber}`, Number(d.periodNumber),
          description, createdById || null,
        ],
      )

      await exec(
        `INSERT INTO "LedgerInvoiceLine"
           (id, "invoiceId", description, quantity, "unitAmount", "lineTotal", "sortOrder")
         VALUES ($1,$2,$3,1,$4,$4,0)`,
        [randomUUID(), invoiceId, description, Number(d.amountDue)],
      )

      result.generated++
    } catch (e: any) {
      // A duplicate here means the unique index caught a concurrent
      // generation — that is the index doing its job, not a failure.
      if (String(e?.message || '').includes('idx_ledgerinvoice_source')) {
        result.skipped++
      } else {
        result.errors.push(`Cycle ${d.periodNumber} for ${d.payerName}: ${e?.message || 'failed'}`)
      }
    }
  }

  return result
}

/**
 * Marks issued invoices overdue once their due date has passed.
 * Intended for the daily cron sweep; safe to run repeatedly.
 */
export async function markOverdueInvoices(): Promise<number> {
  return exec(
    `UPDATE "LedgerInvoice"
        SET status = 'OVERDUE', "updatedAt" = CURRENT_TIMESTAMP
      WHERE status IN ('ISSUED','PART_PAID')
        AND "dueDate" < CURRENT_TIMESTAMP`,
  ) as unknown as number
}
