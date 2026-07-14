// src/app/api/investment/route.ts — v1.0
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { randomUUID } from 'crypto'
import prisma from '@/lib/prisma/client'
import { requireGroupManager } from '@/lib/auth'

async function sql(query: string, params: any[] = []) {
  return prisma.$queryRawUnsafe(query, ...params) as Promise<any[]>
}
async function exec(query: string, params: any[] = []) {
  return prisma.$executeRawUnsafe(query, ...params)
}

// ── Schemas ───────────────────────────────────────────────────
const clubSchema = z.object({
  groupId:               z.string().uuid(),
  name:                  z.string().min(2),
  description:           z.string().nullish().transform(v => v || null),
  contributionAmount:    z.coerce.number().positive(),
  contributionFrequency: z.enum(['WEEKLY','FORTNIGHTLY','MONTHLY']).default('MONTHLY'),
  loanLimitPct:          z.coerce.number().min(0.01).max(1).default(0.5),
  loanInterestRatePa:    z.coerce.number().min(0).max(1).default(0.18),
  lateContribPenaltyPct: z.coerce.number().min(0).max(0.5).default(0.05),
  adminId:               z.string().uuid().nullish().transform(v => v || null),
  treasurerId:           z.string().uuid().nullish().transform(v => v || null),
  secretaryId:           z.string().uuid().nullish().transform(v => v || null),
  notes:                 z.string().nullish().transform(v => v || null),
  memberIds:             z.array(z.string().uuid()).default([]),
})

// ── Helpers ───────────────────────────────────────────────────
function calcDueDate(start: Date, period: number, freq: string): Date {
  const d = new Date(start)
  if (freq === 'WEEKLY')           d.setDate(d.getDate() + (period - 1) * 7)
  else if (freq === 'FORTNIGHTLY') d.setDate(d.getDate() + (period - 1) * 14)
  else                             d.setMonth(d.getMonth() + (period - 1))
  return d
}

function calcMonthlyRepayment(principal: number, annualRate: number, months: number): number {
  if (annualRate === 0) return principal / months
  const r = annualRate / 12
  return (principal * r * Math.pow(1 + r, months)) / (Math.pow(1 + r, months) - 1)
}

function formatClub(c: any) {
  return {
    id:                    c.id,
    groupId:               c.groupId,
    groupName:             c.groupName,
    currency:              c.groupCurrency || c.currency || 'USD',
    name:                  c.name,
    description:           c.description,
    status:                c.status,
    contributionAmount:    Number(c.contributionAmount),
    contributionFrequency: c.contributionFrequency,
    loanLimitPct:          Number(c.loanLimitPct),
    loanLimitPctDisplay:   (Number(c.loanLimitPct) * 100).toFixed(0),
    loanInterestRatePa:    Number(c.loanInterestRatePa),
    loanInterestDisplay:   (Number(c.loanInterestRatePa) * 100).toFixed(1),
    lateContribPenaltyPct: Number(c.lateContribPenaltyPct),
    latePenaltyDisplay:    (Number(c.lateContribPenaltyPct) * 100).toFixed(1),
    adminId:               c.adminId,
    adminName:             c.adminName,
    treasurerId:           c.treasurerId,
    treasurerName:         c.treasurerName,
    secretaryId:           c.secretaryId,
    secretaryName:         c.secretaryName,
    totalFundValue:        Number(c.totalFundValue || 0),
    totalContributed:      Number(c.totalContributed || 0),
    totalLoaned:           Number(c.totalLoaned || 0),
    totalDisbursed:        Number(c.totalDisbursed || 0),
    availableToLoan:       Number(c.totalFundValue || 0) - Number(c.totalLoaned || 0),
    memberCount:           Number(c.memberCount || 0),
    notes:                 c.notes,
    createdAt:             c.createdAt,
    updatedAt:             c.updatedAt,
  }
}

