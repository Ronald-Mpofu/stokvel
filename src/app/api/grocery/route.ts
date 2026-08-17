// src/app/api/grocery/route.ts — v1.2
// v1.1: handleActivate no longer issues one INSERT per (member × period) —
//       schedule rows are written in batched multi-row INSERTs. Club creation
//       batches its member INSERTs. recalcTotals is now two set-based
//       statements run in parallel instead of N+3 sequential round trips.
// v1.2: club creation now writes GroceryClub."schemeId" and enrols members
//       into "SchemeMember" as well as "GroceryMember". Without both, the
//       mobile hub reads the Grocery Club card as "Not enrolled" for every
//       member of every group. Run sql/13-grocery-scheme-link.sql first to
//       repair rows created before this version. Adds enrolAllMembers so the
//       mobile create sheet does not need a roster fetch.
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import prisma from '@/lib/prisma/client'
import { randomUUID } from 'crypto'
import { requireGroupManager } from '@/lib/auth'

export const dynamic = 'force-dynamic'

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
  // Mobile create sheet sends this instead of a member list. Selecting
  // members needs a roster fetch the phone should not have to make just to
  // create a club — the server already knows who is in the group.
  enrolAllMembers:       z.coerce.boolean().default(false),
})

// Resolves the group's single GROCERY_CLUB scheme row, creating it if the
// group has never run one, and marks it contributory.
//
// WindfallScheme has UNIQUE ("groupId","schemeType") — one row per type per
// group — so this never produces a second grocery scheme. A club is an
// instance underneath that one row, which is why creating "another grocery
// club" does not add a seventh card to the hub.
async function ensureGrocerySchemeId(groupId: string): Promise<string> {
  const existing = await sql(
    `SELECT id FROM "WindfallScheme"
      WHERE "groupId" = $1 AND "schemeType" = 'GROCERY_CLUB'::"WindfallSchemeType"`,
    [groupId]
  )
  if (existing.length) {
    // isContributory defaults to false. Left false, the hub reads the card
    // as "No passbook" even for an enrolled member.
    await exec(
      `UPDATE "WindfallScheme" SET "isContributory"=true,"updatedAt"=NOW()
        WHERE id=$1 AND "isContributory"=false`,
      [existing[0].id]
    )
    return existing[0].id
  }

  const schemeId = randomUUID()
  await exec(
    `INSERT INTO "WindfallScheme"
       (id,"groupId","schemeType",name,description,status,"isContributory","isRotating","createdAt","updatedAt")
     VALUES ($1,$2,'GROCERY_CLUB'::"WindfallSchemeType",$3,$4,'ACTIVE'::"WindfallSchemeStatus",true,false,NOW(),NOW())
     ON CONFLICT ("groupId","schemeType") DO NOTHING`,
    [schemeId, groupId, 'Grocery Club', 'Bulk grocery buying for members']
  )

  // ON CONFLICT DO NOTHING means a concurrent request may have won the race,
  // in which case our id was never inserted. Re-read rather than assume.
  const row = await sql(
    `SELECT id FROM "WindfallScheme"
      WHERE "groupId" = $1 AND "schemeType" = 'GROCERY_CLUB'::"WindfallSchemeType"`,
    [groupId]
  )
  if (!row.length) throw new Error('Could not resolve the group\'s Grocery Club scheme')
  return row[0].id
}

