// src/app/api/grocery/route.ts — v1.0
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma/client'

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
  periodMonths:          z.coerce.number().int().min(1).max(24).default(3),
  contributionFrequency: z.enum(['WEEKLY','FORTNIGHTLY','MONTHLY']).default('MONTHLY'),
  startDate:             z.string(),
  coordinatorId:         z.string().uuid().nullish().transform(v => v || null),
  notes:                 z.string().nullish().transform(v => v || null),
  memberIds:             z.array(z.string().uuid()).default([]),
})

const itemSchema = z.object({
  clubId:              z.string().uuid(),
  name:                z.string().min(1),
  description:         z.string().nullish().transform(v => v || null),
  unit:                z.string().default('units'),
  qtyPerMember:        z.coerce.number().positive().default(1),
  estimatedUnitPrice:  z.coerce.number().min(0),
  supplierName:        z.string().nullish().transform(v => v || null),
  supplierContact:     z.string().nullish().transform(v => v || null),
  notes:               z.string().nullish().transform(v => v || null),
})

function calcPeriodCount(months: number, freq: string): number {
  if (freq === 'WEEKLY')      return Math.ceil(months * 4.33)
  if (freq === 'FORTNIGHTLY') return Math.ceil(months * 2.17)
  return months
}

function calcDueDate(start: Date, p: number, freq: string): Date {
  const d = new Date(start)
  if (freq === 'WEEKLY')           d.setDate(d.getDate() + (p-1)*7)
  else if (freq === 'FORTNIGHTLY') d.setDate(d.getDate() + (p-1)*14)
  else                             d.setMonth(d.getMonth() + (p-1))
  return d
}

// ── GET ───────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const groupId = searchParams.get('groupId')
    const clubId  = searchParams.get('clubId')

    if (clubId) {
      const clubs = await sql(
        `SELECT gc.*, g.name as "groupName", g.currency as "groupCurrency",
          u."fullName" as "coordinatorName"
         FROM "GroceryClub" gc
         JOIN "Group" g ON g.id = gc."groupId"
         LEFT JOIN "User" u ON u.id = gc."coordinatorId"
         WHERE gc.id = $1`, [clubId]
      )
      if (!clubs.length) return NextResponse.json({ success:false, error:'Club not found' }, { status:404 })
      const club = clubs[0]

      const [items, members, contribs] = await Promise.all([
        sql(`SELECT gi.*, u."fullName" as "assignedToName", pu."fullName" as "purchasedByName"
             FROM "GroceryItem" gi
             LEFT JOIN "User" u ON u.id = gi."assignedToId"
             LEFT JOIN "User" pu ON pu.id = gi."purchasedById"
             WHERE gi."clubId" = $1 ORDER BY gi."createdAt" ASC`, [clubId]),
        sql(`SELECT gm.*, u."fullName", u.email, u.tier
             FROM "GroceryMember" gm
             JOIN "User" u ON u.id = gm."userId"
             WHERE gm."clubId" = $1 AND gm."isActive" = true
             ORDER BY u."fullName" ASC`, [clubId]),
        sql(`SELECT gc2.*, u."fullName" as "memberName"
             FROM "GroceryContribution" gc2
             JOIN "User" u ON u.id = gc2."userId"
             WHERE gc2."clubId" = $1
             ORDER BY gc2."periodNumber" ASC, gc2."userId" ASC`, [clubId]),
      ])

      const now = new Date()
      return NextResponse.json({ success:true, data: {
        ...formatClub(club),
        items:   items.map(formatItem),
        members: members.map(m => ({
          userId: m.userId, fullName: m.fullName, email: m.email, tier: m.tier,
          totalContributed: Number(m.totalContributed), sharePercentage: Number(m.sharePercentage),
          isActive: m.isActive, joinedAt: m.joinedAt,
        })),
        contributions: contribs.map(c => ({
          id: c.id, userId: c.userId, memberName: c.memberName,
          periodNumber: Number(c.periodNumber), dueDate: c.dueDate,
          amountDue: Number(c.amountDue), amountPaid: Number(c.amountPaid),
          status: c.status, paidAt: c.paidAt,
          isOverdue: c.status !== 'PAID' && c.status !== 'WAIVED' && new Date(c.dueDate) < now,
        })),
      }})
    }

    if (!groupId) return NextResponse.json({ success:false, error:'groupId required' }, { status:400 })

    const clubs = await sql(
      `SELECT gc.*, g.name as "groupName", g.currency as "groupCurrency",
        u."fullName" as "coordinatorName",
        (SELECT COUNT(*) FROM "GroceryMember" WHERE "clubId"=gc.id AND "isActive"=true) as "memberCount",
        (SELECT COUNT(*) FROM "GroceryItem" WHERE "clubId"=gc.id) as "itemCount",
        (SELECT COUNT(*) FROM "GroceryItem" WHERE "clubId"=gc.id AND status='PURCHASED') as "purchasedCount"
       FROM "GroceryClub" gc
       JOIN "Group" g ON g.id = gc."groupId"
       LEFT JOIN "User" u ON u.id = gc."coordinatorId"
       WHERE gc."groupId" = $1
       ORDER BY gc."createdAt" DESC`, [groupId]
    )

    return NextResponse.json({ success:true, data: clubs.map(formatClub) })
  } catch (e: any) {
    console.error('GET /api/grocery error:', e)
    return NextResponse.json({ success:false, error:e.message }, { status:500 })
  }
}