// ── GET ───────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const groupId = searchParams.get('groupId')
    const clubId  = searchParams.get('clubId')

    if (clubId) {
      const clubs = await sql(`
        SELECT ic.*,
          g.name as "groupName", g.currency as "groupCurrency",
          a."fullName"  as "adminName",
          t."fullName"  as "treasurerName",
          s."fullName"  as "secretaryName",
          (SELECT COUNT(*) FROM "InvestmentMember" WHERE "clubId"=ic.id AND "isActive"=true) as "memberCount"
        FROM "InvestmentClub" ic
        JOIN "Group" g ON g.id = ic."groupId"
        LEFT JOIN "User" a ON a.id = ic."adminId"
        LEFT JOIN "User" t ON t.id = ic."treasurerId"
        LEFT JOIN "User" s ON s.id = ic."secretaryId"
        WHERE ic.id = $1`, [clubId])

      if (!clubs.length) return NextResponse.json({ success:false, error:'Club not found' }, { status:404 })
      const club = clubs[0]

      const [members, contributions, loans, disbursements] = await Promise.all([
        sql(`SELECT im.*, u."fullName", u.email, u.tier
             FROM "InvestmentMember" im
             JOIN "User" u ON u.id = im."userId"
             WHERE im."clubId"=$1 AND im."isActive"=true
             ORDER BY im."totalContributed" DESC`, [clubId]),
        sql(`SELECT ic2.*, u."fullName" as "memberName"
             FROM "InvestmentContribution" ic2
             JOIN "User" u ON u.id = ic2."userId"
             WHERE ic2."clubId"=$1
             ORDER BY ic2."periodNumber" ASC, ic2."userId" ASC`, [clubId]),
        sql(`SELECT il.*, u."fullName" as "borrowerName"
             FROM "InvestmentLoan" il
             JOIN "User" u ON u.id = il."borrowerId"
             WHERE il."clubId"=$1
             ORDER BY il."createdAt" DESC`, [clubId]),
        sql(`SELECT id2.*, u."fullName" as "memberName"
             FROM "InvestmentDisbursement" id2
             JOIN "User" u ON u.id = id2."userId"
             WHERE id2."clubId"=$1
             ORDER BY id2."createdAt" DESC`, [clubId]),
      ])

      const now = new Date()
      return NextResponse.json({ success:true, data: {
        ...formatClub(club),
        members: members.map(m => ({
          userId: m.userId, fullName: m.fullName, email: m.email, tier: m.tier,
          totalContributed: Number(m.totalContributed),
          loanBalance:      Number(m.loanBalance),
          maxLoanAllowed:   Number(m.totalContributed) * Number(club.loanLimitPct),
          availableToLoan:  Math.max(0, Number(m.totalContributed) * Number(club.loanLimitPct) - Number(m.loanBalance)),
          isActive:         m.isActive, joinedAt: m.joinedAt,
        })),
        contributions: contributions.map(c => ({
          id: c.id, userId: c.userId, memberName: c.memberName,
          periodNumber: Number(c.periodNumber), dueDate: c.dueDate,
          amountDue: Number(c.amountDue), loanRepaymentDue: Number(c.loanRepaymentDue),
          penaltyDue: Number(c.penaltyDue), totalDue: Number(c.totalDue),
          amountPaid: Number(c.amountPaid), status: c.status,
          penaltyApplied: Number(c.penaltyApplied), paidAt: c.paidAt,
          isOverdue: c.status !== 'PAID' && c.status !== 'WAIVED' && new Date(c.dueDate) < now,
        })),
        loans: loans.map(l => ({
          id: l.id, borrowerId: l.borrowerId, borrowerName: l.borrowerName,
          amount: Number(l.amount), outstandingBalance: Number(l.outstandingBalance),
          monthlyRepayment: Number(l.monthlyRepayment),
          interestDisplay: (Number(l.interestRatePa)*100).toFixed(1),
          termMonths: Number(l.termMonths), purpose: l.purpose,
          status: l.status, disbursedAt: l.disbursedAt, settledAt: l.settledAt,
          repaymentProgress: Number(l.amount) > 0
            ? Math.round((Number(l.amount)-Number(l.outstandingBalance))/Number(l.amount)*100) : 0,
        })),
        disbursements: disbursements.map(d => ({
          id: d.id, userId: d.userId, memberName: d.memberName,
          amount: Number(d.amount), balanceBefore: Number(d.balanceBefore),
          balanceAfter: Number(d.balanceAfter), reason: d.reason,
          status: d.status, approvedAt: d.approvedAt, paidAt: d.paidAt,
        })),
      }})
    }

    if (!groupId) return NextResponse.json({ success:false, error:'groupId required' }, { status:400 })

    const clubs = await sql(`
      SELECT ic.*,
        g.name as "groupName", g.currency as "groupCurrency",
        a."fullName" as "adminName",
        (SELECT COUNT(*) FROM "InvestmentMember" WHERE "clubId"=ic.id AND "isActive"=true) as "memberCount"
      FROM "InvestmentClub" ic
      JOIN "Group" g ON g.id = ic."groupId"
      LEFT JOIN "User" a ON a.id = ic."adminId"
      WHERE ic."groupId"=$1
      ORDER BY ic."createdAt" DESC`, [groupId])

    return NextResponse.json({ success:true, data: clubs.map(formatClub) })
  } catch (e: any) {
    console.error('GET /api/investment error:', e?.message)
    return NextResponse.json({ success:false, error:e.message }, { status:500 })
  }
}

