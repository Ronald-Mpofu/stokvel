// prisma/seed.ts
//
// Rebuilt for the scheme-level cycle model (migration 08).
//
// WHAT CHANGED
//   1. Seeds the six WindfallScheme rows. The old seed never did, so a
//      freshly purged database produced a group with no schemes — and the
//      cycle now hangs off a scheme, so it had nowhere to attach.
//   2. Configures the savings pool as contributory + rotating and gives it
//      its own contribution terms. Those moved off Group.
//   3. Creates SchemeMember rows with payout positions. Participation used
//      to be inferred; it is now explicit.
//   4. Creates Contribution rows. The old seed built a cycle and a payout
//      schedule but no contributions, so every passbook came out empty.
//   5. Dates are RELATIVE to today, not hardcoded to 2025. The cycle is
//      mid-flight: some months paid, one overdue, the rest not yet due —
//      which exercises all three passbook states in the mobile UI.
//   6. The admin password is no longer hardcoded. See below.
//
// RUN:  npx prisma db seed
//       SEED_ADMIN_PASSWORD='...' npx prisma db seed

import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'crypto'

// Use DIRECT_URL for seeding to avoid connection pool timeout
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: process.env.DIRECT_URL || process.env.DATABASE_URL,
    },
  },
  log: ['error'],
})

// Match src/lib/auth: default 12, floored at 10.
const BCRYPT_COST = Math.max(10, Number(process.env.BCRYPT_COST) || 12)

// The old seed hardcoded 'Admin@12345' for a SYSTEM_ADMIN account and that
// value ended up in the project documentation and in git history. A password
// in version control is a password everyone has.
//
// Set SEED_ADMIN_PASSWORD to choose your own; otherwise one is generated and
// printed once at the end. Note that upsert leaves existing users untouched,
// so a generated password only applies to accounts created on this run.
const generatedPassword = randomBytes(12).toString('base64url')
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD || generatedPassword
const usingGenerated = !process.env.SEED_ADMIN_PASSWORD

// ── Timeline ──────────────────────────────────────────────────
// Cycle month 1 begins 6 months ago, so today sits inside month 7.
const CYCLE_MONTHS = 10
const MONTHS_ELAPSED = 6

function monthStart(offsetFromNow: number): Date {
  const d = new Date()
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offsetFromNow, 1))
}

const CYCLE_START = monthStart(-MONTHS_ELAPSED)
const CYCLE_END = monthStart(-MONTHS_ELAPSED + CYCLE_MONTHS)

const CONTRIBUTION_AMOUNT = 100