// ── POST ──────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    if (body.action === 'ACTIVATE')          return handleActivate(body)
    if (body.action === 'ADD_MEMBER')        return handleAddMember(body)
    if (body.action === 'REMOVE_MEMBER')     return handleRemoveMember(body)
    if (body.action === 'ADD_ITEM')          return handleAddItem(body)
    if (body.action === 'UPDATE_ITEM')       return handleUpdateItem(body)
    if (body.action === 'DELETE_ITEM')       return handleDeleteItem(body)
    if (body.action === 'ASSIGN_ITEM')       return handleAssignItem(body)
    if (body.action === 'MARK_PURCHASED')    return handleMarkPurchased(body)
    if (body.action === 'MARK_DISTRIBUTED')  return handleMarkDistributed(body)
    if (body.action === 'PAY_CONTRIBUTION')  return handlePayContrib(body)
    if (body.action === 'WAIVE_CONTRIBUTION') return handleWaiveContrib(body)
    if (body.action === 'MARK_PERIOD_PAID')  return handleMarkPeriodPaid(body)
    if (body.action === 'UPDATE_CLUB')       return handleUpdateClub(body)
    if (body.action === 'CLOSE')             return handleClose(body)

    // Create club
    const data = clubSchema.parse(body)
    const group = await prisma.group.findUnique({ where:{ id:data.groupId }, select:{ currency:true } })
    if (!group) return NextResponse.json({ success:false, error:'Group not found' }, { status:404 })

    const startDate = new Date(data.startDate)
    const endDate   = new Date(startDate)
    endDate.setMonth(endDate.getMonth() + data.periodMonths)
    const clubId = crypto.randomUUID()

    await exec(
      `INSERT INTO "GroceryClub" (id,"groupId",name,description,"periodMonths","contributionFrequency",
        "contributionAmount","startDate","endDate",status,currency,"totalBudget","totalContributed",
        "totalSpent","coordinatorId",notes,"createdAt","updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,0,$7,$8,'SETUP'::"GroceryClubStatus",$9::"CurrencyCode",0,0,0,$10,$11,NOW(),NOW())`,
      [clubId, data.groupId, data.name, data.description, data.periodMonths,
       data.contributionFrequency, startDate, endDate, group.currency,
       data.coordinatorId, data.notes]
    )

    for (const userId of data.memberIds) {
      const mId = crypto.randomUUID()
      await exec(
        `INSERT INTO "GroceryMember" (id,"clubId","userId","totalContributed","sharePercentage","isActive","createdAt","updatedAt")
         VALUES ($1,$2,$3,0,0,true,NOW(),NOW()) ON CONFLICT ("clubId","userId") DO NOTHING`,
        [mId, clubId, userId]
      )
    }

    return NextResponse.json({
      success:true, data:{ id:clubId },
      message:`"${data.name}" grocery club created. Add items to build your grocery list.`,
    }, { status:201 })

  } catch (e: any) {
    if (e instanceof z.ZodError) return NextResponse.json({ success:false, error:e.errors.map(x=>x.message).join('; ') }, { status:400 })
    console.error('POST /api/grocery error:', e)
    return NextResponse.json({ success:false, error:e.message }, { status:500 })
  }
}