// ── POST ──────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    // ── Group-manager guard (BR 4 & 6) ────────────────────────
    let guardGroupId: string | null = body.groupId || null
    if (!guardGroupId && body.clubId) {
      const r = await sql(`SELECT "groupId" FROM "InvestmentClub" WHERE id=$1`, [body.clubId])
      guardGroupId = r[0]?.groupId ?? null
    }
    const guardErr = await requireGroupManager(req, guardGroupId)
    if (guardErr) return guardErr

    if (body.action === 'ACTIVATE')             return handleActivate(body)
    if (body.action === 'ADD_MEMBER')           return handleAddMember(body)
    if (body.action === 'REMOVE_MEMBER')        return handleRemoveMember(body)
    if (body.action === 'PAY_CONTRIBUTION')     return handlePayContrib(body)
    if (body.action === 'WAIVE_CONTRIBUTION')   return handleWaiveContrib(body)
    if (body.action === 'APPLY_LATE_PENALTIES') return handleApplyPenalties(body)
    if (body.action === 'REQUEST_LOAN')         return handleRequestLoan(body)
    if (body.action === 'APPROVE_LOAN')         return handleApproveLoan(body)
    if (body.action === 'REJECT_LOAN')          return handleRejectLoan(body)
    if (body.action === 'DISBURSE_LOAN')        return handleDisburseLoan(body)
    if (body.action === 'REPAY_LOAN')           return handleRepayLoan(body)
    if (body.action === 'REQUEST_DISBURSEMENT') return handleRequestDisbursement(body)
    if (body.action === 'APPROVE_DISBURSEMENT') return handleApproveDisbursement(body)
    if (body.action === 'PAY_DISBURSEMENT')     return handlePayDisbursement(body)
    if (body.action === 'UPDATE_CLUB')          return handleUpdateClub(body)
    if (body.action === 'CLOSE')                return handleClose(body)

    // ── Create club ──────────────────────────────────────────
    const data = clubSchema.parse(body)
    const group = await prisma.group.findUnique({ where:{ id:data.groupId }, select:{ currency:true } })
    if (!group) return NextResponse.json({ success:false, error:'Group not found' }, { status:404 })

    const clubId = randomUUID()
    await exec(`
      INSERT INTO "InvestmentClub" (
        id,"groupId",name,description,status,currency,
        "contributionAmount","contributionFrequency",
        "loanLimitPct","loanInterestRatePa","lateContribPenaltyPct",
        "adminId","treasurerId","secretaryId",
        "totalFundValue","totalContributed","totalLoaned","totalDisbursed",
        notes,"createdAt","updatedAt"
      ) VALUES (
        $1,$2,$3,$4,'SETUP'::"InvestmentClubStatus",$5::"CurrencyCode",
        $6,$7,$8,$9,$10,$11,$12,$13,0,0,0,0,$14,NOW(),NOW()
      )`, [clubId, data.groupId, data.name, data.description, group.currency,
           data.contributionAmount, data.contributionFrequency,
           data.loanLimitPct, data.loanInterestRatePa, data.lateContribPenaltyPct,
           data.adminId, data.treasurerId, data.secretaryId, data.notes])

    for (const userId of data.memberIds) {
      const mId = randomUUID()
      await exec(`
        INSERT INTO "InvestmentMember" (id,"clubId","userId","totalContributed","loanBalance","isActive","createdAt","updatedAt")
        VALUES ($1,$2,$3,0,0,true,NOW(),NOW()) ON CONFLICT ("clubId","userId") DO NOTHING`,
        [mId, clubId, userId])
    }

    return NextResponse.json({
      success:true, data:{ id:clubId },
      message:`"${data.name}" investment club created. Add members and activate to begin contributions.`,
    }, { status:201 })

  } catch (e: any) {
    if (e instanceof z.ZodError) return NextResponse.json({ success:false, error:e.errors.map(x=>x.message).join('; ') }, { status:400 })
    console.error('POST /api/investment error:', e?.message, e?.stack)
    return NextResponse.json({ success:false, error: e?.message || 'Server error' }, { status:500 })
  }
}

// ── PUT — update club settings ────────────────────────────────
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json()
    const { clubId, ...fields } = body
    await exec(`
      UPDATE "InvestmentClub" SET
        name=$1, description=$2,
        "contributionAmount"=$3, "contributionFrequency"=$4,
        "loanLimitPct"=$5, "loanInterestRatePa"=$6, "lateContribPenaltyPct"=$7,
        "adminId"=$8, "treasurerId"=$9, "secretaryId"=$10, notes=$11,
        "updatedAt"=NOW() WHERE id=$12`,
      [fields.name, fields.description||null,
       fields.contributionAmount, fields.contributionFrequency,
       fields.loanLimitPct, fields.loanInterestRatePa, fields.lateContribPenaltyPct,
       fields.adminId||null, fields.treasurerId||null, fields.secretaryId||null,
       fields.notes||null, clubId])
    return NextResponse.json({ success:true, message:'Settings updated' })
  } catch (e: any) {
    return NextResponse.json({ success:false, error:e.message }, { status:500 })
  }
}

