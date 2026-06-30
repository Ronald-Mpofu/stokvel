// src/app/api/savings/contributions/route.ts — v2.2 raw SQL
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma/client'

async function sql(query: string, params: any[] = []) {
  return prisma.$queryRawUnsafe(query, ...params) as Promise<any[]>
}
async function exec(query: string, params: any[] = []) {
  return prisma.$executeRawUnsafe(query, ...params)
}

const paySchema = z.object({
  contributionId: z.string().uuid(),
  amountPaid:     z.coerce.number().positive(),
  paymentMethod:  z.string().default('ECOCASH'),
  paymentRef:     z.string().optional(),
})

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const poolId = searchParams.get('poolId')
    const userId = searchParams.get('userId')

    if (!poolId) return NextResponse.json({ success: false, error: 'poolId required' }, { status: 400 })

    let query = `
      SELECT sc.*, u."fullName" as "memberName", u.email as "memberEmail"
      FROM "SavingsContribution" sc
      JOIN "User" u ON u.id = sc."userId"
      WHERE sc."poolId" = $1`
    const params: any[] = [poolId]

    if (userId) { query += ` AND sc."userId" = $2`; params.push(userId) }
    query += ` ORDER BY sc."periodNumber" ASC, sc."userId" ASC`

    const contributions = await sql(query, params)
    const now = new Date()

    const mapped = contributions.map(c => ({
      id:            c.id,
      poolId:        c.poolId,
      userId:        c.userId,
      memberName:    c.memberName,
      memberEmail:   c.memberEmail,
      periodNumber:  Number(c.periodNumber),
      dueDate:       c.dueDate,
      amountDue:     Number(c.amountDue),
      amountPaid:    Number(c.amountPaid),
      currency:      c.currency,
      status:        c.status,
      paidAt:        c.paidAt,
      paymentMethod: c.paymentMethod,
      paymentRef:    c.paymentRef,
      isOverdue:     c.status !== 'PAID' && c.status !== 'WAIVED' && new Date(c.dueDate) < now,
    }))

    const stats = {
      total:          mapped.length,
      paid:           mapped.filter(c => c.status === 'PAID').length,
      pending:        mapped.filter(c => c.status === 'PENDING').length,
      late:           mapped.filter(c => c.isOverdue).length,
      totalCollected: mapped.filter(c => c.status === 'PAID').reduce((s,c) => s + c.amountPaid, 0),
      totalDue:       mapped.reduce((s,c) => s + c.amountDue, 0),
    }

    return NextResponse.json({ success: true, data: { contributions: mapped, stats } })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    // Mark all contributions in a period as paid
    if (body.action === 'MARK_PERIOD_COLLECTED') {
      const { poolId, periodNumber } = body
      await exec(
        `UPDATE "SavingsContribution" SET status='PAID',"paidAt"=NOW(),"amountPaid"="amountDue","updatedAt"=NOW()
         WHERE "poolId"=$1 AND "periodNumber"=$2 AND status != 'PAID'`,
        [poolId, periodNumber]
      )
      await recalcPoolTotals(poolId)
      return NextResponse.json({ success: true, message: `Period ${periodNumber} marked as collected` })
    }

    // Waive a contribution
    if (body.action === 'WAIVE') {
      await exec(
        `UPDATE "SavingsContribution" SET status='WAIVED',notes=$1,"updatedAt"=NOW() WHERE id=$2`,
        [body.notes || 'Waived by admin', body.contributionId]
      )
      return NextResponse.json({ success: true, message: 'Contribution waived' })
    }

    // Record payment
    const data = paySchema.parse(body)
    const contribs = await sql(`SELECT * FROM "SavingsContribution" WHERE id=$1`, [data.contributionId])
    if (!contribs.length) return NextResponse.json({ success: false, error: 'Contribution not found' }, { status: 404 })
    const contrib = contribs[0]

    const pools = await sql(`SELECT currency FROM "SavingsPool" WHERE id=$1`, [contrib.poolId])
    const currency = pools[0]?.currency || 'USD'

    const newPaid    = Number(contrib.amountPaid) + data.amountPaid
    const isFullPaid = newPaid >= Number(contrib.amountDue)

    await exec(
      `UPDATE "SavingsContribution" SET "amountPaid"=$1, status=$2, "paidAt"=$3, "paymentMethod"=$4, "paymentRef"=$5, "updatedAt"=NOW() WHERE id=$6`,
      [newPaid, isFullPaid ? 'PAID' : 'PARTIAL', isFullPaid ? new Date() : null,
       data.paymentMethod, data.paymentRef || null, data.contributionId]
    )

    // Create transaction record
    const txId = crypto.randomUUID()
    await exec(
      `INSERT INTO "Transaction" (id,type,status,amount,currency,description,reference,"paymentMethod","userId","createdAt")
       VALUES ($1,'CONTRIBUTION','COMPLETED',$2,$3,$4,$5,$6,$7,NOW())`,
      [txId, data.amountPaid, currency,
       `Savings pool contribution — Period #${contrib.periodNumber}`,
       data.paymentRef || `SAVE-${Date.now()}`,
       data.paymentMethod, contrib.userId]
    )

    await recalcPoolTotals(contrib.poolId)

    return NextResponse.json({
      success: true,
      message: isFullPaid ? `✅ Period #${contrib.periodNumber} paid in full` : 'Partial payment recorded',
    })
  } catch (e: any) {
    if (e instanceof z.ZodError) return NextResponse.json({ success: false, error: e.errors.map(x => x.message).join('; ') }, { status: 400 })
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}

async function recalcPoolTotals(poolId: string) {
  // Total contributions paid
  const paidResult = await sql(
    `SELECT COALESCE(SUM("amountPaid"),0) as total FROM "SavingsContribution" WHERE "poolId"=$1 AND status='PAID'`,
    [poolId]
  )
  const totalContrib = Number(paidResult[0]?.total || 0)

  // Total interest earned from loans
  const intResult = await sql(
    `SELECT COALESCE(SUM("totalInterestPaid"),0) as total FROM "SavingsLoan" WHERE "poolId"=$1`,
    [poolId]
  )
  const totalInterest = Number(intResult[0]?.total || 0)

  await exec(
    `UPDATE "SavingsPool" SET "totalContributed"=$1,"totalInterestEarned"=$2,"totalPoolValue"=$3,"updatedAt"=NOW() WHERE id=$4`,
    [totalContrib, totalInterest, totalContrib + totalInterest, poolId]
  )

  // Recalc each member's share
  if (totalContrib > 0) {
    const memberContribs = await sql(
      `SELECT "userId", COALESCE(SUM("amountPaid"),0) as total FROM "SavingsContribution"
       WHERE "poolId"=$1 AND status='PAID' GROUP BY "userId"`,
      [poolId]
    )
    for (const mc of memberContribs) {
      const share = Number(mc.total) / totalContrib * 100
      await exec(
        `UPDATE "SavingsPoolMember" SET "totalContributed"=$1,"sharePercentage"=$2,"updatedAt"=NOW()
         WHERE "poolId"=$3 AND "userId"=$4`,
        [Number(mc.total), share, poolId, mc.userId]
      )
    }
  }
}