// ── PUT — update club ─────────────────────────────────────────
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json()
    const { clubId, ...fields } = body
    if (!clubId) return NextResponse.json({ success:false, error:'clubId required' }, { status:400 })
    await exec(
      `UPDATE "GroceryClub" SET name=$1, description=$2, "coordinatorId"=$3, notes=$4, "updatedAt"=NOW() WHERE id=$5`,
      [fields.name, fields.description||null, fields.coordinatorId||null, fields.notes||null, clubId]
    )
    return NextResponse.json({ success:true, message:'Club updated' })
  } catch (e: any) {
    return NextResponse.json({ success:false, error:e.message }, { status:500 })
  }
}

// ── DELETE — delete item ──────────────────────────────────────
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const itemId = searchParams.get('itemId')
    if (!itemId) return NextResponse.json({ success:false, error:'itemId required' }, { status:400 })
    await exec(`DELETE FROM "GroceryItem" WHERE id=$1`, [itemId])
    return NextResponse.json({ success:true, message:'Item deleted' })
  } catch (e: any) {
    return NextResponse.json({ success:false, error:e.message }, { status:500 })
  }
}

// ── Activate — generate contribution schedule ─────────────────
async function handleActivate(body: any): Promise<NextResponse> {
  const { clubId } = body
  const clubs = await sql(`SELECT * FROM "GroceryClub" WHERE id=$1`, [clubId])
  if (!clubs.length) return NextResponse.json({ success:false, error:'Club not found' }, { status:404 })
  const club = clubs[0]
  if (club.status !== 'SETUP') return NextResponse.json({ success:false, error:'Club already activated' }, { status:400 })

  const members = await sql(`SELECT * FROM "GroceryMember" WHERE "clubId"=$1 AND "isActive"=true`, [clubId])
  if (!members.length) return NextResponse.json({ success:false, error:'Add at least one member before activating' }, { status:400 })

  // Recalc budget and contribution amount from items
  const items = await sql(`SELECT * FROM "GroceryItem" WHERE "clubId"=$1`, [clubId])
  const totalBudget = items.reduce((s: number, i: any) => s + Number(i.estimatedTotalPrice), 0)
  const contribAmount = members.length > 0 ? totalBudget / members.length : 0

  const periodCount = calcPeriodCount(Number(club.periodMonths), club.contributionFrequency)

  for (const m of members) {
    for (let p = 1; p <= periodCount; p++) {
      const cId = crypto.randomUUID()
      const due = calcDueDate(new Date(club.startDate), p, club.contributionFrequency)
      await exec(
        `INSERT INTO "GroceryContribution" (id,"clubId","userId","periodNumber","dueDate","amountDue","amountPaid",status,"createdAt","updatedAt")
         VALUES ($1,$2,$3,$4,$5,$6,0,'PENDING'::"GroceryContribStatus",NOW(),NOW())
         ON CONFLICT ("clubId","userId","periodNumber") DO NOTHING`,
        [cId, clubId, m.userId, p, due, contribAmount]
      )
    }
  }

  await exec(
    `UPDATE "GroceryClub" SET status='ACTIVE'::"GroceryClubStatus","totalBudget"=$1,"contributionAmount"=$2,"updatedAt"=NOW() WHERE id=$3`,
    [totalBudget, contribAmount, clubId]
  )

  return NextResponse.json({
    success:true,
    message:`Club activated! Budget: $${totalBudget.toFixed(2)}. Each member contributes $${contribAmount.toFixed(2)} over ${periodCount} periods.`,
  })
}