// ── Activate ──────────────────────────────────────────────────
async function handleActivate(body: any): Promise<NextResponse> {
  const { clubId } = body
  const clubs = await sql(`SELECT * FROM "InvestmentClub" WHERE id=$1`, [clubId])
  if (!clubs.length) return NextResponse.json({ success:false, error:'Club not found' }, { status:404 })
  const club = clubs[0]
  if (club.status !== 'SETUP') return NextResponse.json({ success:false, error:'Club already activated' }, { status:400 })

  const members = await sql(`SELECT * FROM "InvestmentMember" WHERE "clubId"=$1 AND "isActive"=true`, [clubId])
  if (!members.length) return NextResponse.json({ success:false, error:'Add at least one member first' }, { status:400 })

  // Generate first 3 months of contributions for each member
  const startDate = new Date()
  for (const m of members) {
    for (let p = 1; p <= 3; p++) {
      const due = calcDueDate(startDate, p, club.contributionFrequency)
      const cId = randomUUID()
      await exec(`
        INSERT INTO "InvestmentContribution" (id,"clubId","userId","periodNumber","dueDate",
          "amountDue","loanRepaymentDue","penaltyDue","totalDue","amountPaid",status,"createdAt","updatedAt")
        VALUES ($1,$2,$3,$4,$5,$6,0,0,$6,0,'PENDING'::"InvestmentContribStatus",NOW(),NOW())
        ON CONFLICT ("clubId","userId","periodNumber") DO NOTHING`,
        [cId, clubId, m.userId, p, due, club.contributionAmount])
    }
  }

  await exec(`UPDATE "InvestmentClub" SET status='ACTIVE'::"InvestmentClubStatus","updatedAt"=NOW() WHERE id=$1`, [clubId])
  return NextResponse.json({ success:true, message:`Club activated! ${members.length} members enrolled. Contribution schedule generated.` })
}

// ── Add / Remove member ───────────────────────────────────────
async function handleAddMember(body: any): Promise<NextResponse> {
  const { clubId, userId } = body
  const mId = randomUUID()
  await exec(`
    INSERT INTO "InvestmentMember" (id,"clubId","userId","totalContributed","loanBalance","isActive","createdAt","updatedAt")
    VALUES ($1,$2,$3,0,0,true,NOW(),NOW())
    ON CONFLICT ("clubId","userId") DO UPDATE SET "isActive"=true,"updatedAt"=NOW()`,
    [mId, clubId, userId])

  // Generate pending contributions from next period
  const clubs = await sql(`SELECT * FROM "InvestmentClub" WHERE id=$1`, [clubId])
  if (clubs[0]?.status === 'ACTIVE') {
    const club    = clubs[0]
    const maxPer  = await sql(`SELECT COALESCE(MAX("periodNumber"),0) as mx FROM "InvestmentContribution" WHERE "clubId"=$1`, [clubId])
    const nextPer = Number((maxPer[0] as any).mx) + 1
    const due     = calcDueDate(new Date(), nextPer, club.contributionFrequency)
    const cId     = randomUUID()
    await exec(`
      INSERT INTO "InvestmentContribution" (id,"clubId","userId","periodNumber","dueDate",
        "amountDue","loanRepaymentDue","penaltyDue","totalDue","amountPaid",status,"createdAt","updatedAt")
      VALUES ($1,$2,$3,$4,$5,$6,0,0,$6,0,'PENDING'::"InvestmentContribStatus",NOW(),NOW())
      ON CONFLICT ("clubId","userId","periodNumber") DO NOTHING`,
      [cId, clubId, userId, nextPer, due, club.contributionAmount])
  }

  const user = await prisma.user.findUnique({ where:{ id:userId }, select:{ fullName:true } })
  return NextResponse.json({ success:true, message:`${user?.fullName} added to investment club` })
}

async function handleRemoveMember(body: any): Promise<NextResponse> {
  const { clubId, userId } = body
  const loans = await sql(`SELECT id FROM "InvestmentLoan" WHERE "clubId"=$1 AND "borrowerId"=$2 AND status IN ('ACTIVE','APPROVED')`, [clubId, userId])
  if (loans.length) return NextResponse.json({ success:false, error:'Member has an active loan — settle it first' }, { status:400 })
  await exec(`UPDATE "InvestmentMember" SET "isActive"=false,"updatedAt"=NOW() WHERE "clubId"=$1 AND "userId"=$2`, [clubId, userId])
  return NextResponse.json({ success:true, message:'Member removed from club' })
}