// Enrols users into BOTH membership tables in one pass.
//
// GroceryMember scopes a member to one club. SchemeMember scopes them to the
// scheme and is what the mobile hub reads to decide enrolment. Writing only
// the first is why every grocery card read "Not enrolled / Ask your admin".
async function enrolMembers(clubId: string, schemeId: string, userIds: string[]) {
  const ids = Array.from(new Set(userIds.filter(Boolean)))
  if (!ids.length) return

  const memberParams: any[] = [clubId]
  const memberTuples = ids.map(userId => {
    const b = memberParams.length
    memberParams.push(randomUUID(), userId)
    return `($${b+1},$1,$${b+2},0,0,true,NOW(),NOW())`
  }).join(',')

  const schemeParams: any[] = [schemeId]
  const schemeTuples = ids.map(userId => {
    const b = schemeParams.length
    schemeParams.push(randomUUID(), userId)
    return `($${b+1},$1,$${b+2},'ACTIVE'::"MemberStatus",NOW(),NOW(),NOW())`
  }).join(',')

  await Promise.all([
    exec(
      `INSERT INTO "GroceryMember" (id,"clubId","userId","totalContributed","sharePercentage","isActive","createdAt","updatedAt")
       VALUES ${memberTuples}
       ON CONFLICT ("clubId","userId") DO UPDATE SET "isActive"=true,"updatedAt"=NOW()`,
      memberParams
    ),
    exec(
      `INSERT INTO "SchemeMember" (id,"schemeId","userId",status,"joinedAt","createdAt","updatedAt")
       VALUES ${schemeTuples}
       ON CONFLICT ("schemeId","userId") DO UPDATE SET status='ACTIVE'::"MemberStatus","exitedAt"=NULL,"updatedAt"=NOW()`,
      schemeParams
    ),
  ])
}

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

    // ── Group-manager guard (BR 4 & 6) ────────────────────────
    let guardGroupId: string | null = body.groupId || null
    if (!guardGroupId && body.clubId) {
      const r = await sql(`SELECT "groupId" FROM "GroceryClub" WHERE id=$1`, [body.clubId])
      guardGroupId = r[0]?.groupId ?? null
    }
    const guardErr = await requireGroupManager(req, guardGroupId)
    if (guardErr) return guardErr

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
    const clubId = randomUUID()

    // Resolve the scheme BEFORE inserting the club. A club with a NULL
    // schemeId is invisible to the mobile hub, and we would rather fail
    // loudly here than write an orphan that reads as "Not enrolled".
    const schemeId = await ensureGrocerySchemeId(data.groupId)

    await exec(
      `INSERT INTO "GroceryClub" (id,"groupId","schemeId",name,description,"periodMonths","contributionFrequency",
        "contributionAmount","startDate","endDate",status,currency,"totalBudget","totalContributed",
        "totalSpent","coordinatorId",notes,"createdAt","updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,0,$8,$9,'SETUP'::"GroceryClubStatus",$10::"CurrencyCode",0,0,0,$11,$12,NOW(),NOW())`,
      [clubId, data.groupId, schemeId, data.name, data.description, data.periodMonths,
       data.contributionFrequency, startDate, endDate, group.currency,
       data.coordinatorId, data.notes]
    )

    // The mobile create sheet asks the server for the roster rather than
    // fetching it on the phone first.
    let memberIds = data.memberIds
    if (data.enrolAllMembers) {
      const roster = await sql(
        `SELECT "userId" FROM "GroupMember"
          WHERE "groupId" = $1 AND status <> 'EXITED'::"MemberStatus"`,
        [data.groupId]
      )
      memberIds = roster.map((r: any) => r.userId)
    }

    await enrolMembers(clubId, schemeId, memberIds)

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

// ── DELETE — delete item OR entire club ──────────────────────
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const itemId  = searchParams.get('itemId')
    const clubId  = searchParams.get('clubId')

    // ── Group-manager guard ────────────────────────────────────
    let guardGroupId: string | null = null
    if (clubId) {
      const r = await sql(`SELECT "groupId" FROM "GroceryClub" WHERE id=$1`, [clubId])
      guardGroupId = r[0]?.groupId ?? null
    } else if (itemId) {
      const r = await sql(`SELECT gc."groupId" FROM "GroceryItem" gi JOIN "GroceryClub" gc ON gc.id = gi."clubId" WHERE gi.id=$1`, [itemId])
      guardGroupId = r[0]?.groupId ?? null
    }
    const guardErr = await requireGroupManager(req, guardGroupId)
    if (guardErr) return guardErr

    // ── Delete a single item ──────────────────────────────────
    if (itemId) {
      await exec(`DELETE FROM "GroceryItem" WHERE id=$1`, [itemId])
      return NextResponse.json({ success:true, message:'Item deleted' })
    }

    // ── Delete entire club (temporary hard-delete — remove before go-live) ──
    if (clubId) {
      const rows = await sql(`SELECT id, name FROM "GroceryClub" WHERE id=$1`, [clubId])
      if (!rows.length) return NextResponse.json({ success:false, error:'Grocery club not found' }, { status:404 })
      const name = rows[0].name
      try { await exec(`DELETE FROM "GroceryPurchase"     WHERE "itemId" IN (SELECT id FROM "GroceryItem" WHERE "clubId"=$1)`, [clubId]) } catch {}
      try { await exec(`DELETE FROM "GroceryItem"         WHERE "clubId"=$1`, [clubId]) } catch {}
      try { await exec(`DELETE FROM "GroceryContribution" WHERE "clubId"=$1`, [clubId]) } catch {}
      try { await exec(`DELETE FROM "GroceryMember"       WHERE "clubId"=$1`, [clubId]) } catch {}
      await exec(`DELETE FROM "GroceryClub" WHERE id=$1`, [clubId])
      return NextResponse.json({ success:true, message:`"${name}" has been permanently deleted.` })
    }

    return NextResponse.json({ success:false, error:'itemId or clubId required' }, { status:400 })
  } catch (e: any) {
    console.error('DELETE /api/grocery error:', e)
    return NextResponse.json({ success:false, error:e.message }, { status:500 })
  }
}