// ── Add/Remove member ─────────────────────────────────────────
async function handleAddMember(body: any): Promise<NextResponse> {
  const { clubId, userId } = body
  const mId = crypto.randomUUID()
  await exec(
    `INSERT INTO "GroceryMember" (id,"clubId","userId","totalContributed","sharePercentage","isActive","createdAt","updatedAt")
     VALUES ($1,$2,$3,0,0,true,NOW(),NOW()) ON CONFLICT ("clubId","userId") DO UPDATE SET "isActive"=true,"updatedAt"=NOW()`,
    [mId, clubId, userId]
  )
  const user = await prisma.user.findUnique({ where:{ id:userId }, select:{ fullName:true } })
  return NextResponse.json({ success:true, message:`${user?.fullName} added to club` })
}

async function handleRemoveMember(body: any): Promise<NextResponse> {
  await exec(`UPDATE "GroceryMember" SET "isActive"=false,"updatedAt"=NOW() WHERE "clubId"=$1 AND "userId"=$2`, [body.clubId, body.userId])
  return NextResponse.json({ success:true, message:'Member removed from club' })
}

// ── Grocery Item CRUD ─────────────────────────────────────────
async function handleAddItem(body: any): Promise<NextResponse> {
  const data = itemSchema.parse(body)
  const clubs = await sql(`SELECT * FROM "GroceryClub" WHERE id=$1`, [data.clubId])
  if (!clubs.length) return NextResponse.json({ success:false, error:'Club not found' }, { status:404 })
  const club = clubs[0]

  const memberCount = await sql(`SELECT COUNT(*) as cnt FROM "GroceryMember" WHERE "clubId"=$1 AND "isActive"=true`, [data.clubId])
  const mc       = Number((memberCount[0] as any).cnt) || 1
  const totalQty = data.qtyPerMember * mc
  const estTotal = data.estimatedUnitPrice * totalQty
  const itemId   = crypto.randomUUID()

  await exec(
    `INSERT INTO "GroceryItem" (id,"clubId",name,description,unit,"qtyPerMember","totalQty",
      "estimatedUnitPrice","estimatedTotalPrice","supplierName","supplierContact",status,notes,"createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'PENDING'::"GroceryItemStatus",$12,NOW(),NOW())`,
    [itemId, data.clubId, data.name, data.description, data.unit,
     data.qtyPerMember, totalQty, data.estimatedUnitPrice, estTotal,
     data.supplierName, data.supplierContact, data.notes]
  )

  // Update club total budget
  await exec(
    `UPDATE "GroceryClub" SET "totalBudget"=(SELECT COALESCE(SUM("estimatedTotalPrice"),0) FROM "GroceryItem" WHERE "clubId"=$1),"updatedAt"=NOW() WHERE id=$1`,
    [data.clubId]
  )

  // Recalc contribution amount if active
  if (club.status === 'ACTIVE') await recalcContribAmount(data.clubId)

  return NextResponse.json({ success:true, data:{ id:itemId }, message:`"${data.name}" added to grocery list` }, { status:201 })
}

async function handleUpdateItem(body: any): Promise<NextResponse> {
  const { itemId, clubId, ...fields } = body
  const memberCount = await sql(`SELECT COUNT(*) as cnt FROM "GroceryMember" WHERE "clubId"=$1 AND "isActive"=true`, [clubId])
  const mc       = Number((memberCount[0] as any).cnt) || 1
  const totalQty = Number(fields.qtyPerMember) * mc
  const estTotal = Number(fields.estimatedUnitPrice) * totalQty

  await exec(
    `UPDATE "GroceryItem" SET name=$1, description=$2, unit=$3, "qtyPerMember"=$4, "totalQty"=$5,
      "estimatedUnitPrice"=$6, "estimatedTotalPrice"=$7, "supplierName"=$8, "supplierContact"=$9, notes=$10, "updatedAt"=NOW()
     WHERE id=$11`,
    [fields.name, fields.description||null, fields.unit, fields.qtyPerMember, totalQty,
     fields.estimatedUnitPrice, estTotal, fields.supplierName||null, fields.supplierContact||null, fields.notes||null, itemId]
  )

  await exec(
    `UPDATE "GroceryClub" SET "totalBudget"=(SELECT COALESCE(SUM("estimatedTotalPrice"),0) FROM "GroceryItem" WHERE "clubId"=$1),"updatedAt"=NOW() WHERE id=$1`,
    [clubId]
  )
  await recalcContribAmount(clubId)
  return NextResponse.json({ success:true, message:'Item updated' })
}