// ── Contributions ─────────────────────────────────────────────
async function handlePayContrib(body: any): Promise<NextResponse> {
  const { contributionId, amountPaid, paymentMethod, paymentRef } = body
  const cs = await sql(`SELECT * FROM "InvestmentContribution" WHERE id=$1`, [contributionId])
  if (!cs.length) return NextResponse.json({ success:false, error:'Contribution not found' }, { status:404 })
  const c = cs[0]

  const newPaid  = Number(c.amountPaid) + Number(amountPaid)
  const isPaid   = newPaid >= Number(c.totalDue)

  await exec(`
    UPDATE "InvestmentContribution"
    SET "amountPaid"=$1, status=$2::"InvestmentContribStatus", "paidAt"=$3,
        "paymentMethod"=$4, "paymentRef"=$5, "updatedAt"=NOW()
    WHERE id=$6`,
    [newPaid, isPaid?'PAID':'PARTIAL', isPaid?new Date():null,
     paymentMethod||null, paymentRef||null, contributionId])

  await recalcFund(c.clubId)
  await recalcMemberContrib(c.clubId, c.userId)

  // Generate next period contribution
  if (isPaid) await generateNextContrib(c.clubId, c.userId, Number(c.periodNumber))

  return NextResponse.json({ success:true, message: isPaid ? `✅ Period #${c.periodNumber} paid in full` : 'Partial payment recorded' })
}

async function handleWaiveContrib(body: any): Promise<NextResponse> {
  const { contributionId, notes } = body
  await exec(`UPDATE "InvestmentContribution" SET status='WAIVED'::"InvestmentContribStatus",notes=$1,"updatedAt"=NOW() WHERE id=$2`,
    [notes||'Waived by admin', contributionId])
  return NextResponse.json({ success:true, message:'Contribution waived' })
}

async function handleApplyPenalties(body: any): Promise<NextResponse> {
  const { clubId } = body
  const clubs = await sql(`SELECT * FROM "InvestmentClub" WHERE id=$1`, [clubId])
  if (!clubs.length) return NextResponse.json({ success:false, error:'Club not found' }, { status:404 })
  const club = clubs[0]

  const now      = new Date()
  const overdue  = await sql(`
    SELECT * FROM "InvestmentContribution"
    WHERE "clubId"=$1 AND status IN ('PENDING','PARTIAL') AND "dueDate" < $2`,
    [clubId, now])

  let applied = 0
  for (const c of overdue) {
    const penalty = Number(c.totalDue) * Number(club.lateContribPenaltyPct)
    await exec(`
      UPDATE "InvestmentContribution"
      SET status='LATE'::"InvestmentContribStatus", "penaltyApplied"=$1,
          "penaltyDue"=$1, "totalDue"="amountDue"+"loanRepaymentDue"+$1, "updatedAt"=NOW()
      WHERE id=$2`, [penalty, c.id])
    applied++
  }

  return NextResponse.json({ success:true, message:`Penalties applied to ${applied} overdue contribution${applied!==1?'s':''}` })
}

// ── Loans ─────────────────────────────────────────────────────
async function handleRequestLoan(body: any): Promise<NextResponse> {
  const { clubId, borrowerId, amount, termMonths, purpose } = body
  const clubs = await sql(`SELECT * FROM "InvestmentClub" WHERE id=$1`, [clubId])
  if (!clubs.length) return NextResponse.json({ success:false, error:'Club not found' }, { status:404 })
  const club = clubs[0]

  if (club.status !== 'ACTIVE') return NextResponse.json({ success:false, error:'Club must be active to take loans' }, { status:400 })

  // Check member eligibility
  const members = await sql(`SELECT * FROM "InvestmentMember" WHERE "clubId"=$1 AND "userId"=$2 AND "isActive"=true`, [clubId, borrowerId])
  if (!members.length) return NextResponse.json({ success:false, error:'Only active club members can borrow' }, { status:400 })
  const member = members[0]

  const maxLoan = Number(member.totalContributed) * Number(club.loanLimitPct)
  const avail   = maxLoan - Number(member.loanBalance)
  if (Number(amount) > avail) {
    return NextResponse.json({ success:false,
      error:`Maximum loan available: $${avail.toFixed(2)} (${(Number(club.loanLimitPct)*100).toFixed(0)}% of $${Number(member.totalContributed).toFixed(2)} contributed, minus $${Number(member.loanBalance).toFixed(2)} outstanding)` },
      { status:400 })
  }

  // Check no active loan
  const existing = await sql(`SELECT id FROM "InvestmentLoan" WHERE "clubId"=$1 AND "borrowerId"=$2 AND status IN ('ACTIVE','APPROVED','PENDING_APPROVAL')`, [clubId, borrowerId])
  if (existing.length) return NextResponse.json({ success:false, error:'Member already has an active loan' }, { status:409 })

  const monthly    = calcMonthlyRepayment(Number(amount), Number(club.loanInterestRatePa), Number(termMonths))
  const totalInt   = (monthly * Number(termMonths)) - Number(amount)
  const loanId     = randomUUID()

  await exec(`
    INSERT INTO "InvestmentLoan" (id,"clubId","borrowerId",amount,"outstandingBalance",
      "interestRatePa","termMonths","monthlyRepayment","totalInterestDue","totalInterestPaid",
      purpose,status,"createdAt","updatedAt")
    VALUES ($1,$2,$3,$4,$4,$5,$6,$7,$8,0,$9,'PENDING_APPROVAL'::"InvestmentLoanStatus",NOW(),NOW())`,
    [loanId, clubId, borrowerId, amount, club.loanInterestRatePa,
     termMonths, monthly.toFixed(4), totalInt.toFixed(4), purpose||null])

  return NextResponse.json({ success:true, data:{ id:loanId },
    message:`Loan application submitted. Monthly repayment: $${monthly.toFixed(2)}. Awaiting approval.` },
    { status:201 })
}