// ── Activate — generate contribution schedule ─────────────────
// v1.1: the schedule is written with batched multi-row INSERTs instead of one
//       round trip per (member × period). A 12-month WEEKLY club with 10
//       members is 520 rows — previously 520 sequential round trips at ~160ms
//       Tokyo↔Washington (~83s), now a handful of statements (well under 1s).
//
// Placeholders stay untyped so Postgres infers each parameter's type from the
// target column. Do NOT switch this to unnest(...::text[]) — an explicit array
// cast defeats that inference and will fail if a column is uuid rather than text.
const ACTIVATE_CHUNK_ROWS = 500

async function handleActivate(body: any): Promise<NextResponse> {
  const { clubId } = body

  // One round trip for club + roster + items instead of three sequential ones.
  const [clubs, members, items] = await Promise.all([
    sql(`SELECT * FROM "GroceryClub" WHERE id=$1`, [clubId]),
    sql(`SELECT * FROM "GroceryMember" WHERE "clubId"=$1 AND "isActive"=true`, [clubId]),
    sql(`SELECT "estimatedTotalPrice" FROM "GroceryItem" WHERE "clubId"=$1`, [clubId]),
  ])

  if (!clubs.length) return NextResponse.json({ success:false, error:'Club not found' }, { status:404 })
  const club = clubs[0]
  if (club.status !== 'SETUP') return NextResponse.json({ success:false, error:'Club already activated' }, { status:400 })
  if (!members.length) return NextResponse.json({ success:false, error:'Add at least one member before activating' }, { status:400 })

  // Recalc budget and contribution amount from items
  const totalBudget   = items.reduce((s: number, i: any) => s + Number(i.estimatedTotalPrice), 0)
  const contribAmount = totalBudget / members.length

  const periodCount = calcPeriodCount(Number(club.periodMonths), club.contributionFrequency)
  const startDate   = new Date(club.startDate)

  // Build the full row set in memory first — cheap, and lets us size the batches.
  const rows: { id: string; userId: string; period: number; due: Date }[] = []
  for (const m of members) {
    for (let p = 1; p <= periodCount; p++) {
      rows.push({
        id:     randomUUID(),
        userId: m.userId,
        period: p,
        due:    calcDueDate(startDate, p, club.contributionFrequency),
      })
    }
  }

  // $1 = clubId and $2 = amountDue are shared by every tuple, so each row costs
  // only 4 further placeholders. Chunked to keep any single statement modest.
  for (let i = 0; i < rows.length; i += ACTIVATE_CHUNK_ROWS) {
    const chunk  = rows.slice(i, i + ACTIVATE_CHUNK_ROWS)
    const params: any[] = [clubId, contribAmount]
    const tuples = chunk.map(r => {
      const b = params.length
      params.push(r.id, r.userId, r.period, r.due)
      return `($${b+1},$1,$${b+2},$${b+3},$${b+4},$2,0,'PENDING'::"GroceryContribStatus",NOW(),NOW())`
    }).join(',')

    await exec(
      `INSERT INTO "GroceryContribution" (id,"clubId","userId","periodNumber","dueDate","amountDue","amountPaid",status,"createdAt","updatedAt")
       VALUES ${tuples}
       ON CONFLICT ("clubId","userId","periodNumber") DO NOTHING`,
      params
    )
  }

  await exec(
    `UPDATE "GroceryClub" SET status='ACTIVE'::"GroceryClubStatus","totalBudget"=$1,"contributionAmount"=$2,"updatedAt"=NOW() WHERE id=$3`,
    [totalBudget, contribAmount, clubId]
  )

  return NextResponse.json({
    success:true,
    data:{ periodCount, memberCount: members.length, scheduleRows: rows.length },
    message:`Club activated! Budget: $${totalBudget.toFixed(2)}. Each member contributes $${contribAmount.toFixed(2)} over ${periodCount} periods.`,
  })
}