async function handleDeleteItem(body: any): Promise<NextResponse> {
  const { itemId, clubId } = body
  await exec(`DELETE FROM "GroceryItem" WHERE id=$1`, [itemId])
  await exec(
    `UPDATE "GroceryClub" SET "totalBudget"=(SELECT COALESCE(SUM("estimatedTotalPrice"),0) FROM "GroceryItem" WHERE "clubId"=$1),"updatedAt"=NOW() WHERE id=$1`,
    [clubId]
  )
  await recalcContribAmount(clubId)
  return NextResponse.json({ success:true, message:'Item removed from grocery list' })
}

// ── Item status transitions ───────────────────────────────────
async function handleAssignItem(body: any): Promise<NextResponse> {
  const { itemId, assignedToId, assignedToName } = body
  await exec(
    `UPDATE "GroceryItem" SET status='ASSIGNED'::"GroceryItemStatus","assignedToId"=$1,"assignedToName"=$2,"updatedAt"=NOW() WHERE id=$3`,
    [assignedToId||null, assignedToName||null, itemId]
  )
  return NextResponse.json({ success:true, message:`Item assigned to ${assignedToName}` })
}

async function handleMarkPurchased(body: any): Promise<NextResponse> {
  const { itemId, clubId, actualUnitPrice, actualTotalPrice, purchasedById, purchasedByName, receiptUrl, notes } = body
  await exec(
    `UPDATE "GroceryItem" SET status='PURCHASED'::"GroceryItemStatus","actualUnitPrice"=$1,"actualTotalPrice"=$2,
      "purchasedAt"=NOW(),"purchasedById"=$3,"purchasedByName"=$4,"receiptUrl"=$5,notes=$6,"updatedAt"=NOW() WHERE id=$7`,
    [actualUnitPrice||null, actualTotalPrice||null, purchasedById||null, purchasedByName||null, receiptUrl||null, notes||null, itemId]
  )
  // Update total spent
  await exec(
    `UPDATE "GroceryClub" SET "totalSpent"=(SELECT COALESCE(SUM("actualTotalPrice"),0) FROM "GroceryItem" WHERE "clubId"=$1 AND status='PURCHASED'),"updatedAt"=NOW() WHERE id=$1`,
    [clubId]
  )
  // Check if all items purchased — move to PURCHASING status
  const pending = await sql(`SELECT COUNT(*) as cnt FROM "GroceryItem" WHERE "clubId"=$1 AND status NOT IN ('PURCHASED','DISTRIBUTED')`, [clubId])
  if (Number((pending[0] as any).cnt) === 0) {
    await exec(`UPDATE "GroceryClub" SET status='PURCHASING'::"GroceryClubStatus","updatedAt"=NOW() WHERE id=$1`, [clubId])
  }
  return NextResponse.json({ success:true, message:'Item marked as purchased' })
}

async function handleMarkDistributed(body: any): Promise<NextResponse> {
  const { clubId, itemId } = body
  if (itemId) {
    await exec(`UPDATE "GroceryItem" SET status='DISTRIBUTED'::"GroceryItemStatus","distributedAt"=NOW(),"updatedAt"=NOW() WHERE id=$1`, [itemId])
  } else {
    // Mark all purchased items as distributed
    await exec(`UPDATE "GroceryItem" SET status='DISTRIBUTED'::"GroceryItemStatus","distributedAt"=NOW(),"updatedAt"=NOW() WHERE "clubId"=$1 AND status='PURCHASED'`, [clubId])
    await exec(`UPDATE "GroceryClub" SET status='DISTRIBUTED'::"GroceryClubStatus","updatedAt"=NOW() WHERE id=$1`, [clubId])
  }
  return NextResponse.json({ success:true, message:'Items marked as distributed' })
}