async function handleApproveLoan(body: any): Promise<NextResponse> {
  const { loanId, approvedById } = body
  await exec(`UPDATE "InvestmentLoan" SET status='APPROVED'::"InvestmentLoanStatus","approvedById"=$1,"approvedAt"=NOW(),"updatedAt"=NOW() WHERE id=$2`,
    [approvedById||null, loanId])
  return NextResponse.json({ success:true, message:'Loan approved. Ready to disburse.' })
}

async function handleRejectLoan(body: any): Promise<NextResponse> {
  const { loanId, reason } = body
  await exec(`UPDATE "InvestmentLoan" SET status='REJECTED'::"InvestmentLoanStatus","rejectionReason"=$1,"updatedAt"=NOW() WHERE id=$2`,
    [reason||'Rejected by admin', loanId])
  return NextResponse.json({ success:true, message:'Loan rejected.' })
}

async function handleDisburseLoan(body: any): Promise<NextResponse> {
  const { loanId, paymentRef } = body
  const loans = await sql(`SELECT * FROM "InvestmentLoan" WHERE id=$1`, [loanId])
  if (!loans.length || loans[0].status !== 'APPROVED')
    return NextResponse.json({ success:false, error:'Loan must be approved first' }, { status:400 })
  const loan = loans[0]

  await exec(`UPDATE "InvestmentLoan" SET status='ACTIVE'::"InvestmentLoanStatus","disbursedAt"=NOW(),"updatedAt"=NOW() WHERE id=$1`, [loanId])

  // Update member loan balance
  await exec(`UPDATE "InvestmentMember" SET "loanBalance"="loanBalance"+$1,"updatedAt"=NOW() WHERE "clubId"=$2 AND "userId"=$3`,
    [loan.amount, loan.clubId, loan.borrowerId])

  // Update club total loaned
  await exec(`UPDATE "InvestmentClub" SET "totalLoaned"="totalLoaned"+$1,"totalFundValue"="totalFundValue"-$1,"updatedAt"=NOW() WHERE id=$2`,
    [loan.amount, loan.clubId])

  // Add loan repayment to future pending contributions
  const pending = await sql(`
    SELECT * FROM "InvestmentContribution"
    WHERE "clubId"=$1 AND "userId"=$2 AND status IN ('PENDING','PARTIAL')
    ORDER BY "periodNumber" ASC LIMIT $3`, [loan.clubId, loan.borrowerId, loan.termMonths])

  for (const c of pending) {
    await exec(`
      UPDATE "InvestmentContribution"
      SET "loanRepaymentDue"="loanRepaymentDue"+$1,
          "totalDue"="amountDue"+"loanRepaymentDue"+$1+"penaltyDue","updatedAt"=NOW()
      WHERE id=$2`, [loan.monthlyRepayment, c.id])
  }

  return NextResponse.json({ success:true, message:`$${Number(loan.amount).toFixed(2)} disbursed to member.` })
}