// ── Add/Remove member ─────────────────────────────────────────
async function handleAddMember(body: any): Promise<NextResponse> {
  const { clubId, userId } = body
  const clubs = await sql(`SELECT "groupId","schemeId" FROM "GroceryClub" WHERE id=$1`, [clubId])
  if (!clubs.length) return NextResponse.json({ success:false, error:'Club not found' }, { status:404 })

  // A club created before migration 13 may still have a NULL schemeId.
  const schemeId = clubs[0].schemeId || await ensureGrocerySchemeId(clubs[0].groupId)
  if (!clubs[0].schemeId) {
    await exec(`UPDATE "GroceryClub" SET "schemeId"=$1,"updatedAt"=NOW() WHERE id=$2`, [schemeId, clubId])
  }

  await enrolMembers(clubId, schemeId, [userId])
  const user = await prisma.user.findUnique({ where:{ id:userId }, select:{ fullName:true } })
  return NextResponse.json({ success:true, message:`${user?.fullName} added to club` })
}

async function handleRemoveMember(body: any): Promise<NextResponse> {
  const { clubId, userId } = body
  await exec(`UPDATE "GroceryMember" SET "isActive"=false,"updatedAt"=NOW() WHERE "clubId"=$1 AND "userId"=$2`, [clubId, userId])

  // SchemeMember is scheme-scoped, not club-scoped. A member dropped from
  // one club may still be active in another under the same scheme, so only
  // exit them from the scheme when no active club membership remains.
  // Getting this wrong would erase their passbook for clubs they are still in.
  await exec(
    `UPDATE "SchemeMember" sm
        SET status='EXITED'::"MemberStatus", "exitedAt"=NOW(), "updatedAt"=NOW()
      WHERE sm."userId" = $2
        AND sm."schemeId" = (SELECT "schemeId" FROM "GroceryClub" WHERE id=$1)
        AND NOT EXISTS (
              SELECT 1
                FROM "GroceryMember" gm
                JOIN "GroceryClub"   gc ON gc.id = gm."clubId"
               WHERE gm."userId"  = $2
                 AND gm."isActive" = true
                 AND gc."schemeId" = sm."schemeId"
            )`,
    [clubId, userId]
  )
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
  const itemId   = randomUUID()

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

// v1.1: was 2 reads + 1 write + one UPDATE per member (N+3 sequential round
// trips on every single payment). Now two set-based statements run in parallel,
// both computed entirely in the database. Correlated scalar subqueries are used
// rather than UPDATE…FROM with a LEFT JOIN, because Postgres rejects a join
// condition in the FROM list that references the UPDATE target.
async function recalcTotals(clubId: string) {
  await Promise.all([
    exec(
      `UPDATE "GroceryClub"
          SET "totalContributed" = (SELECT COALESCE(SUM("amountPaid"),0)
                                      FROM "GroceryContribution"
                                     WHERE "clubId"=$1 AND status='PAID'),
              "updatedAt" = NOW()
        WHERE id = $1`,
      [clubId]
    ),
    exec(
      `UPDATE "GroceryMember" gm
          SET "totalContributed" = COALESCE((SELECT SUM(gc."amountPaid")
                                               FROM "GroceryContribution" gc
                                              WHERE gc."clubId"=$1
                                                AND gc."userId"=gm."userId"
                                                AND gc.status='PAID'), 0),
              "sharePercentage"  = CASE
                WHEN (SELECT COALESCE(SUM("amountPaid"),0)
                        FROM "GroceryContribution"
                       WHERE "clubId"=$1 AND status='PAID') > 0
                THEN COALESCE((SELECT SUM(gc2."amountPaid")
                                 FROM "GroceryContribution" gc2
                                WHERE gc2."clubId"=$1
                                  AND gc2."userId"=gm."userId"
                                  AND gc2.status='PAID'), 0)
                     / (SELECT SUM("amountPaid")
                          FROM "GroceryContribution"
                         WHERE "clubId"=$1 AND status='PAID') * 100
                ELSE 0 END,
              "updatedAt" = NOW()
        WHERE gm."clubId" = $1`,
      [clubId]
    ),
  ])
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