// ── Contributions ─────────────────────────────────────────────
async function handlePayContrib(body: any): Promise<NextResponse> {
  const { contributionId, amountPaid, paymentMethod, paymentRef } = body
  const contribs = await sql(`SELECT * FROM "GroceryContribution" WHERE id=$1`, [contributionId])
  if (!contribs.length) return NextResponse.json({ success:false, error:'Contribution not found' }, { status:404 })
  const c = contribs[0]

  const newPaid = Number(c.amountPaid) + Number(amountPaid)
  const isPaid  = newPaid >= Number(c.amountDue)

  await exec(
    `UPDATE "GroceryContribution" SET "amountPaid"=$1,status=$2::"GroceryContribStatus","paidAt"=$3,"paymentMethod"=$4,"paymentRef"=$5,"updatedAt"=NOW() WHERE id=$6`,
    [newPaid, isPaid?'PAID':'PARTIAL', isPaid?new Date():null, paymentMethod||null, paymentRef||null, contributionId]
  )
  await recalcTotals(c.clubId)
  return NextResponse.json({ success:true, message: isPaid ? `✅ Period #${c.periodNumber} paid` : 'Partial payment recorded' })
}

async function handleMarkPeriodPaid(body: any): Promise<NextResponse> {
  const { clubId, periodNumber } = body
  await exec(
    `UPDATE "GroceryContribution" SET status='PAID'::"GroceryContribStatus","amountPaid"="amountDue","paidAt"=NOW(),"updatedAt"=NOW()
     WHERE "clubId"=$1 AND "periodNumber"=$2 AND status != 'PAID'`,
    [clubId, periodNumber]
  )
  await recalcTotals(clubId)
  return NextResponse.json({ success:true, message:`Period ${periodNumber} marked as collected` })
}

async function handleWaiveContrib(body: any): Promise<NextResponse> {
  await exec(
    `UPDATE "GroceryContribution" SET status='WAIVED'::"GroceryContribStatus",notes=$1,"updatedAt"=NOW() WHERE id=$2`,
    [body.notes||'Waived by admin', body.contributionId]
  )
  return NextResponse.json({ success:true, message:'Contribution waived' })
}

async function handleUpdateClub(body: any): Promise<NextResponse> {
  const { clubId, name, description, coordinatorId, surplusNotes, notes } = body
  await exec(
    `UPDATE "GroceryClub" SET name=$1,description=$2,"coordinatorId"=$3,"surplusNotes"=$4,notes=$5,"updatedAt"=NOW() WHERE id=$6`,
    [name, description||null, coordinatorId||null, surplusNotes||null, notes||null, clubId]
  )
  return NextResponse.json({ success:true, message:'Club settings updated' })
}

async function handleClose(body: any): Promise<NextResponse> {
  await exec(
    `UPDATE "GroceryClub" SET status='CLOSED'::"GroceryClubStatus","surplusNotes"=$1,"updatedAt"=NOW() WHERE id=$2`,
    [body.surplusNotes||null, body.clubId]
  )
  return NextResponse.json({ success:true, message:'Grocery club closed' })
}

// ── Helpers ───────────────────────────────────────────────────
async function recalcContribAmount(clubId: string) {
  const [clubs, memberCount] = await Promise.all([
    sql(`SELECT "totalBudget" FROM "GroceryClub" WHERE id=$1`, [clubId]),
    sql(`SELECT COUNT(*) as cnt FROM "GroceryMember" WHERE "clubId"=$1 AND "isActive"=true`, [clubId]),
  ])
  if (!clubs.length) return
  const budget = Number(clubs[0].totalBudget)
  const mc     = Number((memberCount[0] as any).cnt) || 1
  const amount = budget / mc
  await exec(`UPDATE "GroceryClub" SET "contributionAmount"=$1,"updatedAt"=NOW() WHERE id=$2`, [amount, clubId])
}