async function handleRepayLoan(body: any): Promise<NextResponse> {
  const { loanId, amountPaid, paymentRef } = body
  const loans = await sql(`SELECT * FROM "InvestmentLoan" WHERE id=$1`, [loanId])
  if (!loans.length) return NextResponse.json({ success:false, error:'Loan not found' }, { status:404 })
  const loan = loans[0]

  const newBal     = Math.max(0, Number(loan.outstandingBalance) - Number(amountPaid))
  const isSettled  = newBal <= 0
  const intPortion = Math.min(Number(amountPaid), Number(loan.monthlyRepayment) - (Number(loan.amount) / Number(loan.termMonths)))

  await exec(`
    UPDATE "InvestmentLoan"
    SET "outstandingBalance"=$1, "totalInterestPaid"="totalInterestPaid"+$2,
        status=$3::"InvestmentLoanStatus", "settledAt"=$4, "updatedAt"=NOW()
    WHERE id=$5`,
    [newBal, Math.max(0, intPortion), isSettled?'SETTLED':'ACTIVE',
     isSettled?new Date():null, loanId])

  // Update member loan balance
  await exec(`UPDATE "InvestmentMember" SET "loanBalance"=$1,"updatedAt"=NOW() WHERE "clubId"=$2 AND "userId"=$3`,
    [newBal, loan.clubId, loan.borrowerId])

  // Repayment goes back into fund
  await exec(`UPDATE "InvestmentClub" SET "totalFundValue"="totalFundValue"+$1,"totalLoaned"=GREATEST(0,"totalLoaned"-$1),"updatedAt"=NOW() WHERE id=$2`,
    [amountPaid, loan.clubId])

  return NextResponse.json({ success:true,
    message: isSettled ? '🎉 Loan fully repaid!' : `Payment recorded. Outstanding: $${newBal.toFixed(2)}` })
}

// ── Disbursements ─────────────────────────────────────────────
async function handleRequestDisbursement(body: any): Promise<NextResponse> {
  const { clubId, userId, amount, reason } = body
  const members = await sql(`SELECT * FROM "InvestmentMember" WHERE "clubId"=$1 AND "userId"=$2 AND "isActive"=true`, [clubId, userId])
  if (!members.length) return NextResponse.json({ success:false, error:'Member not found' }, { status:404 })
  const member = members[0]

  const available = Number(member.totalContributed) - Number(member.loanBalance)
  if (Number(amount) > available)
    return NextResponse.json({ success:false, error:`Maximum available to disburse: $${available.toFixed(2)}` }, { status:400 })

  const dId = randomUUID()
  await exec(`
    INSERT INTO "InvestmentDisbursement" (id,"clubId","userId",amount,"balanceBefore","balanceAfter",reason,status,"createdAt","updatedAt")
    VALUES ($1,$2,$3,$4,$5,$6,$7,'PENDING'::"DisbursementStatus",NOW(),NOW())`,
    [dId, clubId, userId, amount, member.totalContributed, available - Number(amount), reason||null])

  return NextResponse.json({ success:true, data:{ id:dId }, message:'Disbursement request submitted. Awaiting approval.' }, { status:201 })
}

async function handleApproveDisbursement(body: any): Promise<NextResponse> {
  const { disbursementId, approvedById } = body
  await exec(`UPDATE "InvestmentDisbursement" SET status='APPROVED'::"DisbursementStatus","approvedById"=$1,"approvedAt"=NOW(),"updatedAt"=NOW() WHERE id=$2`,
    [approvedById||null, disbursementId])
  return NextResponse.json({ success:true, message:'Disbursement approved. Ready to pay.' })
}

async function handlePayDisbursement(body: any): Promise<NextResponse> {
  const { disbursementId, paymentRef } = body
  const disbs = await sql(`SELECT * FROM "InvestmentDisbursement" WHERE id=$1`, [disbursementId])
  if (!disbs.length || disbs[0].status !== 'APPROVED')
    return NextResponse.json({ success:false, error:'Disbursement must be approved first' }, { status:400 })
  const d = disbs[0]

  await exec(`UPDATE "InvestmentDisbursement" SET status='PAID'::"DisbursementStatus","paidAt"=NOW(),"paymentRef"=$1,"updatedAt"=NOW() WHERE id=$2`,
    [paymentRef||null, disbursementId])

  // Deduct from member's contributed balance
  await exec(`UPDATE "InvestmentMember" SET "totalContributed"="totalContributed"-$1,"updatedAt"=NOW() WHERE "clubId"=$2 AND "userId"=$3`,
    [d.amount, d.clubId, d.userId])

  // Deduct from fund
  await exec(`UPDATE "InvestmentClub" SET "totalFundValue"="totalFundValue"-$1,"totalDisbursed"="totalDisbursed"+$1,"updatedAt"=NOW() WHERE id=$2`,
    [d.amount, d.clubId])

  return NextResponse.json({ success:true, message:`$${Number(d.amount).toFixed(2)} disbursed to member.` })
}

async function handleUpdateClub(body: any): Promise<NextResponse> {
  const { clubId, ...fields } = body
  await exec(`
    UPDATE "InvestmentClub" SET name=$1,description=$2,"adminId"=$3,"treasurerId"=$4,"secretaryId"=$5,notes=$6,"updatedAt"=NOW() WHERE id=$7`,
    [fields.name, fields.description||null, fields.adminId||null, fields.treasurerId||null, fields.secretaryId||null, fields.notes||null, clubId])
  return NextResponse.json({ success:true, message:'Club updated' })
}