async function main() {
  console.log('🌱 Seeding database...')

  // ── System Admin ──────────────────────────────────────────────
  const adminPw = await bcrypt.hash(ADMIN_PASSWORD, BCRYPT_COST)
  const admin = await prisma.user.upsert({
    where: { email: 'admin@stokvel.com' },
    update: {},
    create: {
      email: 'admin@stokvel.com',
      phone: '+263771000001',
      passwordHash: adminPw,
      fullName: 'System Administrator',
      role: 'SYSTEM_ADMIN',
      kycStatus: 'VERIFIED',
      tier: 'PLATINUM',
      reputationScore: 200,
      status: 'ACTIVE',
      country: 'Zimbabwe',
      city: 'Harare',
      preferredCurrency: 'USD',
      emailVerifiedAt: new Date(),
      phoneVerifiedAt: new Date(),
    },
  })
  console.log('✓ System admin created:', admin.email)

  // ── Group Admin ───────────────────────────────────────────────
  const groupAdminPw = await bcrypt.hash(ADMIN_PASSWORD, BCRYPT_COST)
  const groupAdmin = await prisma.user.upsert({
    where: { email: 'groupadmin@stokvel.com' },
    update: {},
    create: {
      email: 'groupadmin@stokvel.com',
      phone: '+263771000002',
      passwordHash: groupAdminPw,
      fullName: 'Group Administrator',
      role: 'GROUP_ADMIN',
      kycStatus: 'VERIFIED',
      tier: 'GOLD',
      reputationScore: 130,
      status: 'ACTIVE',
      country: 'Zimbabwe',
      city: 'Harare',
      preferredCurrency: 'USD',
      emailVerifiedAt: new Date(),
      phoneVerifiedAt: new Date(),
    },
  })
  console.log('✓ Group admin created:', groupAdmin.email)

  // ── Sample Members (one at a time to avoid pool exhaustion) ───
  const memberPw = await bcrypt.hash('Member@12345', BCRYPT_COST)
  const memberData = [
    { name: 'Tariro Moyo',      email: 'tariro@example.com',     phone: '+263772100001', score: 142 },
    { name: 'Chiedza Mutasa',   email: 'chiedza@example.com',    phone: '+263772100002', score: 118 },
    { name: 'Farai Khumalo',    email: 'farai@example.com',      phone: '+263772100003', score: 134 },
    { name: 'Simba Ndlovu',     email: 'simba@example.com',      phone: '+263772100004', score: 89  },
    { name: 'Paidamoyo Mhaka',  email: 'paidamoyo@example.com',  phone: '+263772100005', score: 76  },
    { name: 'Rudo Zimuto',      email: 'rudo@example.com',       phone: '+263772100006', score: 156 },
    { name: 'Kudzi Sithole',    email: 'kudzi@example.com',      phone: '+263772100007', score: 121 },
    { name: 'Nomsa Dube',       email: 'nomsa@example.com',      phone: '+263772100008', score: 98  },
    { name: 'Muchaneta Choto',  email: 'muchaneta@example.com',  phone: '+263772100009', score: 103 },
    { name: 'Blessing Mlilo',   email: 'blessing@example.com',   phone: '+263772100010', score: 87  },
  ]

  const members = []
  for (const m of memberData) {
    const tier = m.score >= 150 ? 'PLATINUM'
               : m.score >= 100 ? 'GOLD'
               : m.score >= 50  ? 'SILVER'
               : 'BRONZE'
    const member = await prisma.user.upsert({
      where: { email: m.email },
      update: {},
      create: {
        email: m.email,
        phone: m.phone,
        passwordHash: memberPw,
        fullName: m.name,
        role: 'MEMBER',
        kycStatus: 'VERIFIED',
        tier,
        reputationScore: m.score,
        status: 'ACTIVE',
        country: 'Zimbabwe',
        city: 'Harare',
        preferredCurrency: 'USD',
        emailVerifiedAt: new Date(),
        phoneVerifiedAt: new Date(),
      },
    })
    members.push(member)
    console.log('✓ Member created:', member.fullName)
  }

  // ── Sample Group ──────────────────────────────────────────────
  // contributionAmount / contributionDay / payoutStrategy are still set here
  // because the columns are NOT NULL. They are being retired in favour of
  // the scheme-level equivalents below — see STEP 6 of migration 08.
  const group = await prisma.group.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Harare Builders Circle',
      description: 'A savings and investment group focused on property and business ventures',
      adminUserId: groupAdmin.id,
      status: 'ACTIVE',
      currency: 'USD',
      contributionAmount: CONTRIBUTION_AMOUNT,
      contributionDay: 1,
      maxMembers: 10,
      penaltyRate: 0.20,
      insurancePoolPct: 0.015,
      platformFeePct: 0.02,
      payoutStrategy: 'SENIORITY',
      escrowBalance: 600,
      insurancePoolBalance: 90,
      country: 'Zimbabwe',
      region: 'Harare',
    },
  })
  console.log('✓ Group created:', group.name)

  // ── Windfall Schemes ──────────────────────────────────────────
  // Types come from pg_enum rather than a hardcoded list, so this cannot
  // drift from WindfallSchemeType. Raw SQL because WindfallScheme is not a
  // Prisma model. Idempotent via the (groupId, schemeType) unique key.
  await prisma.$executeRawUnsafe(`
    INSERT INTO "WindfallScheme" ("groupId", "schemeType", "name", "status")
    SELECT $1::text,
           e.enumlabel::"WindfallSchemeType",
           initcap(replace(e.enumlabel, '_', ' ')),
           'ACTIVE'::"WindfallSchemeStatus"
    FROM (
      SELECT en.enumlabel
      FROM pg_enum en
      JOIN pg_type ty ON ty.oid = en.enumtypid
      WHERE ty.typname = 'WindfallSchemeType'
    ) e
    ON CONFLICT ("groupId", "schemeType") DO NOTHING
  `, group.id)

  // Savings pool: collects contributions AND rotates to one member a month.
  await prisma.$executeRawUnsafe(`
    UPDATE "WindfallScheme"
       SET "isContributory"        = true,
           "isRotating"            = true,
           "contributionAmount"    = $2::numeric,
           "contributionDay"       = 1,
           "contributionFrequency" = 'monthly',
           "payoutStrategy"        = 'SENIORITY'::"PayoutStrategy",
           "penaltyRate"           = 0.20,
           "insurancePoolPct"      = 0.015,
           "startDate"             = $3::timestamp,
           "updatedAt"             = NOW()
     WHERE "groupId" = $1::text
       AND "schemeType" = 'SAVINGS_POOL'::"WindfallSchemeType"
  `, group.id, CONTRIBUTION_AMOUNT, CYCLE_START)

  // Grocery club: collects contributions but pays EVERYONE at the end of the
  // year rather than rotating — hence no payout strategy.
  await prisma.$executeRawUnsafe(`
    UPDATE "WindfallScheme"
       SET "isContributory"        = true,
           "isRotating"            = false,
           "contributionAmount"    = 25,
           "contributionDay"       = 1,
           "contributionFrequency" = 'monthly',
           "updatedAt"             = NOW()
     WHERE "groupId" = $1::text
       AND "schemeType" = 'GROCERY_CLUB'::"WindfallSchemeType"
  `, group.id)

  const savingsRows = await prisma.$queryRawUnsafe<Array<{ id: string }>>(`
    SELECT id FROM "WindfallScheme"
     WHERE "groupId" = $1::text
       AND "schemeType" = 'SAVINGS_POOL'::"WindfallSchemeType"
     LIMIT 1
  `, group.id)

  const savingsSchemeId = savingsRows[0]?.id
  if (!savingsSchemeId) throw new Error('Savings pool scheme was not created — cannot seed a cycle')
  console.log('✓ Windfall schemes created and configured')

  // ── Default Chart of Accounts ─────────────────────────────────
  const accounts = [
    { code: '1000', name: 'Cash & Escrow',           type: 'ASSET'     },
    { code: '1100', name: 'EcoCash Account',          type: 'ASSET'     },
    { code: '1200', name: 'Bank Account',             type: 'ASSET'     },
    { code: '2000', name: 'Member Payouts Payable',   type: 'LIABILITY' },
    { code: '3000', name: 'Member Equity',            type: 'EQUITY'    },
    { code: '3100', name: 'Insurance Pool Reserve',   type: 'EQUITY'    },
    { code: '4000', name: 'Contribution Income',      type: 'INCOME'    },
    { code: '4100', name: 'Rental Income',            type: 'INCOME'    },
    { code: '5000', name: 'Platform Fees',            type: 'EXPENSE'   },
    { code: '5100', name: 'Bank Charges',             type: 'EXPENSE'   },
  ]
  for (const acc of accounts) {
    await prisma.ledgerAccount.upsert({
      where: { groupId_code: { groupId: group.id, code: acc.code } },
      update: {},
      create: { ...acc, groupId: group.id },
    })
  }
  console.log('✓ Chart of accounts created')

  // ── Group Admin as Member ─────────────────────────────────────
  await prisma.groupMember.upsert({
    where: { groupId_userId: { groupId: group.id, userId: groupAdmin.id } },
    update: {},
    create: {
      groupId: group.id,
      userId: groupAdmin.id,
      role: 'GROUP_ADMIN',
      status: 'ACTIVE',
      joinedAt: CYCLE_START,
      approvedAt: CYCLE_START,
      approvedById: admin.id,
      cyclesCompleted: 0,
      totalContributed: 0,
    },
  })

  // ── Members in Group (one at a time) ─────────────────────────
  for (let i = 0; i < members.length; i++) {
    await prisma.groupMember.upsert({
      where: { groupId_userId: { groupId: group.id, userId: members[i].id } },
      update: {},
      create: {
        groupId: group.id,
        userId: members[i].id,
        role: 'MEMBER',
        status: 'ACTIVE',
        payoutPosition: i + 1,
        joinedAt: CYCLE_START,
        approvedAt: CYCLE_START,
        approvedById: groupAdmin.id,
        cyclesCompleted: 0,
        totalContributed: MONTHS_ELAPSED * CONTRIBUTION_AMOUNT,
      },
    })
  }
  console.log('✓ Group members linked')

  // ── Scheme membership ─────────────────────────────────────────
  // Group membership no longer implies scheme participation — an admin
  // assigns people per scheme. payoutPosition sets the rotation order.
  for (let i = 0; i < members.length; i++) {
    await prisma.$executeRawUnsafe(`
      INSERT INTO "SchemeMember" ("schemeId", "userId", status, "payoutPosition", "joinedAt", "addedById")
      VALUES ($1::text, $2::text, 'ACTIVE'::"MemberStatus", $3::int, $4::timestamp, $5::text)
      ON CONFLICT ("schemeId", "userId") DO NOTHING
    `, savingsSchemeId, members[i].id, i + 1, CYCLE_START, groupAdmin.id)
  }
  console.log('✓ Savings pool membership assigned')

  // ── Active Cycle ──────────────────────────────────────────────
  // Hangs off the SCHEME now. groupId is kept as the denormalised parent
  // link the dashboard aggregates on.
  const cycle = await prisma.cycle.upsert({
    where: { schemeId_cycleNumber: { schemeId: savingsSchemeId, cycleNumber: 1 } },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000002',
      schemeId: savingsSchemeId,
      groupId: group.id,
      cycleNumber: 1,
      status: 'ACTIVE',
      startDate: CYCLE_START,
      endDate: CYCLE_END,
      totalMembers: members.length,
      poolAmount: members.length * CONTRIBUTION_AMOUNT,
      escrowBalance: 600,
      lockedAt: CYCLE_START,
    },
  })
  console.log('✓ Active cycle created')

  // ── Contributions ─────────────────────────────────────────────
  // The old seed omitted these entirely, so every passbook rendered empty.
  //
  // Months 1..MONTHS_ELAPSED are PAID, the current month is PENDING and past
  // its due date (so it shows as overdue), and the rest are PENDING and not
  // yet due — exercising all three states the passbook renders.
  const contributions: any[] = []
  for (let m = 1; m <= CYCLE_MONTHS; m++) {
    const dueDate = monthStart(-MONTHS_ELAPSED + (m - 1))
    const paid = m <= MONTHS_ELAPSED
    for (const member of members) {
      contributions.push({
        cycleId: cycle.id,
        userId: member.id,
        monthNumber: m,
        amountDue: CONTRIBUTION_AMOUNT,
        amountPaid: paid ? CONTRIBUTION_AMOUNT : 0,
        currency: 'USD',
        dueDate,
        paidAt: paid ? dueDate : null,
        status: paid ? 'PAID' : 'PENDING',
        paymentMethod: paid ? 'ECOCASH' : null,
      })
    }
  }
  const created = await prisma.contribution.createMany({
    data: contributions,
    skipDuplicates: true,
  })
  console.log(`✓ Contributions created (${created.count} new of ${contributions.length})`)

  // ── Payout Schedule ───────────────────────────────────────────
  // createMany + skipDuplicates rather than create-in-try/catch: the old
  // version swallowed every error, so a genuine failure looked like success.
  const schedule = members.map((member, i) => ({
    cycleId: cycle.id,
    recipientId: member.id,
    monthNumber: i + 1,
    scheduledDate: monthStart(-MONTHS_ELAPSED + i),
    payoutAmount: members.length * CONTRIBUTION_AMOUNT,
    status: (i < MONTHS_ELAPSED ? 'COMPLETED' : 'SCHEDULED') as any,
  }))
  const sched = await prisma.payoutSchedule.createMany({
    data: schedule,
    skipDuplicates: true,
  })
  console.log(`✓ Payout schedule created (${sched.count} new of ${schedule.length})`)

  console.log('\n✅ Seeding complete!')
  console.log('\n📋 Login credentials:')
  console.log('   System Admin : admin@stokvel.com       / ' + ADMIN_PASSWORD)
  console.log('   Group Admin  : groupadmin@stokvel.com  / ' + ADMIN_PASSWORD)
  console.log('   Member       : tariro@example.com      / Member@12345')
  if (usingGenerated) {
    console.log('\n⚠  Admin password was generated for this run and is shown ONLY here.')
    console.log('   Save it now, or set SEED_ADMIN_PASSWORD before seeding.')
    console.log('   Existing users are left untouched by upsert — this applies to new accounts only.')
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error('❌ Seed error:', e.message)
    await prisma.$disconnect()
    process.exit(1)
  })