async function recalcTotals(clubId: string) {
  const result = await sql(
    `SELECT COALESCE(SUM("amountPaid"),0) as total FROM "GroceryContribution" WHERE "clubId"=$1 AND status='PAID'`,
    [clubId]
  )
  await exec(
    `UPDATE "GroceryClub" SET "totalContributed"=$1,"updatedAt"=NOW() WHERE id=$2`,
    [Number(result[0]?.total || 0), clubId]
  )
  // Recalc member shares
  const memberContribs = await sql(
    `SELECT "userId", COALESCE(SUM("amountPaid"),0) as paid FROM "GroceryContribution" WHERE "clubId"=$1 AND status='PAID' GROUP BY "userId"`,
    [clubId]
  )
  const total = memberContribs.reduce((s: number, m: any) => s + Number(m.paid), 0)
  for (const mc of memberContribs) {
    const share = total > 0 ? Number(mc.paid) / total * 100 : 0
    await exec(
      `UPDATE "GroceryMember" SET "totalContributed"=$1,"sharePercentage"=$2,"updatedAt"=NOW() WHERE "clubId"=$3 AND "userId"=$4`,
      [Number(mc.paid), share, clubId, mc.userId]
    )
  }
}

function formatClub(c: any) {
  const start  = new Date(c.startDate)
  const end    = new Date(c.endDate)
  const now    = new Date()
  const budget = Number(c.totalBudget || 0)
  const spent  = Number(c.totalSpent  || 0)
  const collected = Number(c.totalContributed || 0)

  return {
    id:                   c.id,
    groupId:              c.groupId,
    groupName:            c.groupName,
    currency:             c.groupCurrency || c.currency || 'USD',
    name:                 c.name,
    description:          c.description,
    periodMonths:         Number(c.periodMonths),
    contributionFrequency: c.contributionFrequency,
    contributionAmount:   Number(c.contributionAmount || 0),
    startDate:            c.startDate,
    endDate:              c.endDate,
    status:               c.status,
    totalBudget:          budget,
    totalContributed:     collected,
    totalSpent:           spent,
    remainingBudget:      budget - spent,
    fundingPct:           budget > 0 ? Math.min(100, Math.round(collected / budget * 100)) : 0,
    spentPct:             budget > 0 ? Math.min(100, Math.round(spent    / budget * 100)) : 0,
    coordinatorId:        c.coordinatorId,
    coordinatorName:      c.coordinatorName,
    surplusNotes:         c.surplusNotes,
    notes:                c.notes,
    memberCount:          Number(c.memberCount || 0),
    itemCount:            Number(c.itemCount   || 0),
    purchasedCount:       Number(c.purchasedCount || 0),
    daysLeft:             Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 86400000)),
    timeProgress:         Math.min(100, Math.round((now.getTime()-start.getTime())/(end.getTime()-start.getTime())*100)),
    createdAt:            c.createdAt,
  }
}

function formatItem(i: any) {
  return {
    id:                  i.id,
    clubId:              i.clubId,
    name:                i.name,
    description:         i.description,
    unit:                i.unit,
    qtyPerMember:        Number(i.qtyPerMember),
    totalQty:            Number(i.totalQty),
    estimatedUnitPrice:  Number(i.estimatedUnitPrice),
    estimatedTotalPrice: Number(i.estimatedTotalPrice),
    actualUnitPrice:     i.actualUnitPrice != null ? Number(i.actualUnitPrice) : null,
    actualTotalPrice:    i.actualTotalPrice != null ? Number(i.actualTotalPrice) : null,
    supplierName:        i.supplierName,
    supplierContact:     i.supplierContact,
    status:              i.status,
    assignedToId:        i.assignedToId,
    assignedToName:      i.assignedToName,
    purchasedAt:         i.purchasedAt,
    purchasedById:       i.purchasedById,
    purchasedByName:     i.purchasedByName,
    receiptUrl:          i.receiptUrl,
    distributedAt:       i.distributedAt,
    notes:               i.notes,
    priceDiff:           i.actualTotalPrice != null
      ? Number(i.actualTotalPrice) - Number(i.estimatedTotalPrice) : null,
  }
}