async function handleClose(body: any): Promise<NextResponse> {
  const { clubId, notes } = body
  await exec(`UPDATE "InvestmentClub" SET status='CLOSED'::"InvestmentClubStatus",notes=$1,"updatedAt"=NOW() WHERE id=$2`, [notes||null, clubId])
  return NextResponse.json({ success:true, message:'Investment club closed' })
}

// ── Internal helpers ──────────────────────────────────────────
async function recalcFund(clubId: string) {
  const result = await sql(`SELECT COALESCE(SUM("amountPaid"),0) as total FROM "InvestmentContribution" WHERE "clubId"=$1 AND status='PAID'`, [clubId])
  await exec(`UPDATE "InvestmentClub" SET "totalContributed"=$1,"totalFundValue"=(SELECT COALESCE(SUM("amountPaid"),0) FROM "InvestmentContribution" WHERE "clubId"=$2 AND status='PAID'),"updatedAt"=NOW() WHERE id=$2`,
    [Number((result[0] as any).total), clubId])
}

async function recalcMemberContrib(clubId: string, userId: string) {
  const result = await sql(`SELECT COALESCE(SUM("amountPaid"),0) as total FROM "InvestmentContribution" WHERE "clubId"=$1 AND "userId"=$2 AND status='PAID'`, [clubId, userId])
  await exec(`UPDATE "InvestmentMember" SET "totalContributed"=$1,"updatedAt"=NOW() WHERE "clubId"=$2 AND "userId"=$3`,
    [Number((result[0] as any).total), clubId, userId])
}

async function generateNextContrib(clubId: string, userId: string, lastPeriod: number) {
  const clubs = await sql(`SELECT * FROM "InvestmentClub" WHERE id=$1`, [clubId])
  if (!clubs.length || clubs[0].status !== 'ACTIVE') return
  const club = clubs[0]

  // Get member's active loan repayment
  const loans = await sql(`SELECT "monthlyRepayment" FROM "InvestmentLoan" WHERE "clubId"=$1 AND "borrowerId"=$2 AND status='ACTIVE'`, [clubId, userId])
  const loanRepay = loans.length ? Number(loans[0].monthlyRepayment) : 0

  const nextPer = lastPeriod + 1
  const due     = calcDueDate(new Date(), nextPer, club.contributionFrequency)
  const total   = Number(club.contributionAmount) + loanRepay
  const cId     = randomUUID()

  await exec(`
    INSERT INTO "InvestmentContribution" (id,"clubId","userId","periodNumber","dueDate",
      "amountDue","loanRepaymentDue","penaltyDue","totalDue","amountPaid",status,"createdAt","updatedAt")
    VALUES ($1,$2,$3,$4,$5,$6,$7,0,$8,0,'PENDING'::"InvestmentContribStatus",NOW(),NOW())
    ON CONFLICT ("clubId","userId","periodNumber") DO NOTHING`,
    [cId, clubId, userId, nextPer, due, club.contributionAmount, loanRepay, total])
}

export const dynamic = 'force-dynamic'

// ── Delete investment club (temporary hard-delete — remove before go-live) ──
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const clubId = searchParams.get('clubId')
    if (!clubId) return NextResponse.json({ success: false, error: 'clubId required' }, { status: 400 })

    // ── Group-manager guard ────────────────────────────────────
    const gr = await sql(`SELECT "groupId" FROM "InvestmentClub" WHERE id=$1`, [clubId])
    const guardErr = await requireGroupManager(req, gr[0]?.groupId ?? null)
    if (guardErr) return guardErr

    const rows = await sql(`SELECT id, name FROM "InvestmentClub" WHERE id=$1`, [clubId])
    if (!rows.length) return NextResponse.json({ success: false, error: 'Investment club not found' }, { status: 404 })
    const name = rows[0].name
    try { await exec(`DELETE FROM "InvestmentDisbursement" WHERE "clubId"=$1`, [clubId]) } catch {}
    try { await exec(`DELETE FROM "InvestmentLoan"         WHERE "clubId"=$1`, [clubId]) } catch {}
    try { await exec(`DELETE FROM "InvestmentContribution" WHERE "clubId"=$1`, [clubId]) } catch {}
    try { await exec(`DELETE FROM "InvestmentMember"       WHERE "clubId"=$1`, [clubId]) } catch {}
    await exec(`DELETE FROM "InvestmentClub" WHERE id=$1`, [clubId])
    return NextResponse.json({ success: true, message: `"${name}" has been permanently deleted.` })
  } catch (e: any) {
    console.error('DELETE /api/investment error:', e)
    return NextResponse.json({ success: false, error: e.message }, { status: 500 })
  }
}
